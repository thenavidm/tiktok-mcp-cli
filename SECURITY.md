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

Nowhere on disk. The server reads `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`
and the refresh tokens from its environment, and holds the short-lived access
token in memory only.

That means your MCP client's config file is where the secret actually sits.
Treat it the way you would an SSH key.

The one file this writes is the audit log, and only when `TIKTOK_AUDIT_LOG` is
set. It records tool names and one-line summaries, never a token.

## Deliberately not implemented

**No token file.** Persisting refreshed tokens to disk would leave a
long-lived credential lying in a predictable path. Holding them in memory means
a restart costs one refresh call and a stolen laptop costs nothing extra.

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
