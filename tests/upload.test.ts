/**
 * Posting a video from this machine with FILE_UPLOAD, against a fake TikTok:
 * nothing here reaches the network or a real account.
 *
 * What matters: the chunk plan follows TikTok's media transfer rules for every
 * size, a bad file fails before TikTok hears of it, the chunks go up in order
 * with their byte ranges, a 5xx is retried and a 403 says the URL expired, and
 * the URL path still sends exactly what it sent before.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXIT } from "@thenavidm/slipway";
import { cli } from "@thenavidm/slipway/testing";
import { chunkRanges, localVideo, planChunks, sendChunks, CHUNK_BYTES, MAX_VIDEO_BYTES } from "../src/api/upload.js";
import { app } from "../src/app.js";

const scratch = mkdtempSync(join(tmpdir(), "tiktok-upload-"));
const BASE = { TIKTOK_CLIENT_KEY: "key", TIKTOK_CLIENT_SECRET: "secret", TIKTOK_REFRESH_TOKEN: "refresh" };
const MB = 1_000_000;
const MiB = 1024 * 1024;

function file(name: string, size: number): string {
  const path = join(scratch, name);
  writeFileSync(path, new Uint8Array(size));
  return path;
}

afterEach(() => vi.unstubAllGlobals());

describe("the chunk plan follows TikTok's rules", () => {
  it("matches TikTok's own worked example: 50,000,123 bytes in five 10,000,000-byte chunks", () => {
    const plan = planChunks(50_000_123);
    expect(plan).toEqual({ video_size: 50_000_123, chunk_size: 10_000_000, total_chunk_count: 5 });
    expect(chunkRanges(plan).at(-1)).toEqual({ first: 40_000_000, last: 50_000_122 });
  });

  it("sends a video under 5 MB whole", () => {
    expect(planChunks(4 * MiB)).toEqual({ video_size: 4 * MiB, chunk_size: 4 * MiB, total_chunk_count: 1 });
  });

  it.each([1, 5 * MiB - 1, 5 * MiB, 9_999_999, 10_000_000, 10_000_001, 19_999_999, 64 * MiB, 64 * MiB + 1, 128 * MiB + 5, 999 * MB, MAX_VIDEO_BYTES])(
    "keeps every chunk inside the rules for %i bytes",
    (size) => {
      const plan = planChunks(size);
      const ranges = chunkRanges(plan);
      expect(plan.total_chunk_count).toBe(Math.floor(size / plan.chunk_size));
      expect(ranges.length).toBeGreaterThanOrEqual(1);
      expect(ranges.length).toBeLessThanOrEqual(1000);
      expect(ranges[0]!.first).toBe(0);
      expect(ranges.at(-1)!.last).toBe(size - 1);
      if (ranges.length > 1) {
        expect(plan.chunk_size).toBeGreaterThanOrEqual(5 * MiB);
        expect(plan.chunk_size).toBeLessThanOrEqual(64 * MB);
        const last = ranges.at(-1)!;
        expect(last.last - last.first + 1).toBeLessThanOrEqual(128 * MB);
      } else {
        expect(plan.chunk_size).toBe(size);
        expect(size).toBeLessThan(2 * CHUNK_BYTES);
      }
      for (let i = 1; i < ranges.length; i++) expect(ranges[i]!.first).toBe(ranges[i - 1]!.last + 1);
    },
  );
});

describe("a local file is checked before TikTok hears of it", () => {
  it("takes MP4, WebM and MOV", async () => {
    expect((await localVideo(file("a.mp4", 10))).mimeType).toBe("video/mp4");
    expect((await localVideo(file("a.mov", 10))).mimeType).toBe("video/quicktime");
    expect((await localVideo(file("a.webm", 10))).mimeType).toBe("video/webm");
    await expect(localVideo(file("a.avi", 10))).rejects.toThrow(/MP4, WebM or MOV/);
  });

  it("says when the file is missing or empty", async () => {
    await expect(localVideo(join(scratch, "missing.mp4"))).rejects.toMatchObject({ exitCode: EXIT.notFound });
    await expect(localVideo(file("empty.mp4", 0))).rejects.toMatchObject({ exitCode: EXIT.usage });
  });
});

type Seen = { url: string; method: string; headers: Record<string, string>; body?: unknown };

/** A fake TikTok: token, init, then an upload URL that answers each chunk. */
function fakeTikTok(chunkStatuses: number[] = []) {
  const seen: Seen[] = [];
  let put = 0;
  const fn = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    seen.push({ url, method: init.method ?? "GET", headers, body: init.body });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/oauth/token/")) return json({ access_token: "act", refresh_token: "rft", expires_in: 86400, scope: "video.upload,video.publish" });
    if (url.includes("/post/publish/")) {
      const source = JSON.parse(String(init.body)).source_info;
      return json({ data: { publish_id: "v_pub_file~1", ...(source.source === "FILE_UPLOAD" ? { upload_url: "https://open-upload.example/video/?upload_id=1" } : {}) }, error: { code: "ok" } });
    }
    if (url.startsWith("https://open-upload.example/")) {
      const status = chunkStatuses[put++];
      if (status) return new Response("", { status });
      const [, last, total] = /bytes \d+-(\d+)\/(\d+)/.exec(headers["content-range"] ?? "")!;
      return new Response("", { status: Number(last) + 1 === Number(total) ? 201 : 206 });
    }
    throw new Error(`unexpected request to ${url}`);
  });
  return { fn, seen };
}

describe("sending the chunks", () => {
  it("puts each chunk in order with its byte range and type, and no bearer token", async () => {
    const tiktok = fakeTikTok();
    vi.stubGlobal("fetch", tiktok.fn);
    const video = { ...(await localVideo(file("chunks.mp4", 25))), plan: { video_size: 25, chunk_size: 10, total_chunk_count: 2 } };
    const progress: number[] = [];
    await sendChunks("https://open-upload.example/video/?upload_id=1", video, { onProgress: (sent) => progress.push(sent) });
    expect(tiktok.seen.map((s) => s.headers["content-range"])).toEqual(["bytes 0-9/25", "bytes 10-24/25"]);
    expect(tiktok.seen.every((s) => s.method === "PUT" && s.headers["content-type"] === "video/mp4" && !s.headers.authorization)).toBe(true);
    expect(progress).toEqual([10, 25]);
  });

  it("sends a chunk again after a 5xx", async () => {
    const tiktok = fakeTikTok([503]);
    vi.stubGlobal("fetch", tiktok.fn);
    const video = await localVideo(file("retry.mp4", 30));
    await sendChunks("https://open-upload.example/video/?upload_id=1", video, { retryMs: [0] });
    expect(tiktok.seen.map((s) => s.headers["content-range"])).toEqual(["bytes 0-29/30", "bytes 0-29/30"]);
  });

  it("says the upload URL expired on a 403, with the publish_id", async () => {
    vi.stubGlobal("fetch", fakeTikTok([403]).fn);
    const video = await localVideo(file("expired.mp4", 30));
    await expect(sendChunks("https://open-upload.example/video/?upload_id=1", video, { publishId: "v_pub_file~1" })).rejects.toMatchObject({
      message: expect.stringContaining("valid for one hour"),
      details: { publish_id: "v_pub_file~1", status: 403 },
    });
  });
});

describe("post_video and send_video_to_drafts from a file", () => {
  it("refuses to publish a local file without --confirm, before anything reaches TikTok", async () => {
    const tiktok = fakeTikTok();
    vi.stubGlobal("fetch", tiktok.fn);
    const run = await cli(app, ["post-video", "--video-path", file("public.mp4", 30), "--privacy-level", "SELF_ONLY"], { env: BASE });
    expect(run.code).toBe(EXIT.usage);
    expect(JSON.parse(run.stderr).code).toBe("refused");
    expect(run.stderr).toContain("only the TikTok app can delete it");
    expect(run.stderr).toContain("from public.mp4");
    expect(tiktok.fn).not.toHaveBeenCalled();
  });

  it("declares FILE_UPLOAD with the plan, then sends the file", async () => {
    const tiktok = fakeTikTok();
    vi.stubGlobal("fetch", tiktok.fn);
    const run = await cli(app, ["post-video", "--video-path", file("post.mp4", 4096), "--privacy-level", "SELF_ONLY", "--title", "Hi", "--confirm", "--json"], { env: BASE });
    expect(run.code).toBe(0);
    const init = tiktok.seen.find((s) => s.url.includes("/post/publish/video/init/"))!;
    expect(JSON.parse(String(init.body)).source_info).toEqual({ source: "FILE_UPLOAD", video_size: 4096, chunk_size: 4096, total_chunk_count: 1 });
    expect(tiktok.seen.filter((s) => s.method === "PUT").map((s) => s.headers["content-range"])).toEqual(["bytes 0-4095/4096"]);
    expect(JSON.parse(run.stdout)).toMatchObject({ publish_id: "v_pub_file~1", status: "uploaded", source: "FILE_UPLOAD", bytes: 4096, chunks: 1 });
  });

  it("sends a local draft without confirmation, to the inbox endpoint", async () => {
    const tiktok = fakeTikTok();
    vi.stubGlobal("fetch", tiktok.fn);
    const run = await cli(app, ["send-video-to-drafts", "--video-path", file("draft.mov", 100), "--json"], { env: BASE });
    expect(run.code).toBe(0);
    const init = tiktok.seen.find((s) => s.url.includes("/post/publish/inbox/video/init/"))!;
    expect(JSON.parse(String(init.body)).source_info.source).toBe("FILE_UPLOAD");
    expect(tiktok.seen.find((s) => s.method === "PUT")?.headers["content-type"]).toBe("video/quicktime");
  });

  it("still pulls from a URL exactly as before, including the URL as a bare word", async () => {
    const tiktok = fakeTikTok();
    vi.stubGlobal("fetch", tiktok.fn);
    const run = await cli(app, ["send-video-to-drafts", "https://cdn.example.com/clip.mp4", "--json"], { env: BASE });
    expect(run.code).toBe(0);
    const init = tiktok.seen.find((s) => s.url.includes("/post/publish/inbox/video/init/"))!;
    expect(JSON.parse(String(init.body))).toEqual({ source_info: { source: "PULL_FROM_URL", video_url: "https://cdn.example.com/clip.mp4" } });
    expect(JSON.parse(run.stdout)).toEqual({ publish_id: "v_pub_file~1", status: "sent_to_inbox", next: expect.any(String) });
  });

  it("takes one source, not both and not neither, before anything is sent", async () => {
    const tiktok = fakeTikTok();
    vi.stubGlobal("fetch", tiktok.fn);
    const both = await cli(app, ["send-video-to-drafts", "--video-url", "https://cdn.example.com/a.mp4", "--video-path", file("both.mp4", 10)], { env: BASE });
    expect(both.code).toBe(EXIT.usage);
    const neither = await cli(app, ["send-video-to-drafts"], { env: BASE });
    expect(neither.code).toBe(EXIT.usage);
    expect(neither.stderr).toContain("video_path");
    expect(tiktok.fn).not.toHaveBeenCalled();
  });
});
