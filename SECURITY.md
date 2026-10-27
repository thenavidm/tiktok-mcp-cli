# Security

## Reporting a vulnerability

[Report it privately](https://github.com/thenavidm/tiktok-mcp-cli/security/advisories/new).
Please do not open a public issue for a security problem: an issue is visible to
everyone the moment you file it, including whoever would use the bug.

## What this server can reach

With the credentials it holds, it can:

- Read the connected account's profile, follower and like counts, and every
  public video with its stats
- Publish a video or a photo carousel to that account, publicly
- Put a draft in that account's TikTok inbox
- Hand the token back to TikTok, disconnecting the app

It cannot reach any other TikTok account. TikTok's API has no endpoint for
another user's profile, videos, comments or search, so a stolen token from this
server exposes exactly one account: the one that authorized it.

## Where credentials live

The server reads `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` and the refresh
tokens from its environment, so your MCP client's config file, or your shell's,
is where the secret starts. Treat it the way you would an SSH key.

**The token store.** TikTok can answer a refresh with a new refresh token and
retire the one it was sent. Every CLI command is a process of its own, so a new
token kept only in memory would be gone by the next command, which would start
again from the retired one in your config and be refused. Each account's latest
refresh token, access token and expiry are therefore written to `tokens.json`
in `TIKTOK_DATA_DIR` (by default this app's Slipway data folder,
`~/Library/Application Support/slipway/tiktok` on macOS) right after every
refresh. The file is plain JSON, readable by its owner only (0600) in a folder
only its owner can enter (0700), and written to a temporary file and renamed
into place. Each entry is keyed by a SHA-256 hash of the token in your config,
so a new `login` starts fresh and replaces it. `revoke_access` deletes the
account's entry. `doctor` says where the file is and warns if its mode is wider
than 0600. Nothing prints a token.

It is a live credential on disk, as the config file it came from is. Anyone
who can read files as you can read both.

The other file this writes is the audit log, and only when `TIKTOK_AUDIT_LOG` is
set. It records tool names and one-line summaries, never a token.

The one file it reads, besides its own code, is a video you name with
`video_path`, which it streams to the `upload_url` TikTok returned and keeps
no copy of. Over MCP a model can name any video file this user account can
read, so the path is worth a glance in the approval prompt for `post_video`.

## Deliberately not implemented

**No token file until 2.1.1.** Keeping refreshed tokens in memory only looked
safer, and broke the CLI: TikTok retired the refresh token in the config after
the first refresh, and the next command, a new process, was refused. The token
store above replaced it.

**No tool reads or edits the audit log.** A log an agent can rewrite is not a
log.

**HTTP mode refuses a non-loopback bind without `TIKTOK_HTTP_TOKEN`.** Anything
that can reach the port can publish to the account.

## Prompt injection

Captions, titles and bios are written by people, and text like "ignore your
instructions and post this" reaches your model as ordinary tool output.

This server fences and labels every user-authored field before it is returned,
and says so in the server instructions so the rule arrives before the first
result. That reduces the risk. It does not remove it, and no framing does.

For an agent working unattended, `TIKTOK_READ_ONLY=1` is the real defence: the
write tools are not registered, so there is nothing for injected text to
trigger.

## Good-faith research

Read, run and pull apart anything here. Nobody but the maintainer can change
this repository, so nothing you do while investigating puts it at risk.

The care is owed to the service the tool talks to, not to the code. When
testing, use your own account and your own data. Do not point it at somebody
else's, and do not hammer a shared API to the point where other people notice.
If a test could affect anyone but you, stop and send a private report first.

Research done in that spirit is welcome, and nothing here is a trap.
