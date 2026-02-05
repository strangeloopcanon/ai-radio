import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

import { env } from "../config.js";

export type HeartMuLaReadiness = {
  ready: boolean;
  reason?: string;
  resolved?: {
    python: string;
    heartlibDir: string;
    ckptDir: string;
    scriptPath: string;
  };
};

function resolveMaybeRelative(projectRoot: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(projectRoot, p);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function getHeartMuLaReadiness(projectRoot: string): Promise<HeartMuLaReadiness> {
  const python = env.HEARTMULA_PYTHON;
  const heartlibDir = resolveMaybeRelative(projectRoot, env.HEARTLIB_DIR);
  const ckptDir = resolveMaybeRelative(projectRoot, env.HEARTMULA_CKPT_DIR);
  const scriptPath = path.join(heartlibDir, "examples", "run_music_generation.py");
  const tokenizerPath = path.join(ckptDir, "tokenizer.json");
  const genConfigPath = path.join(ckptDir, "gen_config.json");
  const heartmulaCkptPath = path.join(ckptDir, `HeartMuLa-oss-${env.HEARTMULA_VERSION}`);
  const codecCkptPath = path.join(ckptDir, "HeartCodec-oss");

  if (!(await dirExists(heartlibDir))) {
    return {
      ready: false,
      reason: `Missing HEARTLIB_DIR (expected folder at ${heartlibDir}).`,
      resolved: { python, heartlibDir, ckptDir, scriptPath }
    };
  }
  if (!(await fileExists(scriptPath))) {
    return {
      ready: false,
      reason: `Missing HeartMuLa script (expected file at ${scriptPath}).`,
      resolved: { python, heartlibDir, ckptDir, scriptPath }
    };
  }
  if (!(await dirExists(ckptDir))) {
    return {
      ready: false,
      reason: `Missing HEARTMULA_CKPT_DIR (expected folder at ${ckptDir}).`,
      resolved: { python, heartlibDir, ckptDir, scriptPath }
    };
  }
  if (!(await fileExists(tokenizerPath)) || !(await fileExists(genConfigPath))) {
    return {
      ready: false,
      reason: `Missing tokenizer/config in ${ckptDir} (expected tokenizer.json and gen_config.json).`,
      resolved: { python, heartlibDir, ckptDir, scriptPath }
    };
  }
  if (!(await dirExists(heartmulaCkptPath))) {
    return {
      ready: false,
      reason: `Missing HeartMuLa checkpoints (expected folder at ${heartmulaCkptPath}).`,
      resolved: { python, heartlibDir, ckptDir, scriptPath }
    };
  }
  if (!(await dirExists(codecCkptPath))) {
    return {
      ready: false,
      reason: `Missing HeartCodec checkpoints (expected folder at ${codecCkptPath}).`,
      resolved: { python, heartlibDir, ckptDir, scriptPath }
    };
  }

  return { ready: true, resolved: { python, heartlibDir, ckptDir, scriptPath } };
}

function promptToTags(prompt: string): string {
  // HeartMuLa examples recommend "comma-separated tags without spaces" — we normalize lightly.
  const raw = prompt.replace(/\n+/g, ",");
  const tags = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .join(",");
  return tags || prompt.trim();
}

function normalizeTags(raw: string): string {
  const tags = raw
    .replace(/\n+/g, ",")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .join(",");
  return tags;
}

export type HeartMuLaComposeInput = {
  projectRoot: string;
  prompt: string;
  tags?: string;
  lyrics?: string;
  musicLengthMs: number;
  forceInstrumental: boolean;
  topk?: number;
  temperature?: number;
  cfgScale?: number;
};

export type HeartMuLaComposeOutput = {
  filename: string;
};

export async function composeWithHeartMuLa(
  input: HeartMuLaComposeInput,
  outputAbsPath: string
): Promise<HeartMuLaComposeOutput> {
  const readiness = await getHeartMuLaReadiness(input.projectRoot);
  if (!readiness.ready || !readiness.resolved) {
    throw new Error(readiness.reason || "HeartMuLa not configured");
  }

  const { python, heartlibDir, ckptDir, scriptPath } = readiness.resolved;

  const providedTags = typeof input.tags === "string" ? normalizeTags(input.tags) : "";
  const baseTags = providedTags || promptToTags(input.prompt);
  const tags = input.forceInstrumental && !baseTags.toLowerCase().includes("instrumental") ? `${baseTags},instrumental` : baseTags;

  const lyrics =
    input.forceInstrumental
      ? "[Instrumental]"
      : (input.lyrics ?? `[Verse]\n${input.prompt.trim()}\n\n[Chorus]\n${input.prompt.trim()}\n`);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai_radio_heartmula_"));
  const tagsPath = path.join(tmpDir, "tags.txt");
  const lyricsPath = path.join(tmpDir, "lyrics.txt");
  const outDir = path.join(tmpDir, "out");
  const outPath = path.join(outDir, "output.wav");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(tagsPath, tags, "utf8");
  await fs.writeFile(lyricsPath, lyrics, "utf8");

  const args: string[] = [
    scriptPath,
    `--model_path=${ckptDir}`,
    `--version=${env.HEARTMULA_VERSION}`,
    `--tags=${tagsPath}`,
    `--lyrics=${lyricsPath}`,
    `--save_path=${outPath}`,
    `--max_audio_length_ms=${input.musicLengthMs}`,
    ...(typeof input.topk === "number" ? [`--topk=${input.topk}`] : []),
    ...(typeof input.temperature === "number" ? [`--temperature=${input.temperature}`] : []),
    ...(typeof input.cfgScale === "number" ? [`--cfg_scale=${input.cfgScale}`] : []),
    `--lazy_load=${String(env.HEARTMULA_LAZY_LOAD_MODEL)}`,
    `--mula_device=${env.HEARTMULA_MULA_DEVICE}`,
    `--codec_device=${env.HEARTMULA_CODEC_DEVICE}`,
    `--mula_dtype=${env.HEARTMULA_MULA_DTYPE}`,
    `--codec_dtype=${env.HEARTMULA_CODEC_DTYPE}`
  ];

  const { exitCode, stdout, stderr } = await new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    const heartlibSrc = path.join(heartlibDir, "src");
    const existingPythonPath = process.env.PYTHONPATH;
    const pythonPath = existingPythonPath ? `${heartlibSrc}${path.delimiter}${existingPythonPath}` : heartlibSrc;

    const child = spawn(python, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: input.projectRoot,
      env: {
        ...process.env,
        PYTHONPATH: pythonPath
      }
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const limit = 64_000;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk).slice(-limit);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-limit);
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, env.HEARTMULA_TIMEOUT_MS);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const message = err instanceof Error ? err.message : String(err);
      resolve({ exitCode: 1, stdout, stderr: (stderr + `\n${message}`).trim() });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: code, stdout, stderr });
    });
  });

  try {
    if (exitCode !== 0) {
      const tail = [stderr, stdout].filter(Boolean).join("\n").trim();
      throw new Error(`HeartMuLa generation failed (exit ${exitCode}).${tail ? `\n\n${tail}` : ""}`);
    }

    let producedPath: string | null = (await fileExists(outPath)) ? outPath : null;
    if (!producedPath) {
      const files = await fs.readdir(outDir);
      const candidates = files.filter((f) => /\.(mp3|wav|flac|ogg)$/i.test(f));
      if (candidates.length === 0) {
        const debug = stdout || stderr ? `\n\nstdout/stderr (tail):\n${[stdout, stderr].filter(Boolean).join("\n")}` : "";
        throw new Error(`HeartMuLa produced no audio files in ${outDir}.${debug}`);
      }

      const withSizes = await Promise.all(
        candidates.map(async (f) => {
          const abs = path.join(outDir, f);
          const stat = await fs.stat(abs);
          return { abs, size: stat.size, file: f };
        })
      );
      withSizes.sort((a, b) => b.size - a.size);
      producedPath = withSizes[0]!.abs;
    }
    const ext = path.extname(producedPath) || ".mp3";

    const finalPath = outputAbsPath.endsWith(ext) ? outputAbsPath : outputAbsPath.replace(/\.[^/.]+$/, "") + ext;
    await fs.copyFile(producedPath, finalPath);

    return { filename: path.basename(finalPath) };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
