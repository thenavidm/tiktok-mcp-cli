import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TikTokClient } from "../src/api/client.js";
import { TikTokError, unwrap } from "../src/api/errors.js";
import { loadAccounts, loadConfig, pickAccount } from "../src/config.js";

/** A fresh token store each time, so a token saved by one test never answers for the next. */
const config = () =>
  loadConfig({
    TIKTOK_CLIENT_KEY: "key",
    TIKTOK_CLIENT_SECRET: "secret",
    TIKTOK_REFRESH_TOKEN: "refresh",
    TIKTOK_DATA_DIR: mkdtempSync(join(tmpdir(), "tiktok-api-")),
  } as NodeJS.ProcessEnv);

const ACCOUNT = { name: "default", refreshToken: "refresh" };

/** A fetch stand-in that records what was sent and replays queued responses. */
function fakeFetch(responses: { status?: number; body: unknown }[]) {
  const calls: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const next = responses.shift() ?? { status: 200, body: {} };
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return {
      ok: (next.status ?? 200) >= 200 && (next.status ?? 200) < 300,
      status: next.status ?? 200,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    } as unknown as Response;
  });
  return { fn, calls };
}

afterEach(() => vi.unstubAllGlobals());

describe("error envelope", () => {
  it("throws on a non-ok error code even when the status is 200", () => {
    /* TikTok answers HTTP 200 with an error code for a whole class of
       failures. Trusting the status reports success on a call that did
       nothing, which is the single most expensive mistake against this API. */
    expect(() => unwrap(200, { error: { code: "spam_risk_too_many_posts", message: "" } })).toThrow(
      TikTokError,
    );
  });

  it("passes the data through when the code is ok", () => {
    expect(unwrap(200, { data: { user: { username: "navid" } }, error: { code: "ok" } })).toEqual({
      user: { username: "navid" },
    });
  });

  it("explains scope_not_authorized instead of echoing the code", () => {
    try {
      unwrap(401, { error: { code: "scope_not_authorized" } });
      expect.unreachable();
    } catch (error) {
      expect((error as TikTokError).message).toContain("video.publish");
      expect((error as TikTokError).message).toContain("tiktok-mcp auth");
    }
  });

  it("keeps the log id so a TikTok support ticket can reference it", () => {
    try {
      unwrap(400, { error: { code: "invalid_param", message: "bad", log_id: "abc123" } });
      expect.unreachable();
    } catch (error) {
      expect((error as TikTokError).logId).toBe("abc123");
    }
  });
});

describe("client", () => {
  it("refreshes before the first call and sends the access token", async () => {
    const { fn, calls } = fakeFetch([
      { body: { access_token: "act", refresh_token: "rft", expires_in: 86400, scope: "video.list" } },
      { body: { data: { videos: [] }, error: { code: "ok" } } },
    ]);
    vi.stubGlobal("fetch", fn);

    const client = new TikTokClient(config(), ACCOUNT);
    await client.request("POST", "/video/list/", { fields: "id", body: { max_count: 20 } });

    expect(calls[0]!.url).toContain("/oauth/token/");
    expect(calls[1]!.headers.Authorization).toBe("Bearer act");
    /* The verb actually sent matters: a client that branches on GET versus
       everything-else will send a POST where it meant something else, the API
       answers 200, and the tool reports success while changing nothing. */
    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.url).toContain("fields=id");
  });

  it("keeps a rotated refresh token rather than the one it was given", async () => {
    const { fn, calls } = fakeFetch([
      { body: { access_token: "a1", refresh_token: "rotated", expires_in: 86400 } },
      { status: 401, body: {} },
      { body: { access_token: "a2", refresh_token: "rotated2", expires_in: 86400 } },
      { body: { data: {}, error: { code: "ok" } } },
    ]);
    vi.stubGlobal("fetch", fn);

    const client = new TikTokClient(config(), ACCOUNT);
    await client.request("GET", "/user/info/");

    /* Second refresh must send the rotated token, not the original. Sending
       the original kills the account at the next refresh rather than the next
       call, which is far harder to trace. */
    expect(String(calls[2]!.body)).toContain("refresh_token=rotated");
    expect(String(calls[2]!.body)).not.toContain("refresh_token=refresh");
  });

  it("retries once on a 401 from a token revoked mid-session", async () => {
    const { fn } = fakeFetch([
      { body: { access_token: "a1", refresh_token: "r", expires_in: 86400 } },
      { status: 401, body: {} },
      { body: { access_token: "a2", refresh_token: "r", expires_in: 86400 } },
      { body: { data: { ok: true }, error: { code: "ok" } } },
    ]);
    vi.stubGlobal("fetch", fn);

    const client = new TikTokClient(config(), ACCOUNT);
    await expect(client.request("GET", "/user/info/")).resolves.toEqual({ ok: true });
  });

  it("explains an expired refresh token rather than reporting a raw 400", async () => {
    const { fn } = fakeFetch([{ status: 400, body: { error: "invalid_grant" } }]);
    vi.stubGlobal("fetch", fn);

    const client = new TikTokClient(config(), ACCOUNT);
    await expect(client.request("GET", "/user/info/")).rejects.toThrow(/365 days|tiktok-mcp auth/);
  });
});

describe("accounts", () => {
  it("reads a single account from TIKTOK_REFRESH_TOKEN", () => {
    expect(loadAccounts({ TIKTOK_REFRESH_TOKEN: "abc" } as NodeJS.ProcessEnv)).toEqual([
      { name: "default", refreshToken: "abc" },
    ]);
  });

  it("reads several from TIKTOK_ACCOUNTS", () => {
    const accounts = loadAccounts({
      TIKTOK_ACCOUNTS: "personal:tok1, Navid Media:tok2",
    } as NodeJS.ProcessEnv);
    expect(accounts).toEqual([
      { name: "personal", refreshToken: "tok1" },
      { name: "Navid Media", refreshToken: "tok2" },
    ]);
  });

  it("strips a pasted literal backslash-n out of a token", () => {
    /* Pasting a secret into a JSON config leaves a literal \n, which is two
       characters and survives trim(). TikTok then rejects the credential and
       names the key rather than the whitespace. */
    expect(loadAccounts({ TIKTOK_REFRESH_TOKEN: "abc\\n" } as NodeJS.ProcessEnv)[0]!.refreshToken).toBe("abc");
  });

  it("prefers an exact name match over a prefix match", () => {
    const accounts = [
      { name: "navid", refreshToken: "a" },
      { name: "navid media", refreshToken: "b" },
    ];
    /* "navid" is a prefix of "navid media". A pure prefix search would make
       this ambiguous and could send an unnamed post to the wrong account. */
    expect(pickAccount(accounts, "navid").refreshToken).toBe("a");
  });

  it("refuses an ambiguous prefix rather than guessing", () => {
    const accounts = [
      { name: "brand one", refreshToken: "a" },
      { name: "brand two", refreshToken: "b" },
    ];
    expect(() => pickAccount(accounts, "brand")).toThrow(/more than one/);
  });

  it("points at the auth command when nothing is configured", () => {
    expect(() => pickAccount([], undefined)).toThrow(/tiktok-mcp-cli auth/);
  });
});
