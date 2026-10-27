/**
 * Sending a local video to TikTok with `source: FILE_UPLOAD`.
 *
 * https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
 *
 * The init call declares the file's size, the chunk size and how many chunks,
 * and TikTok answers with an `upload_url` that is valid for one hour. The file
 * then goes to that URL in order, one PUT per chunk, each with its byte range.
 * TikTok's rules, all checked here before anything is sent:
 *
 *   - each chunk is at least 5 MB and at most 64 MB
 *   - the last chunk takes the trailing bytes and may reach 128 MB
 *   - total_chunk_count is the size divided by chunk_size, rounded down
 *   - a video under 5 MB goes up whole, as one chunk the size of the file
 *   - between 1 and 1000 chunks, sent sequentially
 *
 * Every chunk but the last answers 206, the last 201. A 5xx is TikTok's and the
 * chunk is sent again; a 403 means the upload URL expired.
 *
 * The file is read from disk as a Blob, so each chunk streams from the file
 * rather than the whole video sitting in memory.
 */

import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ApiError, NotFoundError, UsageError } from "@thenavidm/slipway";

/** The chunk size in TikTok's own worked example: 10,000,000 bytes, inside the 5 to 64 MB rule however MB is counted. */
export const CHUNK_BYTES = 10_000_000;

/** Under this a video goes up whole, as TikTok requires. */
const WHOLE_BELOW = 5 * 1024 * 1024;

/** TikTok's ceiling for a video. */
export const MAX_VIDEO_BYTES = 4 * 1024 ** 3;

/** TikTok takes MP4 (recommended), WebM and MOV. */
const VIDEO_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

/** Waits before sending a chunk again after a 5xx or a dropped connection. */
const RETRY_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

export type ChunkPlan = { video_size: number; chunk_size: number; total_chunk_count: number };

/**
 * How to cut a file of `size` bytes, by TikTok's rules. Anything short of two
 * chunks (under 20 MB) goes up whole, which also covers the under-5 MB rule.
 */
export function planChunks(size: number, chunkBytes = CHUNK_BYTES): ChunkPlan {
  if (size < WHOLE_BELOW || size < 2 * chunkBytes) return { video_size: size, chunk_size: size, total_chunk_count: 1 };
  return { video_size: size, chunk_size: chunkBytes, total_chunk_count: Math.floor(size / chunkBytes) };
}

/** The byte ranges a plan sends, the last one taking the trailing bytes. */
export function chunkRanges(plan: ChunkPlan): { first: number; last: number }[] {
  return Array.from({ length: plan.total_chunk_count }, (_, i) => ({
    first: i * plan.chunk_size,
    last: i === plan.total_chunk_count - 1 ? plan.video_size - 1 : (i + 1) * plan.chunk_size - 1,
  }));
}

export type LocalVideo = { path: string; name: string; size: number; mimeType: string; plan: ChunkPlan };

/** `~/clip.mp4` and relative paths as the shell would read them. */
export function localPath(raw: string): string {
  const trimmed = raw.trim();
  const expanded = trimmed === "~" || trimmed.startsWith("~/") ? `${homedir()}${trimmed.slice(1)}` : trimmed;
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

/** Check a local video against TikTok's rules and plan its chunks. Nothing is sent. */
export async function localVideo(raw: string): Promise<LocalVideo> {
  const path = localPath(raw);
  const mimeType = VIDEO_TYPES[extname(path).toLowerCase()];
  if (!mimeType) throw new UsageError(`TikTok takes MP4, WebM or MOV video, and ${basename(path)} is none of them. Nothing was sent.`);
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new UsageError(`${path} is not a file. Nothing was sent.`);
    size = info.size;
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new NotFoundError(`${path} does not exist or cannot be read on the machine running this server. Nothing was sent.`);
  }
  if (size === 0) throw new UsageError(`${path} is empty. Nothing was sent.`);
  if (size > MAX_VIDEO_BYTES) throw new UsageError(`${basename(path)} is ${(size / 1024 ** 3).toFixed(2)} GB; TikTok takes up to 4 GB. Nothing was sent.`);
  return { path, name: basename(path), size, mimeType, plan: planChunks(size) };
}

/** Send the file to the upload_url TikTok returned, chunk by chunk, in order. */
export async function sendChunks(
  uploadUrl: string,
  video: LocalVideo,
  options: { publishId?: string; signal?: AbortSignal; onProgress?: (sent: number, total: number) => void; retryMs?: number[] } = {},
): Promise<void> {
  const file = await openAsBlob(video.path);
  if (file.size !== video.size) throw new UsageError(`${video.name} changed size while it was being sent. Try again once it is finished writing.`);
  const retry = options.retryMs ?? RETRY_MS;
  const ranges = chunkRanges(video.plan);
  const details = (status?: number) => ({ details: { ...(options.publishId ? { publish_id: options.publishId } : {}), ...(status ? { status } : {}) } });

  for (const [index, { first, last }] of ranges.entries()) {
    const final = index === ranges.length - 1;
    for (let attempt = 0; ; attempt++) {
      options.signal?.throwIfAborted();
      let res: Response | undefined;
      try {
        res = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": video.mimeType, "Content-Range": `bytes ${first}-${last}/${video.size}` },
          body: file.slice(first, last + 1),
          signal: options.signal,
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
      }
      if (res && (res.status === 201 || res.status === 200 || (res.status === 206 && !final))) break;
      if (res && res.status < 500) {
        const why =
          res.status === 403
            ? "TikTok's upload URL expired: it is valid for one hour. Start the post again."
            : res.status === 416
              ? "TikTok says the chunk's byte range does not match what it has received."
              : res.status === 404
                ? "TikTok has no upload waiting at that URL. Start the post again."
                : res.status === 206
                  ? "TikTok still expects more of the file after the last chunk."
                  : `TikTok refused chunk ${index + 1} of ${ranges.length} with HTTP ${res.status}.`;
        throw new ApiError(`${why} ${(await res.text()).slice(0, 200)}`.trim(), details(res.status));
      }
      if (attempt >= retry.length) {
        throw new ApiError(`TikTok kept failing on chunk ${index + 1} of ${ranges.length}${res ? ` (HTTP ${res.status})` : ""}. Try again later.`, details(res?.status));
      }
      await sleep(retry[attempt]!, undefined, { signal: options.signal });
    }
    options.onProgress?.(last + 1, video.size);
  }
}
