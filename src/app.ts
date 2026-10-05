/**
 * The TikTok app: everything Slipway needs to ship the MCP server and the CLI.
 *
 * This file only describes. It never starts anything, so `slipway check` and
 * tests can import it; `index.ts` is what runs.
 */

import { createRequire } from "node:module";
import { slipway, type CliIO } from "@thenavidm/slipway";
import { loadConfig } from "./config.js";
import { doctor } from "./doctor.js";
import { INSTRUCTIONS } from "./guide.js";
import { ALL_TOOLS } from "./tools/index.js";
import { makeContext, type ToolContext } from "./tools/kit.js";

const require = createRequire(import.meta.url);
export const VERSION: string = (require("../package.json") as { version: string }).version;

const signIn = async (io: CliIO, args: readonly string[]): Promise<number> => {
  const { runLogin } = await import("./login.js");
  return runLogin(io, args);
};

export const app = slipway<ToolContext>({
  name: "tiktok",
  title: "TikTok",
  version: VERSION,
  package: "@thenavidm/tiktok-mcp-cli",
  description: "a TikTok account you own: its profile and videos, posting and drafts, through TikTok's official API",
  instructions: INSTRUCTIONS,
  context: () => makeContext(loadConfig()),
  configured: ({ config }) => Boolean(config.clientKey && config.clientSecret && config.accounts.length > 0),
  secrets: ({ config }) => [config.clientSecret, ...config.accounts.map((account) => account.refreshToken)],
  tools: ALL_TOOLS,
  // 1.1 left the publishing tools out of the list when destructive writes were off, and drafts kept working.
  defaults: { destructiveOff: "hide" },
  httpPort: 8000,
  doctor,
  // A refresh token TikTok no longer honors and a missing posting scope only show on a request, so doctor makes one per account, as 1.1 did.
  doctorNetwork: true,
  login: {
    usage: "login [--publish] [--port N]",
    help: "get a refresh token; --publish adds the posting scopes",
    run: signIn,
  },
  commands: [{ name: "auth", usage: "auth [--publish] [--port N]", help: "the same as login, by the name 1.1 used", hidden: true, run: signIn }],
  settings: [
    { env: "TIKTOK_CLIENT_KEY", description: "From your app on developers.tiktok.com." },
    { env: "TIKTOK_CLIENT_SECRET", description: "The matching client secret.", secret: true },
    { env: "TIKTOK_REFRESH_TOKEN", description: "One account's refresh token, from `login`.", secret: true },
    { env: "TIKTOK_ACCOUNTS", description: "Several accounts, as name:token,name:token; replaces TIKTOK_REFRESH_TOKEN.", secret: true },
  ],
  links: { repository: "https://github.com/thenavidm/tiktok-mcp-cli" },
});
