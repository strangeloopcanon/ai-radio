import fs from "node:fs/promises";
import path from "node:path";

export type Track = {
  id: string;
  provider: "heartmula" | "acestep" | "elevenlabs";
  prompt: string;
  tags?: string;
  musicLengthMs: number;
  createdAt: string;
  filename: string;
  topk?: number;
  temperature?: number;
  cfgScale?: number;
  steps?: number;
  guidanceScale?: number;
  shift?: number;
  inferMethod?: "ode" | "sde";
  stationId?: string;
  stationName?: string;
  stationPrompt?: string;
  variationIndex?: number;
  variationCount?: number;
  variationLabel?: string;
};

type TrackIndex = {
  tracks: Track[];
};

export class TrackStore {
  private readonly indexPath: string;
  private index: TrackIndex = { tracks: [] };
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly generatedDir: string) {
    this.indexPath = path.join(this.generatedDir, "tracks.json");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.generatedDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as TrackIndex;
      if (parsed && Array.isArray(parsed.tracks)) this.index = parsed;
    } catch {
      await this.flush();
    }
  }

  list(): Track[] {
    return [...this.index.tracks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getById(id: string): Track | undefined {
    return this.index.tracks.find((t) => t.id === id);
  }

  async add(track: Track): Promise<void> {
    this.index.tracks.push(track);
    await this.flush();
  }

  async reset(tracks: Track[] = []): Promise<void> {
    this.index.tracks = [...tracks];
    await this.flush();
  }

  private async flush(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const tmpPath = `${this.indexPath}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(this.index, null, 2), "utf8");
      await fs.rename(tmpPath, this.indexPath);
    });
    return this.writeQueue;
  }
}
