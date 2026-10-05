/**
 * `tiktok-cli login [--publish] [--port N]`, also `auth` as 1.1 named it: get a
 * refresh token through TikTok's desktop flow.
 *
 * The token goes to stdout on its own line and everything else to stderr, so
 * `tiktok-cli login > token.txt` captures the token and nothing else. Exit
 * codes follow the CLI's: 10 when the TikTok app is not set yet, 4 when TikTok
 * refused the sign-in.
 */

import type { CliIO } from "@thenavidm/slipway";
import { runAuth } from "./auth.js";
import { loadConfig } from "./config.js";

function flagValue(args: readonly string[], name: string): string | undefined {
  const withEquals = args.find((token) => token.startsWith(`${name}=`));
  if (withEquals) return withEquals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export async function runLogin(io: CliIO, args: readonly string[]): Promise<number> {
  const config = loadConfig(io.env);
  if (!config.clientKey || !config.clientSecret) {
    io.stderr("Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET before running login. Both come from your app on developers.tiktok.com, under Manage apps.\n");
    return 10;
  }
  const port = Number(flagValue(args, "--port") ?? 8481);
  try {
    const result = await runAuth({
      clientKey: config.clientKey,
      clientSecret: config.clientSecret,
      port: Number.isFinite(port) && port > 0 ? port : 8481,
      publish: args.includes("--publish"),
      log: (line) => io.stderr(`${line}\n`),
    });
    io.stderr(`\nConnected. Scopes granted: ${result.scope || "(none reported)"}\n`);
    io.stderr(`This refresh token is valid for about ${result.refreshExpiresInDays} days.\n`);
    io.stderr("Add it to your client config as TIKTOK_REFRESH_TOKEN:\n\n");
    io.stdout(`${result.refreshToken}\n`);
    return 0;
  } catch (error) {
    io.stderr(`\n${(error as Error).message}\n`);
    return 4;
  }
}
