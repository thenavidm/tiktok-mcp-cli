/**
 * The two surfaces, now that Slipway builds both from ALL_TOOLS.
 *
 * Parsing, help and the exit-code contract are Slipway's and tested there. What
 * matters here: every tool arrives on both surfaces intact, publishing still
 * asks first and still disappears with destructive writes off, `auth` still
 * signs in as 1.1 named it, TikTok's errors keep their exit codes, and the
 * docs stay in step with the code.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXIT } from "@thenavidm/slipway";
import { checkApp, cli, connect } from "@thenavidm/slipway/testing";
import { TikTokError } from "../src/api/errors.js";
import { app } from "../src/app.js";
import { ALL_TOOLS } from "../src/tools/index.js";
import { toSlipway } from "../src/tools/kit.js";

const BASE = { TIKTOK_CLIENT_KEY: "key", TIKTOK_CLIENT_SECRET: "secret", TIKTOK_REFRESH_TOKEN: "refresh" };
const NOTHING = { TIKTOK_CLIENT_KEY: "", TIKTOK_CLIENT_SECRET: "", TIKTOK_REFRESH_TOKEN: "", TIKTOK_ACCOUNTS: "" };
const post = ["post-video", "--video-url", "https://example.com/v.mp4", "--privacy-level", "SELF_ONLY"];

describe("TikTok on Slipway", () => {
  it("offers every tool as a command and over MCP, under the same names", async () => {
    const list = await cli(app, [], { env: BASE });
    for (const tool of ALL_TOOLS) expect(list.stdout).toContain(tool.command);
    const mcp = await connect(app, { env: BASE });
    const names = (await mcp.listTools()).map((tool) => tool.name).sort();
    await mcp.close();
    expect(names).toEqual(ALL_TOOLS.map((tool) => tool.name).sort());
  });

  it("refuses to publish without --confirm, before anything reaches TikTok", async () => {
    const run = await cli(app, post, { env: BASE });
    expect(run.code).toBe(2);
    expect(JSON.parse(run.stderr).code).toBe("refused");
    expect(run.stderr).toContain("--confirm");
  });

  it("takes publishing off the list with TIKTOK_ALLOW_DESTRUCTIVE=0, as 1.1 did, and refuses it if called", async () => {
    const off = { ...BASE, TIKTOK_ALLOW_DESTRUCTIVE: "0" };
    const list = await cli(app, [], { env: off });
    expect(list.stdout).not.toContain("post-video");
    expect(list.stdout).toContain("send-video-to-drafts");
    expect(list.stdout).toContain("3 irreversible writes are hidden by TIKTOK_ALLOW_DESTRUCTIVE=0.");
    const run = await cli(app, [...post, "--confirm"], { env: off });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("TIKTOK_ALLOW_DESTRUCTIVE=0");
  });

  it("calls a run with nothing configured not configured, exit 10", async () => {
    expect((await cli(app, ["get-profile"], { env: NOTHING })).code).toBe(EXIT.notConfigured);
    expect((await cli(app, ["doctor"], { env: NOTHING })).code).toBe(EXIT.notConfigured);
  });

  it("keeps 1.1's `auth` beside `login`, and both say what they need first", async () => {
    const auth = await cli(app, ["auth"], { env: NOTHING });
    expect(auth.code).toBe(EXIT.notConfigured);
    expect(auth.stderr).toContain("TIKTOK_CLIENT_KEY");
    expect((await cli(app, ["login"], { env: NOTHING })).code).toBe(EXIT.notConfigured);
    expect((await cli(app, ["login", "--help"], { env: NOTHING })).stdout).toContain("Usage: tiktok-cli login [--publish] [--port N]");
  });

  it("passes slipway check", async () => {
    const report = await checkApp(app, { env: BASE });
    expect(report.findings.filter((finding) => finding.level === "error")).toEqual([]);
  });
});

describe("TikTok's errors keep their exit codes and their log id", () => {
  it.each([
    ["scope_not_authorized", 403, EXIT.auth],
    ["access_token_invalid", 401, EXIT.auth],
    ["rate_limit_exceeded", 429, EXIT.rateLimited],
    ["spam_risk_too_many_posts", 403, EXIT.rateLimited],
    ["privacy_level_option_mismatch", 400, EXIT.usage],
    ["url_ownership_unverified", 403, EXIT.usage],
    ["invalid_publish_id", 400, EXIT.notFound],
    ["spam_risk_user_banned_from_posting", 403, EXIT.usage],
  ])("%s exits %i", (code, status, exit) => {
    const error = toSlipway(new TikTokError("TikTok said no.", code, status, "log-1"));
    expect(error.exitCode).toBe(exit);
    expect(error.details).toMatchObject({ tiktok_code: code, log_id: "log-1" });
  });

  it("goes by status when TikTok sends no code, and calls a failure with nothing to go on TikTok's", () => {
    expect(toSlipway(new TikTokError("TikTok returned HTTP 503", undefined, 503)).exitCode).toBe(EXIT.api);
    expect(toSlipway(new TikTokError("Something odd", undefined, 0)).exitCode).toBe(EXIT.api);
  });
});

describe("documentation stays in step with the code", () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf-8");
  // TIKTOK_API is the API root in src/api/client.ts, a constant, not a setting.
  const names = (text: string): Set<string> => new Set((text.match(/TIKTOK_[A-Z_]+/g) ?? []).filter((name) => !name.endsWith("_") && name !== "TIKTOK_API"));
  const source = (dir: string): string =>
    readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
      .map((entry) => (entry.isDirectory() ? source(`${dir}${entry.name}/`) : entry.name.endsWith(".ts") ? read(`${dir}${entry.name}`) : ""))
      .join("\n");

  /** Every variable the server reads: this repo's code, and Slipway's as agent-context lists them. */
  const used = async (): Promise<Set<string>> => {
    const context = JSON.parse((await cli(app, ["agent-context"], { env: BASE })).stdout);
    return new Set([...names(source("../src/")), ...context.settings.map((setting: { env: string }) => setting.env)]);
  };

  it("documents every environment variable the code reads", async () => {
    const documented = names(read("../README.md"));
    expect([...(await used())].filter((v) => !documented.has(v))).toEqual([]);
  });

  // Since Slipway 0.1.15 the help names the settings that connect an account and the safety
  // switches, and counts the rest, which agent-context describes one by one.
  it("names every environment variable in --help or agent-context", async () => {
    const help = (await cli(app, ["--help"], { env: BASE })).stdout;
    const context = JSON.parse((await cli(app, ["agent-context"], { env: BASE })).stdout);
    const described = new Set(context.settings.map((setting: { env: string }) => setting.env));
    expect([...(await used())].filter((v) => !help.includes(v) && !described.has(v))).toEqual([]);
  });

  it.each(["../README.md", "../INSTALL.md"])("has no dead in-page anchors in %s", (file) => {
    if (!existsSync(new URL(file, import.meta.url))) return; // repo may ship one doc
    const md = read(file).replace(/```[\s\S]*?```/g, "");
    // GitHub's slug keeps letters, marks, numbers and connector punctuation, so an
    // emoji's variation selector (U+FE0F) stays in the anchor and a link has to carry it.
    const slugs = new Set(
      [...md.matchAll(/^#{1,6} (.+)$/gm)].map(([, heading]) =>
        (heading as string).trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\s-]/gu, "").replace(/ /g, "-"),
      ),
    );
    const dead = [...md.matchAll(/\[[^\]]+\]\(#([^)]+)\)/g)]
      .map((m) => decodeURIComponent(m[1] as string))
      .filter((a) => !slugs.has(a));
    expect(dead).toEqual([]);
  });
});
