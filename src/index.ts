import "dotenv/config";

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import express from "express";
import * as dotenv from "dotenv";
import { ElevenLabsClient, ElevenLabsError } from "@elevenlabs/elevenlabs-js";
import { nanoid } from "nanoid";
import { z } from "zod";

import { env } from "./config.js";
import { collectAudioBuffer } from "./audio.js";
import { composeWithHeartMuLa, getHeartMuLaReadiness } from "./providers/heartmula.js";
import { composeWithAceStep, getAceStepReadiness } from "./providers/acestep.js";
import { TrackStore, type Track } from "./tracks.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const generatedDir = path.resolve(projectRoot, env.GENERATED_DIR);
const publicDir = path.resolve(projectRoot, "public");

await fs.mkdir(generatedDir, { recursive: true });

const trackStore = new TrackStore(generatedDir);
await trackStore.init();

let currentElevenLabsKey = env.ELEVENLABS_API_KEY;
let elevenlabs: ElevenLabsClient | null = currentElevenLabsKey ? new ElevenLabsClient({ apiKey: currentElevenLabsKey }) : null;

function reloadEnvFromDisk(): void {
  dotenv.config({ path: path.join(projectRoot, ".env"), override: true });
}

function getElevenLabsClient(): ElevenLabsClient | null {
  const apiKey = process.env.ELEVENLABS_API_KEY || currentElevenLabsKey;
  if (!apiKey) return null;
  if (!elevenlabs || currentElevenLabsKey !== apiKey) {
    currentElevenLabsKey = apiKey;
    elevenlabs = new ElevenLabsClient({ apiKey });
  }
  return elevenlabs;
}

type ProviderStatus = {
  ready: boolean;
  reason?: string | undefined;
};

type MusicProvider = "heartmula" | "acestep" | "elevenlabs";

async function getProviderStatus(provider: MusicProvider): Promise<ProviderStatus> {
  if (provider === "heartmula") {
    const readiness = await getHeartMuLaReadiness(projectRoot);
    return { ready: readiness.ready, reason: readiness.reason };
  }
  if (provider === "acestep") {
    const readiness = await getAceStepReadiness(projectRoot);
    return { ready: readiness.ready, reason: readiness.reason };
  }
  if (provider === "elevenlabs") {
    const hasKey = Boolean(process.env.ELEVENLABS_API_KEY || currentElevenLabsKey);
    return { ready: hasKey, reason: hasKey ? undefined : "Missing ELEVENLABS_API_KEY." };
  }
  return { ready: false, reason: `Unknown provider: ${provider}` };
}

async function getAllProviderStatuses(): Promise<Record<MusicProvider, ProviderStatus>> {
  const [heartmula, acestep, elevenlabs] = await Promise.all([
    getProviderStatus("heartmula"),
    getProviderStatus("acestep"),
    getProviderStatus("elevenlabs")
  ]);
  return { heartmula, acestep, elevenlabs };
}

const composeControlSchema = z.object({
  tags: z.string().min(1).max(4000).optional(),
  lyrics: z.string().max(20_000).optional(),
  musicLengthMs: z.coerce.number().int().min(3_000).max(600_000).default(30_000),
  forceInstrumental: z.boolean().optional().default(false),
  // HeartMuLa controls
  topk: z.coerce.number().int().min(1).max(500).optional(),
  temperature: z.coerce.number().min(0.1).max(2.0).optional(),
  cfgScale: z.coerce.number().min(1.0).max(10.0).optional(),
  // ACE-Step controls
  steps: z.coerce.number().int().min(1).max(200).optional(),
  guidanceScale: z.coerce.number().min(1.0).max(30.0).optional(),
  shift: z.coerce.number().min(1.0).max(5.0).optional(),
  inferMethod: z.enum(["ode", "sde"]).optional()
});

const composeSchema = composeControlSchema.extend({
  prompt: z.string().min(1).max(4000),
  provider: z.enum(["heartmula", "acestep", "elevenlabs"]).optional()
});

const stationGenerateSchema = composeControlSchema.extend({
  stationPrompt: z.string().min(1).max(4000),
  stationName: z.string().min(1).max(120).optional(),
  variationCount: z.coerce.number().int().min(2).max(12).default(4),
  provider: z.enum(["heartmula", "acestep", "elevenlabs"]).optional()
});

type ComposeInput = z.infer<typeof composeSchema>;
type ComposeControls = z.infer<typeof composeControlSchema>;
type StationGenerateInput = z.infer<typeof stationGenerateSchema>;

type StationTrackMeta = {
  stationId?: string;
  stationName?: string;
  stationPrompt?: string;
  variationIndex?: number;
  variationCount?: number;
  variationLabel?: string;
};

function summarizeElevenLabsMessage(err: ElevenLabsError): { statusCode: number; message: string; detail: unknown } {
  const statusCode = err.statusCode ?? 500;
  const body = err.body;
  const detailMessage =
    typeof body === "object" && body !== null
      ? (body as any)?.detail?.message || (body as any)?.message
      : undefined;
  return {
    statusCode,
    message: typeof detailMessage === "string" ? detailMessage : err.message,
    detail: body
  };
}

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function pickBySeed(items: string[], seed: number): string {
  return items[seed % items.length] ?? items[0] ?? "";
}

function buildStationVariationPrompt(stationPrompt: string, variationIndex: number, variationCount: number): string {
  const dynamics = ["gentle intro", "steady build", "energetic mid-section", "soft breakdown", "strong finale"];
  const textures = ["wide stereo field", "dry close-mic texture", "hall ambience", "layered harmonics", "clear rhythmic accents"];
  const structures = ["intro, theme, improv, resolution", "motif development with call-and-response", "cyclic groove with melodic turns", "sectional movement with contrast"];
  const moods = ["warm and devotional", "bright and uplifting", "meditative and spacious", "concert-like live feel", "focused and intricate"];

  const seed = hashString(`${stationPrompt}:${variationIndex}:${variationCount}`);
  const dynamic = pickBySeed(dynamics, seed + 11);
  const texture = pickBySeed(textures, seed + 23);
  const structure = pickBySeed(structures, seed + 31);
  const mood = pickBySeed(moods, seed + 47);

  return `${stationPrompt}. Variation ${variationIndex + 1} of ${variationCount}. ${dynamic}. ${texture}. ${structure}. ${mood}.`;
}

function buildStationVariationTags(tags: string | undefined, variationIndex: number): string | undefined {
  if (!tags || !tags.trim()) return undefined;
  const accents = ["groove-shift", "layered-arrangement", "motif-variation", "contrast-section", "textural-detail"];
  const accent = accents[variationIndex % accents.length];
  return `${tags.trim()},variation-${variationIndex + 1},${accent}`;
}

async function composeFilenameForTrack(provider: MusicProvider, input: ComposeInput, outputAbsPath: string): Promise<string> {
  if (provider === "heartmula") {
    const result = await composeWithHeartMuLa(
      {
        projectRoot,
        prompt: input.prompt,
        ...(typeof input.tags === "string" ? { tags: input.tags } : {}),
        ...(typeof input.lyrics === "string" ? { lyrics: input.lyrics } : {}),
        musicLengthMs: input.musicLengthMs,
        forceInstrumental: input.forceInstrumental,
        ...(typeof input.topk === "number" ? { topk: input.topk } : {}),
        ...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
        ...(typeof input.cfgScale === "number" ? { cfgScale: input.cfgScale } : {})
      },
      outputAbsPath
    );
    return result.filename;
  }

  if (provider === "acestep") {
    const result = await composeWithAceStep(
      {
        projectRoot,
        prompt: input.prompt,
        ...(typeof input.lyrics === "string" ? { lyrics: input.lyrics } : {}),
        musicLengthMs: input.musicLengthMs,
        forceInstrumental: input.forceInstrumental,
        ...(typeof input.steps === "number" ? { steps: input.steps } : {}),
        ...(typeof input.guidanceScale === "number" ? { guidanceScale: input.guidanceScale } : {}),
        ...(typeof input.shift === "number" ? { shift: input.shift } : {}),
        ...(typeof input.inferMethod === "string" ? { inferMethod: input.inferMethod } : {})
      },
      outputAbsPath
    );
    return result.filename;
  }

  let client = getElevenLabsClient();
  if (!client) {
    reloadEnvFromDisk();
    client = getElevenLabsClient();
  }
  if (!client) {
    throw new Error("Set ELEVENLABS_API_KEY in your .env file, then try again.");
  }

  const outputFormat = "mp3_44100_128" as const;
  const promptWithTags = input.tags?.trim() ? `${input.prompt}\nTags: ${input.tags}` : input.prompt;
  const audio = await client.music.compose({
    prompt: promptWithTags,
    musicLengthMs: input.musicLengthMs,
    forceInstrumental: input.forceInstrumental,
    outputFormat
  });
  const buffer = await collectAudioBuffer(audio);
  await fs.writeFile(outputAbsPath, buffer);
  return path.basename(outputAbsPath);
}

function toTrackRecord(
  id: string,
  filename: string,
  provider: MusicProvider,
  input: ComposeInput,
  meta?: StationTrackMeta
): Track {
  return {
    id,
    provider,
    prompt: input.prompt,
    musicLengthMs: input.musicLengthMs,
    createdAt: new Date().toISOString(),
    filename,
    ...(typeof input.tags === "string" ? { tags: input.tags } : {}),
    ...(typeof input.topk === "number" ? { topk: input.topk } : {}),
    ...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
    ...(typeof input.cfgScale === "number" ? { cfgScale: input.cfgScale } : {}),
    ...(typeof input.steps === "number" ? { steps: input.steps } : {}),
    ...(typeof input.guidanceScale === "number" ? { guidanceScale: input.guidanceScale } : {}),
    ...(typeof input.shift === "number" ? { shift: input.shift } : {}),
    ...(typeof input.inferMethod === "string" ? { inferMethod: input.inferMethod } : {}),
    ...(meta?.stationId ? { stationId: meta.stationId } : {}),
    ...(meta?.stationName ? { stationName: meta.stationName } : {}),
    ...(meta?.stationPrompt ? { stationPrompt: meta.stationPrompt } : {}),
    ...(typeof meta?.variationIndex === "number" ? { variationIndex: meta.variationIndex } : {}),
    ...(typeof meta?.variationCount === "number" ? { variationCount: meta.variationCount } : {}),
    ...(meta?.variationLabel ? { variationLabel: meta.variationLabel } : {})
  };
}

async function createAndStoreTrack(input: ComposeInput, meta?: StationTrackMeta): Promise<Track> {
  const provider = (input.provider || env.MUSIC_PROVIDER) as MusicProvider;
  const id = nanoid();
  const defaultFilename = `${id}.mp3`;
  const absPath = path.join(generatedDir, defaultFilename);
  const filename = await composeFilenameForTrack(provider, input, absPath);
  const track = toTrackRecord(id, filename, provider, input, meta);
  await trackStore.add(track);
  return track;
}

const app = express();
app.disable("x-powered-by");

app.use(express.json({ limit: "2mb" }));
app.use("/generated", express.static(generatedDir));
app.use(express.static(publicDir));

app.get("/api/health", async (_req, res) => {
  const provider = env.MUSIC_PROVIDER as MusicProvider;
  const providers = await getAllProviderStatuses();
  const providerStatus = providers[provider];

  res.json({
    ok: true,
    time: new Date().toISOString(),
    musicProvider: provider,
    providerReady: providerStatus.ready,
    providerReason: providerStatus.reason,
    providers,
    hasElevenLabsKey: Boolean(process.env.ELEVENLABS_API_KEY || currentElevenLabsKey)
  });
});

app.get("/api/tracks", (_req, res) => {
  res.json({ tracks: trackStore.list() });
});

const clearTracksSchema = z.object({
  keepLatest: z.boolean().optional().default(false)
});

app.post("/api/tracks/clear", async (req, res) => {
  const parsed = clearTracksSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });

  const keepLatest = parsed.data.keepLatest;
  const current = trackStore.list();
  const keep = keepLatest && current.length ? [current[0]!] : [];
  const keepFiles = new Set(keep.map((t) => t.filename));

  const entries = await fs.readdir(generatedDir).catch(() => []);
  let removedFiles = 0;
  for (const name of entries) {
    if (keepFiles.has(name)) continue;
    const abs = path.join(generatedDir, name);
    try {
      await fs.rm(abs, { force: true, recursive: false });
      removedFiles += 1;
    } catch {
      // ignore best-effort cleanup errors
    }
  }

  await trackStore.reset(keep);

  res.json({
    ok: true,
    removedFiles,
    remainingTracks: keep.length
  });
});

app.get("/api/tracks/:id/download", async (req, res) => {
  const id = req.params.id;
  const track = trackStore.getById(id);
  if (!track) return res.status(404).json({ error: "not_found" });

  const absPath = path.join(generatedDir, track.filename);
  res.download(absPath, track.filename);
});

app.post("/api/music/compose", async (req, res) => {
  const parsed = composeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });

  const provider = (parsed.data.provider || env.MUSIC_PROVIDER) as MusicProvider;
  const providerStatus = await getProviderStatus(provider);
  if (!providerStatus.ready) {
    return res.status(503).json({
      error: `${provider}_not_ready`,
      message: providerStatus.reason || `${provider} is not configured`
    });
  }

  try {
    const track = await createAndStoreTrack({ ...parsed.data, provider });
    res.json({
      track,
      url: `/generated/${track.filename}`,
      downloadUrl: `/api/tracks/${track.id}/download`
    });
  } catch (err: unknown) {
    if (err instanceof ElevenLabsError) {
      const detail = summarizeElevenLabsMessage(err);
      return res.status(detail.statusCode).json({
        error: "elevenlabs_error",
        statusCode: detail.statusCode,
        message: detail.message,
        detail: detail.detail
      });
    }

    const message = err instanceof Error ? err.message : "music_compose_failed";
    res.status(500).json({ error: "music_compose_failed", message });
  }
});

app.post("/api/station/generate", async (req, res) => {
  const parsed = stationGenerateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });

  const provider = (parsed.data.provider || env.MUSIC_PROVIDER) as MusicProvider;
  const providerStatus = await getProviderStatus(provider);
  if (!providerStatus.ready) {
    return res.status(503).json({
      error: `${provider}_not_ready`,
      message: providerStatus.reason || `${provider} is not configured`
    });
  }

  const input: StationGenerateInput = parsed.data;
  const stationId = nanoid();
  const stationName = input.stationName?.trim() || `AI Station ${new Date().toLocaleTimeString()}`;
  const generatedTracks: Track[] = [];

  for (let variationIndex = 0; variationIndex < input.variationCount; variationIndex += 1) {
    const prompt = buildStationVariationPrompt(input.stationPrompt, variationIndex, input.variationCount);
    const tags = buildStationVariationTags(input.tags, variationIndex);

    const composeInput: ComposeInput = {
      prompt,
      provider,
      musicLengthMs: input.musicLengthMs,
      forceInstrumental: input.forceInstrumental,
      ...(tags ? { tags } : {}),
      ...(typeof input.lyrics === "string" ? { lyrics: input.lyrics } : {}),
      ...(typeof input.topk === "number" ? { topk: input.topk } : {}),
      ...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
      ...(typeof input.cfgScale === "number" ? { cfgScale: input.cfgScale } : {}),
      ...(typeof input.steps === "number" ? { steps: input.steps } : {}),
      ...(typeof input.guidanceScale === "number" ? { guidanceScale: input.guidanceScale } : {}),
      ...(typeof input.shift === "number" ? { shift: input.shift } : {}),
      ...(typeof input.inferMethod === "string" ? { inferMethod: input.inferMethod } : {})
    };

    try {
      const track = await createAndStoreTrack(composeInput, {
        stationId,
        stationName,
        stationPrompt: input.stationPrompt,
        variationIndex: variationIndex + 1,
        variationCount: input.variationCount,
        variationLabel: `Variation ${variationIndex + 1}`
      });
      generatedTracks.push(track);
    } catch (err: unknown) {
      if (err instanceof ElevenLabsError) {
        const detail = summarizeElevenLabsMessage(err);
        return res.status(detail.statusCode).json({
          error: "station_generation_failed",
          statusCode: detail.statusCode,
          message: detail.message,
          detail: detail.detail,
          generatedCount: generatedTracks.length,
          generatedTracks,
          failedAtVariation: variationIndex + 1
        });
      }

      const message = err instanceof Error ? err.message : "station_generation_failed";
      return res.status(500).json({
        error: "station_generation_failed",
        message,
        generatedCount: generatedTracks.length,
        generatedTracks,
        failedAtVariation: variationIndex + 1
      });
    }
  }

  res.json({
    station: {
      id: stationId,
      name: stationName,
      prompt: input.stationPrompt,
      variationCount: input.variationCount,
      musicProvider: provider
    },
    tracks: generatedTracks
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`AI Radio listening on http://localhost:${env.PORT}`);
});
