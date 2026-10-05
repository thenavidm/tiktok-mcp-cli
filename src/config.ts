/**
 * Settings and accounts, read from the environment.
 *
 * Environment variables rather than CLI flags throughout. A user editing a
 * client config is already inside a JSON `env` block, so a flag means editing
 * `args` separately and getting the quoting right twice.
 */

import { NotConfiguredError, UsageError } from "@thenavidm/slipway";

export type Account = {
  /** Label used to target this account from a tool call. */
  name: string;
  refreshToken: string;
};

export type Config = {
  clientKey: string;
  clientSecret: string;
  accounts: Account[];
  readOnly: boolean;
  allowDestructive: boolean;
  auditLog: string | null;
};

/**
 * Strip whitespace and literal "\n" escape sequences out of an env value.
 *
 * Pasting a secret into a JSON config regularly leaves a trailing literal
 * backslash-n, which is two characters rather than a newline and survives
 * .trim(). TikTok rejects a client_key with one stray character as malformed,
 * and the resulting error names the key rather than the whitespace, so this is
 * worth doing before every credential leaves the process.
 */
export function clean(v: string | undefined): string {
  if (!v) return "";
  return v.replace(/\\[nrt]/g, "").replace(/\s+/g, "").trim();
}

function bool(v: string | undefined): boolean {
  const s = (v || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

/**
 * Accounts come from TIKTOK_REFRESH_TOKEN for the single-account case, or
 * TIKTOK_ACCOUNTS for several.
 *
 * TIKTOK_ACCOUNTS is `name:token` pairs separated by commas. The name is
 * whatever the user wants to say to target it, so it is not cleaned the way a
 * credential is: a label like "Navid Media" has a legitimate space in it.
 */
export function loadAccounts(env: NodeJS.ProcessEnv = process.env): Account[] {
  const multi = env.TIKTOK_ACCOUNTS?.trim();
  if (multi) {
    return multi
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const idx = pair.indexOf(":");
        if (idx === -1) return { name: "default", refreshToken: clean(pair) };
        return {
          name: pair.slice(0, idx).trim() || "default",
          refreshToken: clean(pair.slice(idx + 1)),
        };
      })
      .filter((a) => a.refreshToken.length > 0);
  }
  const single = clean(env.TIKTOK_REFRESH_TOKEN);
  return single ? [{ name: "default", refreshToken: single }] : [];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    clientKey: clean(env.TIKTOK_CLIENT_KEY),
    clientSecret: clean(env.TIKTOK_CLIENT_SECRET),
    accounts: loadAccounts(env),
    readOnly: bool(env.TIKTOK_READ_ONLY),
    allowDestructive: env.TIKTOK_ALLOW_DESTRUCTIVE === undefined ? true : bool(env.TIKTOK_ALLOW_DESTRUCTIVE),
    auditLog: env.TIKTOK_AUDIT_LOG?.trim() || null,
  };
}

/**
 * Pick the account a call targets.
 *
 * Exact match beats prefix match deliberately. A label like "Navid Media"
 * starts with "navid", so a pure prefix search would send an unnamed post to
 * whichever account happened to sort first, which is the worst possible
 * failure mode for a publishing tool.
 */
export function pickAccount(accounts: Account[], want?: string | null): Account {
  if (accounts.length === 0) {
    throw new NotConfiguredError(
      "No TikTok account configured. Run `npx -y @thenavidm/tiktok-mcp-cli auth` to get a refresh token, then set TIKTOK_REFRESH_TOKEN.",
    );
  }
  if (!want) return accounts[0]!;

  const norm = want.trim().toLowerCase().replace(/^@/, "");
  const exact = accounts.find((a) => a.name.toLowerCase() === norm);
  if (exact) return exact;
  const prefix = accounts.filter((a) => a.name.toLowerCase().startsWith(norm));
  if (prefix.length === 1) return prefix[0]!;

  const names = accounts.map((a) => a.name).join(", ");
  if (prefix.length > 1) {
    throw new UsageError(`"${want}" matches more than one account (${names}). Use the full name.`);
  }
  throw new UsageError(`No connected TikTok account named "${want}". Configured: ${names}.`);
}
