import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  GENERATED_DIR: z.string().min(1).default("generated"),

  // Which backend to use for /api/music/compose
  MUSIC_PROVIDER: z.enum(["heartmula", "acestep", "elevenlabs"]).optional().default("acestep"),

  // ElevenLabs (optional)
  ELEVENLABS_API_KEY: z.string().optional().default(""),

  // HeartMuLa / heartlib (local)
  HEARTLIB_DIR: z.string().optional().default("vendor/heartlib"),
  HEARTMULA_CKPT_DIR: z.string().optional().default("vendor/heartlib/ckpt"),
  // Note: HeartMuLa-7B exists internally but the open weights may not be publicly released yet.
  HEARTMULA_VERSION: z.enum(["1B", "3B", "7B"]).optional().default("3B"),
  HEARTMULA_PYTHON: z.string().optional().default("python3"),
  HEARTMULA_MULA_DEVICE: z.string().optional().default("cuda"),
  HEARTMULA_CODEC_DEVICE: z.string().optional().default("cuda"),
  HEARTMULA_MULA_DTYPE: z.enum(["float32", "float16", "bfloat16", "fp32", "fp16", "bf16"]).optional().default("bfloat16"),
  HEARTMULA_CODEC_DTYPE: z.enum(["float32", "float16", "bfloat16", "fp32", "fp16", "bf16"]).optional().default("float32"),
  HEARTMULA_LAZY_LOAD_MODEL: z.coerce.boolean().optional().default(true),
  HEARTMULA_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(30 * 60 * 1000),
  // ACE-Step (local, via vendor/acestep)
  ACESTEP_DIR: z.string().optional().default("vendor/acestep"),
  ACESTEP_PYTHON: z.string().optional().default("python3"),
  ACESTEP_DEVICE: z.string().optional().default("auto"),
  ACESTEP_CONFIG_PATH: z.string().optional().default("acestep-v15-turbo"),
  ACESTEP_PREFER_SOURCE: z.enum(["auto", "huggingface", "modelscope"]).optional().default("auto"),
  ACESTEP_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(60 * 60 * 1000)
});

export const env = envSchema.parse(process.env);
