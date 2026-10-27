/**
 * TikTok rotates refresh tokens, and every CLI command is a process of its own.
 *
 * The bug this guards: a refresh handed back a new refresh token and retired
 * the old one, the new one lived only in memory, and the next command started
 * again from the retired token in the environment and was refused. What
 * matters: the newest tokens survive the process, a new login in the
 * environment replaces them, two processes refreshing at once both end up with
 * a live token, the file is readable by its owner only, and no token is ever
 * printed. Nothing here reaches the network or a real account.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cli } from "@thenavidm/slipway/testing";
import { TikTokClient } from "../src/api/client.js";
import { TokenStore, seedOf, tokenStorePath } from "../src/api/tokens.js";
import { app } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const KEY = { TIKTOK_CLIENT_KEY: "key", TIKTOK_CLIENT_SECRET: "secret" };

function setup(refreshToken = "R0") {
  const dir = mkdtempSync(join(tmpdir(), "tiktok-tokens-"));
  const env = { ...KEY, TIKTOK_REFRESH_TOKEN: refreshToken, TIKTOK_DATA_DIR: dir } as NodeJS.ProcessEnv;
  return { dir, env, file: join(dir, "tokens.json") };
}

/**
 * A fake TikTok that rotates: each refresh token works once, and the answer
 * carries the next one. `expiresIn` sets how long the access token lives.
 */
function rotatingTikTok(options: { expiresIn?: number } = {}) {
  const retired = new Set<string>();
  const refreshes: string[] = [];
  let issued = 0;
  const fn = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (url.includes("/oauth/token/")) {
      const sent = new URLSearchParams(String(init.body)).get("refresh_token")!;
      refreshes.push(sent);
      if (retired.has(sent)) {
        return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Refresh token is invalid or expired." }), { status: 400 });
      }
      retired.add(sent);
      issued++;
      return new Response(
        JSON.stringify({ access_token: `A${issued}`, refresh_token: `R${issued}`, expires_in: options.expiresIn ?? 86400, refresh_expires_in: 31536000, scope: "user.info.basic,video.upload", open_id: "open-1" }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ data: { user: { username: "creator" } }, error: { code: "ok" } }), { status: 200 });
  });
  return { fn, refreshes, retire: (token: string) => retired.add(token) };
}

afterEach(() => vi.unstubAllGlobals());

describe("the token store", () => {
  it("lives in TIKTOK_DATA_DIR, else in this app's Slipway data folder", () => {
    expect(tokenStorePath({ TIKTOK_DATA_DIR: "/data/tiktok" })).toBe("/data/tiktok/tokens.json");
    const saved = process.env.TIKTOK_DATA_DIR;
    delete process.env.TIKTOK_DATA_DIR;
    try {
      expect(tokenStorePath({ HOME: "/home/me" })).toMatch(/\/home\/me\/.+\/slipway\/tiktok\/tokens\.json$/);
    } finally {
      process.env.TIKTOK_DATA_DIR = saved;
    }
  });

  it("keeps the rotated token for the next process, and the next one starts from it", async () => {
    const { env } = setup("R0");
    const tiktok = rotatingTikTok({ expiresIn: 60 }); // inside the five-minute margin, so every client refreshes
    vi.stubGlobal("fetch", tiktok.fn);

    const account = loadConfig(env).accounts[0]!;
    await new TikTokClient(loadConfig(env), account).request("GET", "/user/info/");
    // A new client reads only what is on disk, as a new command would.
    await new TikTokClient(loadConfig(env), account).request("GET", "/user/info/");
    await new TikTokClient(loadConfig(env), account).request("GET", "/user/info/");

    expect(tiktok.refreshes).toEqual(["R0", "R1", "R2"]);
  });

  it("uses a saved access token that is still good without refreshing at all", async () => {
    const { env } = setup("R0");
    const tiktok = rotatingTikTok();
    vi.stubGlobal("fetch", tiktok.fn);
    const account = loadConfig(env).accounts[0]!;
    await new TikTokClient(loadConfig(env), account).request("GET", "/user/info/");
    const second = new TikTokClient(loadConfig(env), account);
    await second.request("GET", "/user/info/");
    expect(tiktok.refreshes).toEqual(["R0"]);
    expect(second.grantedScope).toBe("user.info.basic,video.upload");
  });

  it("starts from the environment again after a new login, and replaces the old entry", async () => {
    const first = setup("R0");
    const tiktok = rotatingTikTok({ expiresIn: 60 });
    vi.stubGlobal("fetch", tiktok.fn);
    const before = loadConfig(first.env);
    await new TikTokClient(before, before.accounts[0]!).request("GET", "/user/info/");

    // `tiktok-cli login` again: a new token in the environment, same account name.
    const env = { ...first.env, TIKTOK_REFRESH_TOKEN: "NEW" };
    const after = loadConfig(env);
    await new TikTokClient(after, after.accounts[0]!).request("GET", "/user/info/");

    expect(tiktok.refreshes).toEqual(["R0", "NEW"]);
    const saved = JSON.parse(readFileSync(first.file, "utf8")).accounts;
    expect(Object.keys(saved)).toEqual([seedOf("NEW")]);
    expect(saved[seedOf("NEW")]).toMatchObject({ account: "default", refresh_token: "R2" });
  });

  it("recovers when another process rotated the token first", async () => {
    const { env } = setup("R0");
    const tiktok = rotatingTikTok({ expiresIn: 60 });
    vi.stubGlobal("fetch", tiktok.fn);
    const account = loadConfig(env).accounts[0]!;
    await new TikTokClient(loadConfig(env), account).request("GET", "/user/info/"); // R0 -> R1 saved

    // Two commands start together; both read R1. One refreshes first and saves R2.
    const slow = new TikTokClient(loadConfig(env), account);
    const fast = new TikTokClient(loadConfig(env), account);
    (slow as unknown as { loadSaved(): void }).loadSaved(); // slow has read R1 from disk
    await fast.request("GET", "/user/info/");
    await slow.request("GET", "/user/info/");

    // The slow one found the fast one's R2 on disk rather than sending the retired R1.
    expect(tiktok.refreshes).toEqual(["R0", "R1", "R2"]);
  });

  it("is readable by its owner only, in a folder only its owner can enter", async () => {
    const { env, dir, file } = setup("R0");
    vi.stubGlobal("fetch", rotatingTikTok().fn);
    const account = loadConfig(env).accounts[0]!;
    await new TikTokClient(loadConfig(env), account).request("GET", "/user/info/");
    if (process.platform === "win32") return;
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o077).toBe(0);
    // Written whole: no temporary file is left beside it.
    expect(new TokenStore(file).count()).toBe(1);
  });

  it("forgets an account whose token was revoked", async () => {
    const { env, file } = setup("R0");
    vi.stubGlobal("fetch", rotatingTikTok().fn);
    const config = loadConfig(env);
    const client = new TikTokClient(config, config.accounts[0]!);
    await client.request("GET", "/user/info/");
    await client.revoke();
    expect(new TokenStore(file).count()).toBe(0);
  });

  it("says where the store is in doctor, and never prints a token", async () => {
    const { env, file } = setup("R0-secret-refresh");
    const tiktok = rotatingTikTok();
    vi.stubGlobal("fetch", tiktok.fn);
    const run = await cli(app, ["doctor", "--network"], { env });
    const out = run.stdout + run.stderr;
    expect(out).toContain(file);
    expect(out).not.toMatch(/R0-secret-refresh|\bR1\b|\bA1\b/);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("R1");
  });
});

/**
 * The bug as it happened: two separate CLI processes, the first one's refresh
 * rotating the token. Runs the built CLI with a fake TikTok put in front of
 * fetch, so it needs `npm run build` first, as CI does.
 */
const built = fileURLToPath(new URL("../dist/index.js", import.meta.url));
describe.skipIf(!existsSync(built))("two real CLI processes", () => {
  it("the second command refreshes with the token the first one was handed", () => {
    const dir = mkdtempSync(join(tmpdir(), "tiktok-procs-"));
    const state = join(dir, "fake-tiktok.json");
    writeFileSync(state, JSON.stringify({ retired: [], refreshes: [] }));
    const fake = join(dir, "fake-tiktok.mjs");
    writeFileSync(
      fake,
      `import { readFileSync, writeFileSync } from "node:fs";
const state = ${JSON.stringify(state)};
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const s = JSON.parse(readFileSync(state, "utf8"));
  if (url.includes("/oauth/token/")) {
    const sent = new URLSearchParams(String(init.body)).get("refresh_token");
    s.refreshes.push(sent);
    if (s.retired.includes(sent)) {
      writeFileSync(state, JSON.stringify(s));
      return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Refresh token is invalid or expired." }), { status: 400 });
    }
    s.retired.push(sent);
    writeFileSync(state, JSON.stringify(s));
    const n = s.retired.length;
    return new Response(JSON.stringify({ access_token: "A" + n, refresh_token: "R" + n, expires_in: 60, scope: "user.info.basic" }), { status: 200 });
  }
  return new Response(JSON.stringify({ data: { user: { username: "creator" } }, error: { code: "ok" } }), { status: 200 });
};
`,
    );
    const env = { PATH: process.env.PATH, HOME: dir, ...KEY, TIKTOK_REFRESH_TOKEN: "R0", TIKTOK_DATA_DIR: join(dir, "data") };
    const run = () => spawnSync(process.execPath, ["--import", fake, built, "get-profile", "--json"], { env, encoding: "utf8" });

    const first = run();
    const second = run();
    expect(first.status, first.stderr).toBe(0);
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(readFileSync(state, "utf8")).refreshes).toEqual(["R0", "R1"]);
    expect(first.stdout + first.stderr + second.stdout + second.stderr).not.toMatch(/\bR[0-9]\b|\bA[0-9]\b/);
  });
});
