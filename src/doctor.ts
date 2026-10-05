/**
 * `tiktok-cli doctor`: test every credential and say what is unavailable.
 *
 * Slipway runs these on every `doctor`, as 1.1 did, after its own checks of
 * Node, the version, writes and the tool count.
 */

import type { DoctorCheck } from "@thenavidm/slipway";
import { PUBLISH_SCOPES, READ_SCOPES } from "./api/client.js";
import type { ToolContext } from "./tools/kit.js";

const LOGIN = "Run `tiktok-cli login` to get a refresh token, then set TIKTOK_REFRESH_TOKEN.";

export async function doctor(ctx: ToolContext, options: { network: boolean }): Promise<DoctorCheck[]> {
  const { config } = ctx;
  const checks: DoctorCheck[] = [];

  const hasApp = Boolean(config.clientKey && config.clientSecret);
  checks.push(
    hasApp
      ? config.clientKey.startsWith("sb")
        ? {
            name: "TikTok app",
            ok: false,
            warn: true,
            detail: "a sandbox client key, which authorizes only test users you add by hand and cannot post publicly",
          }
        : { name: "TikTok app", ok: true, detail: "client key and secret set" }
      : {
          name: "TikTok app",
          ok: false,
          detail: "TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET are not set",
          fix: "Both come from your app on developers.tiktok.com, under Manage apps.",
        },
  );
  checks.push(
    config.accounts.length > 0
      ? { name: "Accounts", ok: true, detail: config.accounts.map((account) => account.name).join(", ") }
      : { name: "Accounts", ok: false, detail: "none configured", fix: LOGIN },
  );
  if (!hasApp || !options.network) return checks;

  /* Test every account rather than the first. One dead token must not hide
     five healthy ones, which is exactly what a first-account-only check does
     and why it is worth the extra requests here. */
  for (const account of config.accounts) {
    const client = ctx.client(account.name);
    try {
      const data = (await client.request("GET", "/user/info/", { fields: "open_id,display_name,username" })) as {
        user?: Record<string, unknown>;
      };
      const username = data.user?.username ?? data.user?.display_name ?? "(no username granted)";
      checks.push({ name: `${account.name}`, ok: true, detail: `connected as ${String(username)}` });

      const granted = (client.grantedScope ?? "").split(",").map((scope) => scope.trim()).filter(Boolean);
      const missingRead = READ_SCOPES.filter((scope) => !granted.includes(scope));
      const missingPublish = PUBLISH_SCOPES.filter((scope) => !granted.includes(scope));
      if (missingRead.length) {
        checks.push({ name: `${account.name} read scopes`, ok: false, detail: `missing ${missingRead.join(", ")}`, fix: "Run `tiktok-cli login` again and approve them." });
      }
      checks.push(
        missingPublish.length === 0
          ? { name: `${account.name} publishing`, ok: true, detail: "available" }
          : {
              name: `${account.name} publishing`,
              ok: false,
              detail: `unavailable: missing ${missingPublish.join(", ")}; the draft tools still work without it`,
              fix: "Add the Content Posting API product to your TikTok app, then run `tiktok-cli login --publish`.",
            },
      );
    } catch (error) {
      checks.push({ name: `${account.name}`, ok: false, detail: `token rejected: ${(error as Error).message}`, fix: LOGIN });
    }
  }
  return checks;
}
