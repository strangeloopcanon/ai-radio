#!/usr/bin/env python3
import argparse
import os
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--acestep_dir", required=True, help="Path to vendor/acestep (ACE-Step-1.5 repo)")
    parser.add_argument("--config_path", default="acestep-v15-turbo", help="DiT model dir name under checkpoints/")
    parser.add_argument("--device", default="auto", help="auto|mps|cpu|cuda")
    parser.add_argument("--prefer_source", default="", help="huggingface|modelscope (optional)")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--lyrics", default="")
    parser.add_argument("--instrumental", default="false")
    parser.add_argument("--seconds", type=int, default=30)
    parser.add_argument("--steps", type=int, default=8)
    parser.add_argument("--guidance_scale", type=float, default=7.0)
    parser.add_argument("--shift", type=float, default=1.0)
    parser.add_argument("--infer_method", default="ode", choices=["ode", "sde"])
    parser.add_argument("--out", required=True, help="Output wav path")
    args = parser.parse_args()

    acestep_dir = Path(args.acestep_dir).resolve()
    if not (acestep_dir / "acestep" / "handler.py").exists():
        print(f"ERROR: ACE-Step repo not found at {acestep_dir}", file=sys.stderr)
        return 2

    # Ensure imports work even if invoked from outside vendor/acestep
    sys.path.insert(0, str(acestep_dir))

    # Reduce tokenizer fork warning noise
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

    from acestep.handler import AceStepHandler
    from acestep.llm_inference import LLMHandler
    from acestep.inference import GenerationParams, GenerationConfig, generate_music

    dit_handler = AceStepHandler()
    llm_handler = LLMHandler()  # we won't initialize it (keeps RAM down)

    prefer = args.prefer_source.strip() or None
    status, ok = dit_handler.initialize_service(
        project_root=str(acestep_dir),
        config_path=args.config_path,
        device=args.device,
        use_flash_attention=False,
        compile_model=False,
        offload_to_cpu=False,
        offload_dit_to_cpu=False,
        prefer_source=prefer,
    )
    if not ok:
        print(status, file=sys.stderr)
        return 3

    instrumental = str(args.instrumental).lower() in ("1", "true", "yes", "y", "t")
    duration = max(3, min(600, int(args.seconds)))

    params = GenerationParams(
        task_type="text2music",
        caption=str(args.prompt),
        lyrics="" if instrumental else (str(args.lyrics) if str(args.lyrics).strip() else ""),
        instrumental=instrumental,
        duration=float(duration),
        thinking=False,  # no 5Hz LM codes
        use_cot_caption=False,
        use_cot_language=False,
        use_cot_metas=False,
        inference_steps=int(args.steps),
        guidance_scale=float(args.guidance_scale),
        shift=float(args.shift),
        infer_method=str(args.infer_method),
    )

    config = GenerationConfig(
        batch_size=1,
        audio_format="wav",
        constrained_decoding_debug=False,
    )

    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    result = generate_music(dit_handler, llm_handler, params, config, save_dir=str(out_path.parent))
    if not result.success:
        print(result.status_message or (result.error or "Generation failed"), file=sys.stderr)
        return 4

    # The saver names the file by a UUID-like key. Pick the first audio path and rename to requested output.
    audio0 = result.audios[0] if result.audios else None
    src = (audio0 or {}).get("path") if isinstance(audio0, dict) else None
    if not src:
        print("ERROR: No audio file path returned by ACE-Step.", file=sys.stderr)
        return 5

    src_path = Path(src).resolve()
    if not src_path.exists():
        print(f"ERROR: Expected audio file not found: {src_path}", file=sys.stderr)
        return 6

    # Ensure .wav extension for browser playback
    final = out_path
    if final.suffix.lower() != ".wav":
        final = final.with_suffix(".wav")
    try:
        src_path.replace(final)
    except Exception:
        # cross-device fallback
        import shutil

        shutil.copyfile(src_path, final)

    print(str(final))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

