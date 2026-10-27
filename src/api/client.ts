import type { Account, Config } from "../config.js";
import { TikTokError, unwrap } from "./errors.js";
import { TokenStore, type Tokens } from "./tokens.js";
import { AuthError, NotConfiguredError } from "@thenavidm/slipway";

export type { Tokens } from "./tokens.js";

export const TIKTOK_API = "https://open.tiktokapis.com/v2";
export const TOKEN_URL = `${TIKTOK_API}/oauth/token/`;
export const REVOKE_URL = `${TIKTOK_API}/oauth/revoke/`;
export const AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";

/** Display API scopes. Publishing scopes are added only once the app has them. */
export const READ_SCOPES = ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"];
export const PUBLISH_SCOPES = ["video.upload", "video.publish"];

/**
 * The upstream client, one per account.
 *
 * The reason this holds state at all is that TikTok access tokens live 24
 * hours, which is far shorter than most platforms. A server that mints one at
 * startup works on the day it is installed and fails every day after. So the
 * client caches an access token and refreshes it when it is close to expiry,
 * which means a long-running server never hands the user a token problem they
 * have to think about.
 *
 * The cache is on disk as well as in memory (`tokens.ts`), because a refresh
 * can rotate the refresh token, and a CLI command is a process of its own: the
 * next one has to start from the token this one was handed, not from the one
 * in the environment that TikTok has retired.
 */
export class TikTokClient {
  private tokens: Tokens | null = null;
  private loaded = false;
  private readonly store: TokenStore;

  constructor(
    private readonly config: Config,
    readonly account: Account,
  ) {
    this.store = new TokenStore(config.tokenStore);
  }

  /** What was saved by the last command or server that refreshed this account, read once. */
  private loadSaved(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.tokens = this.store.read(this.account) ?? null;
  }

  /**
   * Save after every refresh. A file that cannot be written must not fail the
   * call that just worked, but the next command will start from a retired
   * token, so it is said once on stderr. Never with the token in it.
   */
  private save(tokens: Tokens): void {
    try {
      this.store.write(this.account, tokens);
    } catch (error) {
      process.stderr.write(
        `[tiktok] Could not save the refreshed token to ${this.store.file} (${(error as NodeJS.ErrnoException).code ?? (error as Error).message}). TikTok may have retired the one in your config; if the next command is refused, run \`tiktok-cli login\` again or set TIKTOK_DATA_DIR to a writable folder.\n`,
      );
    }
  }

  /** Exposed so `doctor` can report what the account actually granted. */
  get grantedScope(): string | null {
    return this.tokens?.scope ?? null;
  }

  get openId(): string | null {
    return this.tokens?.openId ?? null;
  }

  private async refresh(): Promise<Tokens> {
    const { clientKey, clientSecret } = this.config;
    if (!clientKey || !clientSecret) {
      throw new NotConfiguredError(
        "TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET are not set. Both come from your app on the TikTok for Developers site.",
      );
    }
    this.loadSaved();

    /* Another command or server may have refreshed since this one read the
       file, and TikTok may have retired the token this one holds. Its newer
       access token is as good as a refresh, and its refresh token is the one
       TikTok will still take. */
    const latest = this.store.read(this.account);
    if (latest && latest.accessToken !== this.tokens?.accessToken) {
      this.tokens = latest;
      if (Math.floor(Date.now() / 1000) < latest.expiresAt - 300) return latest;
    }

    try {
      return await this.refreshWith(this.tokens?.refreshToken ?? this.account.refreshToken);
    } catch (error) {
      // Lost a race: the token was rotated by another process between the read above and this refresh.
      const after = this.store.read(this.account);
      if (error instanceof AuthError && after && after.refreshToken !== (this.tokens?.refreshToken ?? this.account.refreshToken)) {
        this.tokens = after;
        if (Math.floor(Date.now() / 1000) < after.expiresAt - 300) return after;
        return this.refreshWith(after.refreshToken);
      }
      throw error;
    }
  }

  private async refreshWith(refreshToken: string): Promise<Tokens> {
    const { clientKey, clientSecret } = this.config;
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    /* The token endpoint does NOT use the {data, error} envelope the rest of
       the API uses. It answers OAuth-style with a flat `error` string, so it
       cannot go through unwrap(). */
    if (!res.ok || typeof body.access_token !== "string") {
      const detail = String(body.error_description || body.error || `HTTP ${res.status}`).replace(/\.+$/, "");
      const message = `Could not refresh the TikTok access token: ${detail}. Refresh tokens last 365 days; run \`tiktok-cli login\` to mint a new one.`;
      // TikTok failing is TikTok's; anything else here is the credential, exit 4, as in 1.1.
      if (res.status >= 500) throw new TikTokError(message, typeof body.error === "string" ? body.error : undefined, res.status);
      throw new AuthError(message, { status: res.status, ...(typeof body.error === "string" ? { details: { tiktok_code: body.error } } : {}) });
    }

    const expiresIn = Number(body.expires_in ?? 86400);
    const now = Math.floor(Date.now() / 1000);
    const refreshExpiresIn = Number(body.refresh_expires_in);
    this.tokens = {
      accessToken: body.access_token,
      /* TikTok may hand back a different refresh token than the one sent, and
         retire the old one. Keep the new one, in memory and on disk: dropping
         it kills the account at the next refresh, or at the next command,
         which is far harder to trace back to here. */
      refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : refreshToken,
      expiresAt: now + expiresIn,
      ...(Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0 ? { refreshExpiresAt: now + refreshExpiresIn } : {}),
      scope: typeof body.scope === "string" ? body.scope : "",
      openId: typeof body.open_id === "string" ? body.open_id : null,
    };
    this.save(this.tokens);
    return this.tokens;
  }

  /** Refresh five minutes early so a call never races the expiry. */
  private async accessToken(): Promise<string> {
    this.loadSaved();
    const now = Math.floor(Date.now() / 1000);
    if (!this.tokens || now > this.tokens.expiresAt - 300) await this.refresh();
    return this.tokens!.accessToken;
  }

  async request(
    method: "GET" | "POST",
    path: string,
    opts: { fields?: string; body?: unknown } = {},
  ): Promise<unknown> {
    const url = new URL(`${TIKTOK_API}${path}`);
    if (opts.fields) url.searchParams.set("fields", opts.fields);

    const send = async (token: string): Promise<Response> =>
      fetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        ...(method === "POST" ? { body: JSON.stringify(opts.body ?? {}) } : {}),
      });

    let res = await send(await this.accessToken());

    /* One retry on 401. The cached token can be revoked from the TikTok app
       mid-session, in which case it is not expired by the clock but is dead,
       and only a refresh finds that out. */
    if (res.status === 401) {
      const dead = this.tokens?.accessToken;
      await this.refresh();
      // A refresh that only found the same token on disk has not fixed anything: make a real one.
      if (this.tokens?.accessToken === dead) await this.refreshWith(this.tokens!.refreshToken);
      res = await send(this.tokens!.accessToken);
    }

    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return unwrap(res.status, body);
  }

  /** Hand the token back to TikTok. The account disappears from its app list. */
  async revoke(): Promise<void> {
    const token = await this.accessToken();
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: this.config.clientKey,
        client_secret: this.config.clientSecret,
        token,
      }).toString(),
    });
    this.tokens = null;
    // A revoked token is no use to the next command.
    try {
      this.store.forget(this.account);
    } catch {
      // Nothing to forget, or nowhere to write: either way the token is dead.
    }
  }
}
