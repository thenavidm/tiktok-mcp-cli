/**
 * Shared plumbing every tool uses, now on Slipway.
 *
 * Tool modules keep describing themselves with a Zod shape, a risk and a
 * handler. This adapter turns each into a Slipway tool, so the MCP server, the
 * CLI, the write guard, annotations and errors all come from the framework
 * instead of a copy kept in this repo.
 */

import {
  ApiError,
  AuthError,
  NotFoundError,
  RateLimitError,
  RefusedError,
  SlipwayError,
  UsageError,
  httpError,
  toSlipwayError,
  toolkit,
  z,
  type Risk,
  type Tool,
} from "@thenavidm/slipway";
import { TikTokClient } from "../api/client.js";
import { TikTokError } from "../api/errors.js";
import { pickAccount, type Account, type Config } from "../config.js";

export type ToolContext = {
  config: Config;
  /** An authenticated client for the account this call targets. */
  client: (hint?: string) => TikTokClient;
  account: (hint?: string) => Account;
};

const kit = toolkit<ToolContext>();

/** The optional argument that picks an account, on every account-scoped tool. */
export const accountArg = {
  account: z
    .string()
    .optional()
    .describe(
      "Which connected TikTok account to act as, by the name you gave it in TIKTOK_ACCOUNTS. Defaults to the first. Call list_accounts to see them.",
    ),
};

/**
 * Kept so tool modules read the same, but never sent: Slipway adds `confirm`
 * to every irreversible tool itself, with one description everywhere.
 */
export const confirmArg = {
  confirm: z.boolean().optional(),
};

type Shape = Record<string, z.ZodType>;

export type ToolSpec<S extends Shape> = {
  name: string;
  /** One line, imperative. Shown in tool pickers. */
  title: string;
  description: string;
  schema: S;
  risk: Risk;
  idempotent?: boolean;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
  /** One line for the audit log and the confirm message, when this is a write. */
  summary?: (args: z.infer<z.ZodObject<S>>) => string;
};

export type AnyToolSpec = Tool<ToolContext>;

/** TikTok's own error code says more than its HTTP status, so it picks the exit code first. */
const BY_CODE: Record<string, (message: string) => SlipwayError> = {
  scope_not_authorized: (m) => new AuthError(m),
  access_token_invalid: (m) => new AuthError(m),
  rate_limit_exceeded: (m) => new RateLimitError(m),
  spam_risk_too_many_posts: (m) => new RateLimitError(m),
  spam_risk_too_many_pending_share: (m) => new RateLimitError(m),
  reached_active_user_cap: (m) => new RateLimitError(m),
  spam_risk_user_banned_from_posting: (m) => new RefusedError(m),
  unaudited_client_can_only_post_to_private_accounts: (m) => new UsageError(m),
  url_ownership_unverified: (m) => new UsageError(m),
  privacy_level_option_mismatch: (m) => new UsageError(m),
  invalid_publish_id: (m) => new NotFoundError(m),
};

/**
 * TikTok's code, then the HTTP status, then the words, pick the exit code. The
 * code and TikTok's log id ride along in `details`, since the log id is what
 * TikTok's support asks for.
 */
export function toSlipway(error: TikTokError): SlipwayError {
  const base =
    (error.code ? BY_CODE[error.code]?.(error.message) : undefined) ??
    (error.status >= 400 ? httpError(error.status, error.message) : toSlipwayError(new Error(error.message)));
  // A failure with nothing to go on is TikTok's, exit 5, as in 1.1.
  const known = base.code === "internal" ? new ApiError(error.message) : base;
  const details = { ...(error.code ? { tiktok_code: error.code } : {}), ...(error.logId ? { log_id: error.logId } : {}) };
  return new SlipwayError(known.message, known.code, known.exitCode, {
    ...(known.hint ? { hint: known.hint } : {}),
    ...(error.status ? { status: error.status } : {}),
    ...(Object.keys(details).length ? { details } : {}),
    cause: error,
  });
}

export function defineTool<S extends Shape>(spec: ToolSpec<S>): Tool<ToolContext> {
  const { confirm: _confirm, ...shape } = spec.schema as Shape;
  const handler = spec.handler as (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
  return kit.defineTool({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    input: z.object(shape),
    risk: spec.risk,
    ...(spec.idempotent !== undefined ? { idempotent: spec.idempotent } : {}),
    ...(spec.summary ? { summary: spec.summary as (args: Record<string, unknown>) => string } : {}),
    handler: async (args, ctx) => {
      try {
        return await handler(args, ctx);
      } catch (error) {
        throw error instanceof TikTokError ? toSlipway(error) : error;
      }
    },
  });
}

export function makeContext(config: Config): ToolContext {
  /* One client per account, built once and kept, because the client caches the
     24-hour access token. Rebuilding it per call would mint a fresh token on
     every tool invocation and hit TikTok's rate limit on a busy session. */
  const clients = new Map<string, TikTokClient>();
  return {
    config,
    account: (hint?: string) => pickAccount(config.accounts, hint),
    client: (hint?: string) => {
      const account = pickAccount(config.accounts, hint);
      let client = clients.get(account.name);
      if (!client) {
        client = new TikTokClient(config, account);
        clients.set(account.name, client);
      }
      return client;
    },
  };
}

export function clamp(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}
