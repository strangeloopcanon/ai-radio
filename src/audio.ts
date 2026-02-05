import { Readable } from "node:stream";

function isNodeReadable(value: unknown): value is NodeJS.ReadableStream {
  return (
    typeof value === "object" &&
    value !== null &&
    "pipe" in value &&
    typeof (value as { pipe?: unknown }).pipe === "function"
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.iterator in value &&
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function"
  );
}

function isWebReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    "getReader" in value &&
    typeof (value as { getReader?: unknown }).getReader === "function"
  );
}

export async function collectAudioBuffer(audio: unknown): Promise<Buffer> {
  if (audio instanceof Uint8Array) return Buffer.from(audio);
  if (Buffer.isBuffer(audio)) return audio;
  if (audio instanceof ArrayBuffer) return Buffer.from(new Uint8Array(audio));
  if (typeof Blob !== "undefined" && audio instanceof Blob) {
    const ab = await audio.arrayBuffer();
    return Buffer.from(new Uint8Array(ab));
  }

  if (
    typeof audio === "object" &&
    audio !== null &&
    "arrayBuffer" in audio &&
    typeof (audio as { arrayBuffer?: unknown }).arrayBuffer === "function"
  ) {
    const ab = await (audio as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer();
    return Buffer.from(new Uint8Array(ab));
  }

  if (isWebReadableStream(audio)) {
    const reader = audio.getReader();
    const chunks: Buffer[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }

  if (isNodeReadable(audio)) {
    const nodeStream = audio instanceof Readable ? audio : Readable.from(audio as any);
    const chunks: Buffer[] = [];
    for await (const chunk of nodeStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  if (isAsyncIterable(audio) || isIterable(audio)) {
    const nodeStream = Readable.from(audio as any);
    const chunks: Buffer[] = [];
    for await (const chunk of nodeStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported audio response type from ElevenLabs SDK");
}
