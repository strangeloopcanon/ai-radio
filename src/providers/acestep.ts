import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

import { env } from "../config.js";

export type AceStepReadiness = {
  ready: boolean;
  reason?: string;
  resolved?: {
    python: string;
    acestepDir: string;
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

export async function getAceStepReadiness(projectRoot: string): Promise<AceStepReadiness> {
  const python = env.ACESTEP_PYTHON;
  const acestepDir = resolveMaybeRelative(projectRoot, env.ACESTEP_DIR);
  const scriptPath = path.join(projectRoot, "scripts", "acestep_generate.py");

  if (!(await dirExists(acestepDir))) {
    return {
      ready: false,
      reason: `Missing ACESTEP_DIR (expected folder at ${acestepDir}).`,
      resolved: { python, acestepDir, scriptPath }
    };
  }
  if (!(await fileExists(path.join(acestepDir, "acestep", "handler.py")))) {
    return {
      ready: false,
      reason: `Missing ACE-Step python package in ${acestepDir} (expected acestep/handler.py).`,
      resolved: { python, acestepDir, scriptPath }
    };
  }
  if (!(await fileExists(scriptPath))) {
    return {
      ready: false,
      reason: `Missing ACE-Step runner script (expected file at ${scriptPath}).`,
      resolved: { python, acestepDir, scriptPath }
    };
  }

  return { ready: true, resolved: { python, acestepDir, scriptPath } };
}

export type AceStepComposeInput = {
  projectRoot: string;
  prompt: string;
  lyrics?: string;
  musicLengthMs: number;
  forceInstrumental: boolean;
  steps?: number;
  guidanceScale?: number;
  shift?: number;
  inferMethod?: "ode" | "sde";
};

export type AceStepComposeOutput = {
  filename: string;
};

export async function composeWithAceStep(input: AceStepComposeInput, outputAbsPath: string): Promise<AceStepComposeOutput> {
  const readiness = await getAceStepReadiness(input.projectRoot);
  if (!readiness.ready || !readiness.resolved) {
    throw new Error(readiness.reason || "ACE-Step not configured");
  }
  const { python, acestepDir, scriptPath } = readiness.resolved;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai_radio_acestep_"));
  const outDir = path.join(tmpDir, "out");
  await fs.mkdir(outDir, { recursive: true });

  const outPath = path.join(outDir, "output.wav");
  const seconds = Math.max(3, Math.min(600, Math.round(input.musicLengthMs / 1000)));
  const preferSource = env.ACESTEP_PREFER_SOURCE === "auto" ? "" : env.ACESTEP_PREFER_SOURCE;

  const args: string[] = [
    scriptPath,
    `--acestep_dir=${acestepDir}`,
    `--config_path=${env.ACESTEP_CONFIG_PATH}`,
    `--device=${env.ACESTEP_DEVICE}`,
    ...(preferSource ? [`--prefer_source=${preferSource}`] : []),
    `--prompt=${input.prompt}`,
    `--seconds=${String(seconds)}`,
    `--out=${outPath}`,
    `--instrumental=${String(input.forceInstrumental)}`
  ];

  if (typeof input.lyrics === "string" && input.lyrics.trim() && !input.forceInstrumental) {
    args.push(`--lyrics=${input.lyrics}`);
  }
  if (typeof input.steps === "number") args.push(`--steps=${String(input.steps)}`);
  if (typeof input.guidanceScale === "number") args.push(`--guidance_scale=${String(input.guidanceScale)}`);
  if (typeof input.shift === "number") args.push(`--shift=${String(input.shift)}`);
  if (input.inferMethod) args.push(`--infer_method=${input.inferMethod}`);

  const { exitCode, stdout, stderr } = await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(python, args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: input.projectRoot,
        env: {
          ...process.env,
          PYTHONPATH: (() => {
            const pkgRoot = acestepDir;
            const existing = process.env.PYTHONPATH;
            return existing ? `${pkgRoot}${path.delimiter}${existing}` : pkgRoot;
          })()
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
      }, env.ACESTEP_TIMEOUT_MS);

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
    }
  );

  try {
    if (exitCode !== 0) {
      const tail = [stderr, stdout].filter(Boolean).join("\n").trim();
      throw new Error(`ACE-Step generation failed (exit ${exitCode}).${tail ? `\n\n${tail}` : ""}`);
    }
    const produced = await fileExists(outPath);
    if (!produced) {
      const debug = stdout || stderr ? `\n\nstdout/stderr (tail):\n${[stdout, stderr].filter(Boolean).join("\n")}` : "";
      throw new Error(`ACE-Step produced no audio at ${outPath}.${debug}`);
    }

    const finalPath = outputAbsPath.endsWith(".wav") ? outputAbsPath : outputAbsPath.replace(/\.[^/.]+$/, "") + ".wav";
    await fs.copyFile(outPath, finalPath);
    return { filename: path.basename(finalPath) };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

