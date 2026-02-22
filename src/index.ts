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

function resolveElevenLabsApiKey(apiKey?: string): string {
  const override = (apiKey || "").trim();
  return override || currentElevenLabsKey || env.ELEVENLABS_API_KEY || "";
}

function setElevenLabsApiKey(apiKey?: string): string {
  const normalized = (apiKey || "").trim();
  const previousKey = currentElevenLabsKey;
  currentElevenLabsKey = normalized || env.ELEVENLABS_API_KEY || "";

  const effective = resolveElevenLabsApiKey();
  if (effective) {
    if (!elevenlabs || previousKey !== effective) {
      elevenlabs = new ElevenLabsClient({ apiKey: effective });
    }
  } else {
    elevenlabs = null;
  }

  return effective;
}

function getElevenLabsClient(apiKey?: string): ElevenLabsClient | null {
  const resolved = resolveElevenLabsApiKey(apiKey);
  if (!resolved) return null;

  if (!elevenlabs || currentElevenLabsKey !== resolved) {
    currentElevenLabsKey = resolved;
    elevenlabs = new ElevenLabsClient({ apiKey: resolved });
  }

  return elevenlabs;
}

type ProviderStatus = {
  ready: boolean;
  reason?: string | undefined;
};
type OpenAIModelChoice = {
  apiKey: string;
  baseUrl: string;
  model: string;
};
type StationVariationPhase = "opening" | "development" | "turnaround" | "climax" | "resolution";

const MUSIC_PROVIDERS = ["heartmula", "acestep", "elevenlabs"] as const;
type MusicProvider = (typeof MUSIC_PROVIDERS)[number];

const musicProviderSchema = z.enum(MUSIC_PROVIDERS);

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
  provider: musicProviderSchema.optional(),
  elevenlabsApiKey: z.string().trim().optional()
});

const stationGenerateSchema = composeControlSchema.extend({
  stationPrompt: z.string().min(1).max(4000),
  stationName: z.string().min(1).max(120).optional(),
  variationCount: z.coerce.number().int().min(2).max(12).default(4),
  provider: musicProviderSchema.optional(),
  elevenlabsApiKey: z.string().trim().optional()
});

type ComposeInput = z.infer<typeof composeSchema>;
type StationGenerateInput = z.infer<typeof stationGenerateSchema>;
type ComposeWithoutProvider = Omit<ComposeInput, "provider">;

type ProviderDefinition = {
  id: MusicProvider;
  label: string;
  readiness: (projectRoot: string) => Promise<ProviderStatus>;
  compose: (projectRoot: string, input: ComposeWithoutProvider, outputAbsPath: string) => Promise<string>;
};

type ProviderRegistry = Record<MusicProvider, ProviderDefinition>;
type ProviderStatusMap = Record<MusicProvider, ProviderStatus>;

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

function getElevenLabsReadiness(): ProviderStatus {
  const hasKey = Boolean(resolveElevenLabsApiKey());
  return { ready: hasKey, reason: hasKey ? undefined : "Missing ELEVENLABS_API_KEY." };
}

const setElevenLabsKeySchema = z.object({
  apiKey: z.string().trim().optional()
});

function getElevenLabsApiKeyFromInput(input: { elevenlabsApiKey?: string | undefined }): string {
  return resolveElevenLabsApiKey(input.elevenlabsApiKey);
}

function getOpenAIConfig(): OpenAIModelChoice | null {
  const apiKey = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = (process.env.OPENAI_API_BASE_URL || env.OPENAI_API_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.OPENAI_CHAT_MODEL || env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
  return { apiKey, baseUrl, model };
}

function parseJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      const fenced = fencedMatch[1].trim();
      if (fenced) {
        try {
          return JSON.parse(fenced);
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function normalizeRawVariationPrompts(rawResponse: unknown, expectedCount: number): string[] {
  const fallback = Array.from({ length: expectedCount }, (_, i) => "");

  if (!rawResponse) return fallback;

  if (typeof rawResponse === "object" && rawResponse !== null) {
    const asRecord = rawResponse as { variations?: unknown; prompts?: unknown };
    if (Array.isArray(asRecord.variations)) {
      const parsedItems = asRecord.variations.map((entry, index) => {
        if (typeof entry === "string") return entry.trim();
        if (entry && typeof entry === "object") {
          const value = entry as {
            prompt?: unknown;
            text?: unknown;
            content?: unknown;
            variationPrompt?: unknown;
            promptText?: unknown;
          };
          if (typeof value.prompt === "string") return value.prompt.trim();
          if (typeof value.text === "string") return value.text.trim();
          if (typeof value.content === "string") return value.content.trim();
          if (typeof value.variationPrompt === "string") return value.variationPrompt.trim();
          if (typeof value.promptText === "string") return value.promptText.trim();
        }

        return fallback[index] ?? "";
      });
      if (parsedItems.some(Boolean)) {
        return fallback.map((_, index) => parsedItems[index] || "");
      }
      return fallback;
    }

    if (Array.isArray(asRecord.prompts)) {
      const parsedItems = asRecord.prompts.map((entry) => (typeof entry === "string" ? entry.trim() : ""));
      if (parsedItems.some(Boolean)) {
        return fallback.map((_, index) => parsedItems[index] || "");
      }
    }
  }

  if (Array.isArray(rawResponse)) {
    const parsedItems = rawResponse.map((entry) => (typeof entry === "string" ? entry.trim() : ""));
    if (parsedItems.some(Boolean)) {
      return fallback.map((_, index) => parsedItems[index] || "");
    }
  }

  return fallback;
}

async function buildStationVariationPromptsWithLLM(
  stationPrompt: string,
  variationCount: number
): Promise<string[]> {
  const openAI = getOpenAIConfig();
  if (!openAI) return [];

  const fallback = Array.from({ length: variationCount }, (_, i) => buildStationVariationPrompt(stationPrompt, i, variationCount));

  const systemPrompt = `
You are a prompt composer for music generation. Keep the genre consistent with the user's station prompt,
while making each variation intentionally evolve and feel progressively more developed from track 1 to track N.
`.trim();

  const variationSchema = `{
  "variations": [
    "variation prompt 1",
    "variation prompt 2"
  ]
}`;

  const userPrompt = `
Station prompt: ${stationPrompt}
Generate exactly ${variationCount} prompt variants for music generation in the same base genre/style.
Each prompt should be a full creative music prompt (not too short), including a progression from intro to resolution across the ${variationCount} tracks.
Return only JSON matching this structure:
${variationSchema}
`.trim();

  const url = `${openAI.baseUrl}/chat/completions`;
  const requestPayload = {
    model: openAI.model,
    temperature: 0.55,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAI.apiKey}`
    },
    body: JSON.stringify(requestPayload)
  });

  if (!response.ok) {
    throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText}`);
  }

  const raw = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = raw?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return fallback;

  const parsed = parseJsonPayload(content);
  const normalized = normalizeRawVariationPrompts(parsed, variationCount);
  if (normalized.every((value) => value.length > 0)) return normalized;

  const splitLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("{") && !line.startsWith("}"));

  return fallback.map((_, index) => splitLines[index] ?? fallback[index] ?? "");
}

async function buildStationVariationPrompts(
  stationPrompt: string,
  variationCount: number
): Promise<string[]> {
  if (variationCount <= 0) return [];

  try {
    const prompts = await buildStationVariationPromptsWithLLM(stationPrompt, variationCount);
    if (prompts.length === variationCount && prompts.every((prompt) => prompt.length > 0)) return prompts;
  } catch {
    // fall through to deterministic prompt generation
  }

  return Array.from({ length: variationCount }, (_, index) =>
    buildStationVariationPrompt(stationPrompt, index, variationCount)
  );
}

async function composeWithElevenLabs(input: ComposeWithoutProvider, outputAbsPath: string): Promise<string> {
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

const providers: ProviderRegistry = {
  heartmula: {
    id: "heartmula",
    label: "HeartMuLa",
    readiness: getHeartMuLaReadiness,
    compose: async (root, input, outputAbsPath) => {
      const result = await composeWithHeartMuLa(
        {
          projectRoot: root,
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
  },
  acestep: {
    id: "acestep",
    label: "ACE-Step",
    readiness: getAceStepReadiness,
    compose: async (root, input, outputAbsPath) => {
      const result = await composeWithAceStep(
        {
          projectRoot: root,
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
  },
  elevenlabs: {
    id: "elevenlabs",
    label: "ElevenLabs",
    readiness: async () => getElevenLabsReadiness(),
    compose: async (_root, input, outputAbsPath) => composeWithElevenLabs(input, outputAbsPath)
  }
};

function getProviderDefinition(provider: MusicProvider): ProviderDefinition {
  return providers[provider];
}

async function getProviderStatus(provider: MusicProvider): Promise<ProviderStatus> {
  return getProviderDefinition(provider).readiness(projectRoot);
}

async function getAllProviderStatuses(): Promise<ProviderStatusMap> {
  const entries = await Promise.all(
    MUSIC_PROVIDERS.map(async (provider) => [provider, await getProviderStatus(provider)] as const)
  );
  return Object.fromEntries(entries) as ProviderStatusMap;
}

type StationTrackMeta = {
  stationId?: string;
  stationName?: string;
  stationPrompt?: string;
  variationIndex?: number;
  variationCount?: number;
  variationLabel?: string;
};

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
  const phase = buildStationVariationPhase(variationIndex, variationCount);
  const dynamics = {
    opening: ["gentle intro", "clean motif", "warm build-up"],
    development: ["layered groove", "call-and-response movement", "motif weaving"],
    turnaround: ["midpoint contrast", "unexpected texture shift", "harmonic side-step", "rhythmic surprise"],
    climax: ["high-energy release", "anthemic section", "full-arrangement peak", "driven finale"],
    resolution: ["focus back to motif", "polished outro", "final cadence", "gentle landing"]
  };
  const textures = ["wide stereo field", "dry close-mic texture", "hall ambience", "layered harmonics", "clear rhythmic accents"];
  const structures = [
    "intro, theme, short bridge",
    "theme development with call-and-response",
    "sectional movement with contrast",
    "cyclic groove with strong chorus",
    "final reprise"
  ];
  const seed = hashString(`${stationPrompt}:${variationCount}`);

  const dynamic = pickBySeed(dynamics[phase], seed + variationIndex * 37);
  const texture = pickBySeed(textures, seed + variationIndex * 13);
  const structure = pickBySeed(structures, seed + variationIndex * 19);

  return `${stationPrompt}. Variation ${variationIndex + 1} of ${variationCount}. ${dynamic}. ${texture}. ${structure}. ${phase} phase.`;
}

function buildStationVariationPhase(variationIndex: number, variationCount: number): StationVariationPhase {

  if (variationCount <= 1) return "opening";
  const normalizedIndex = Math.min(Math.max(variationIndex, 0), variationCount - 1);
  const ratio = normalizedIndex / (variationCount - 1);

  if (ratio <= 0.18) return "opening";
  if (ratio <= 0.45) return "development";
  if (ratio <= 0.68) return "turnaround";
  if (ratio <= 0.88) return "climax";
  return "resolution";
}

function buildStationVariationTags(tags: string | undefined, variationIndex: number): string | undefined {
  if (!tags || !tags.trim()) return undefined;
  const accents = ["groove-shift", "layered-arrangement", "motif-variation", "contrast-section", "textural-detail"];
  const accent = accents[variationIndex % accents.length];
  return `${tags.trim()},variation-${variationIndex + 1},${accent}`;
}

async function composeFilenameForTrack(provider: MusicProvider, input: ComposeInput, outputAbsPath: string): Promise<string> {
  const providerDefinition = getProviderDefinition(provider);
  const { provider: _provider, ...composeInput } = input;

  const filename = await providerDefinition.compose(
    projectRoot,
    composeInput,
    outputAbsPath
  );
  return filename;
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
    hasElevenLabsKey: Boolean(resolveElevenLabsApiKey()),
    hasOpenAIKey: Boolean(getOpenAIConfig()?.apiKey)
  });
});

app.post("/api/elevenlabs/key", async (req, res) => {
  const parsed = setElevenLabsKeySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });

  const effective = setElevenLabsApiKey(parsed.data.apiKey || "");
  res.json({
    ok: true,
    hasKey: Boolean(effective)
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
  if (provider === "elevenlabs") {
    setElevenLabsApiKey(getElevenLabsApiKeyFromInput(parsed.data));
  }
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
  if (provider === "elevenlabs") {
    setElevenLabsApiKey(getElevenLabsApiKeyFromInput(parsed.data));
  }
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
  const variationPrompts = await buildStationVariationPrompts(input.stationPrompt, input.variationCount);

  for (let variationIndex = 0; variationIndex < input.variationCount; variationIndex += 1) {
    const prompt = variationPrompts[variationIndex] ?? buildStationVariationPrompt(
      input.stationPrompt,
      variationIndex,
      input.variationCount
    );
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

async function startServer(port: number): Promise<void> {
  const maxAttempts = 20;
  let candidatePort = port;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        const server = app.listen(candidatePort, "127.0.0.1", () => {
          // eslint-disable-next-line no-console
          console.log(`AI Radio listening on http://localhost:${candidatePort}`);
          resolve();
        });

        const onError = (error: unknown) => {
          server.close();
          reject(error);
        };
        server.on("error", onError);
      });
      return;
    } catch (error: unknown) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EADDRINUSE" &&
        attempt < maxAttempts - 1
      ) {
        candidatePort += 1;
        continue;
      }

      // eslint-disable-next-line no-console
      console.error("AI Radio failed to start", error);
      throw error;
    }
  }

  throw new Error("AI Radio failed to start: no available port in scan range.");
}

void startServer(env.PORT);
