/**
 * Who this server is acting as, and what that account looks like.
 */

import { USER_FIELDS } from "../format/videos.js";
import { frame } from "../format/frame.js";
import { accountArg, confirmArg, defineTool, type AnyToolSpec } from "./kit.js";

type RawUser = Record<string, unknown>;

const listAccounts = defineTool({
  name: "list_accounts",
  title: "List connected TikTok accounts",
  description:
    "Every TikTok account this server can act as, with the name to pass as `account` on any other tool. Does not call TikTok, so it works even when a token has expired.",
  schema: {},
  risk: "read",
  handler: async (_args, ctx) => ({
    count: ctx.config.accounts.length,
    accounts: ctx.config.accounts.map((a, i) => ({ name: a.name, default: i === 0 })),
  }),
});

const getProfile = defineTool({
  name: "get_profile",
  title: "Read the connected account's profile",
  description:
    "Profile and audience for a connected account: username, display name, bio, verified flag, follower and following counts, total likes across all videos, and how many videos are public. This is the only account it can see; TikTok's official API cannot read anybody else's profile.",
  schema: { ...accountArg },
  risk: "read",
  handler: async ({ account }, ctx) => {
    const data = (await ctx.client(account).request("GET", "/user/info/", {
      fields: USER_FIELDS,
    })) as { user?: RawUser };
    const user = (data.user ?? {}) as RawUser;

    const bio = typeof user.bio_description === "string" ? user.bio_description : "";

    return {
      username: user.username ?? null,
      display_name: user.display_name ?? null,
      profile_url: user.profile_deep_link ?? null,
      verified: user.is_verified ?? null,
      followers: user.follower_count ?? null,
      following: user.following_count ?? null,
      total_likes: user.likes_count ?? null,
      public_videos: user.video_count ?? null,
      avatar_url: user.avatar_large_url ?? user.avatar_url ?? null,
      open_id: user.open_id ?? null,
      /* Framed because a bio is free text that a person wrote, and "summarise
         my profile" is one of the first things anyone asks. */
      bio: bio ? frame("Profile bio", bio) : null,
    };
  },
});

const revokeAccess = defineTool({
  name: "revoke_access",
  title: "Disconnect an account from your TikTok app",
  description:
    "Hands the token back to TikTok and removes your app from the account's connected-apps list. The refresh token in your config stops working immediately and only re-running `tiktok-mcp auth` will restore access.",
  schema: { ...confirmArg, ...accountArg },
  risk: "destructive",
  summary: ({ account }) => `Revoke the TikTok token for account "${account ?? "default"}".`,
  handler: async ({ account }, ctx) => {
    const name = ctx.account(account).name;
    await ctx.client(account).revoke();
    return {
      revoked: name,
      note: "Remove this account's refresh token from your config: it will not work again.",
    };
  },
});

/** Declared here so the account tools can be filtered by risk in one place. */
export const ACCOUNT_TOOLS: AnyToolSpec[] = [
  listAccounts,
  getProfile,
  revokeAccess,
] as unknown as AnyToolSpec[];
