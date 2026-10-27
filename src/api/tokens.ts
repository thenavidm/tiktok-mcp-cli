/**
 * Where each account's latest tokens live between commands.
 *
 * TikTok can answer a refresh with a new refresh token and retire the one it
 * was sent. Kept in memory only, the new one dies with the process, and every
 * CLI command is a new process: the next one starts again from the token in the
 * environment, which TikTok has already retired, and fails with "Refresh token
 * is invalid or expired" an hour after `login` worked. So every refresh is
 * written here, and every start reads it back.
 *
 * Each entry remembers a hash of the environment token it grew from. The stored
 * tokens are used only while the environment still holds that same token; a new
 * `login` puts a new token in the environment, and that one wins and replaces
 * the entry. The hash is SHA-256 of a long random token, so it says nothing
 * about the token itself.
 *
 * The file is JSON, readable by its owner only (0600, in a 0700 folder),
 * written to a temporary file and renamed into place so a crash or a second
 * process never sees half of it. It holds live credentials: treat it like the
 * client config the refresh token came from.
 */

import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Account } from "../config.js";

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds when the access token stops working. */
  expiresAt: number;
  /** Unix seconds when the refresh token stops working, when TikTok said. */
  refreshExpiresAt?: number;
  scope: string;
  openId: string | null;
};

type Entry = {
  /** SHA-256 of the environment refresh token this entry grew from. */
  seed: string;
  account: string;
  refresh_token: string;
  access_token: string;
  expires_at: number;
  refresh_expires_at?: number;
  scope: string;
  open_id: string | null;
  updated_at: string;
};

type File = { version: 1; accounts: Record<string, Entry> };

/** Where each operating system keeps an app's own data, as Slipway puts it. */
function dataRoot(env: NodeJS.ProcessEnv): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (process.platform === "darwin") return join(home, "Library", "Application Support");
  if (process.platform === "win32") return env.LOCALAPPDATA || join(home, "AppData", "Local");
  return env.XDG_DATA_HOME || join(home, ".local", "share");
}

/**
 * The token file: in `TIKTOK_DATA_DIR`, else in the folder Slipway keeps this
 * app's local data in. When the app runs, `env` is `process.env`; the second
 * look at `process.env` only matters for a caller that hands in a smaller env,
 * such as a test, which must never write to the real folder.
 */
export function tokenStorePath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.TIKTOK_DATA_DIR?.trim() || process.env.TIKTOK_DATA_DIR?.trim() || join(dataRoot(env), "slipway", "tiktok");
  return join(dir, "tokens.json");
}

export const seedOf = (refreshToken: string): string => createHash("sha256").update(refreshToken).digest("hex");

export class TokenStore {
  constructor(readonly file: string) {}

  private load(): File {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<File>;
      if (parsed && typeof parsed.accounts === "object" && parsed.accounts) return { version: 1, accounts: parsed.accounts };
    } catch {
      // No file yet, or one that will not parse: start from the environment.
    }
    return { version: 1, accounts: {} };
  }

  /** How many accounts have tokens saved. */
  count(): number {
    return Object.keys(this.load().accounts).length;
  }

  exists(): boolean {
    return existsSync(this.file);
  }

  /** The latest tokens for an account, if they grew from the refresh token it is configured with now. */
  read(account: Account): Tokens | undefined {
    const entry = this.load().accounts[seedOf(account.refreshToken)];
    if (!entry?.refresh_token) return undefined;
    return {
      accessToken: entry.access_token,
      refreshToken: entry.refresh_token,
      expiresAt: Number(entry.expires_at) || 0,
      ...(entry.refresh_expires_at ? { refreshExpiresAt: entry.refresh_expires_at } : {}),
      scope: entry.scope ?? "",
      openId: entry.open_id ?? null,
    };
  }

  /**
   * Save an account's tokens. An older entry under the same account name, from
   * a refresh token it is no longer configured with, goes: a new login replaced it.
   */
  write(account: Account, tokens: Tokens): void {
    const seed = seedOf(account.refreshToken);
    const data = this.load();
    for (const [key, entry] of Object.entries(data.accounts)) {
      if (key !== seed && entry.account === account.name) delete data.accounts[key];
    }
    data.accounts[seed] = {
      seed,
      account: account.name,
      refresh_token: tokens.refreshToken,
      access_token: tokens.accessToken,
      expires_at: tokens.expiresAt,
      ...(tokens.refreshExpiresAt ? { refresh_expires_at: tokens.refreshExpiresAt } : {}),
      scope: tokens.scope,
      open_id: tokens.openId,
      updated_at: new Date().toISOString(),
    };
    this.save(data);
  }

  /** Drop an account's tokens, after they were handed back to TikTok. */
  forget(account: Account): void {
    const data = this.load();
    const seed = seedOf(account.refreshToken);
    if (!data.accounts[seed]) return;
    delete data.accounts[seed];
    this.save(data);
  }

  private save(data: File): void {
    const dir = dirname(this.file);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, `.tokens.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
    try {
      writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      renameSync(temp, this.file);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
    chmodSync(this.file, 0o600);
  }
}
