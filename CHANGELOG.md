# Versions

| Component | Version |
|---|---|
| `@modelcontextprotocol/sdk` | ^1.30.0 |
| TikTok Display API | v2 |
| TikTok Content Posting API | v2 |
| Node | >= 20 |

## 1.1.1, 2026-10-04

- **`npx -y @thenavidm/tiktok-mcp-cli` starts the MCP server whatever order npm keeps.** npx starts whichever binary the npm registry lists first when they share one file, and the registry does not keep the published order. For this package that happened to be the server; for 23 others it was the CLI. A third binary named after the package, on its own file, now always starts the server, and npx picks it by name.

## 1.1.0

Renamed to `@thenavidm/tiktok-mcp-cli`, because the package is now two surfaces
rather than one. `@thenavidm/tiktok-mcp` is deprecated and points here. The
binaries are unchanged: `tiktok-mcp` and `tiktok-cli`.

A second surface. The same 14 tools now run as `tiktok-cli` shell commands,
generated from the one `ALL_TOOLS` array through the same handlers and the same
`WriteGuard`, so the two surfaces cannot drift. `--agent` and `--select` make a
long video list affordable to an agent, and exit codes let a script branch
without parsing a message.

A refusal now names the syntax of the surface it happened on: `--confirm` in a
terminal, `confirm: true` in a tool call.

A Claude Desktop extension. `bash desktop-extension/build.sh` produces a `.mcpb`
that vendors its own dependencies and asks for the client key, secret and
refresh token in the install dialog, with read-only and no-publishing switches
alongside them.

Fixed: a missing credential exited 4, the code for a rejected token, because the
message mentions a refresh token. It exits 10 now.

Fixed: a write refused for want of `--confirm` exited 5, which tells a script
the call failed upstream and is worth retrying. Nothing left the machine and a
retry refuses again, so it exits 2. The check runs before the auth and
not-found ones, because a refusal carries no HTTP status and its message ends
with a summary of the action, which is arbitrary text.

Fixed: `--version` read a hardcoded string in `server.ts` that a release could
bump independently of `package.json`. It reads `package.json` now.

Fixed: an array of enums was treated as a JSON argument, so a value that is a
word you type had to be quoted as a JSON literal. It is a repeatable scalar now.

Fixed: the three `TIKTOK_HTTP_*` variables reached neither `--help` nor the
README.

Documentation: the README now names both surfaces, shows runnable examples of
each, and publishes the measured context cost from a real `tools/list`
handshake. Two claims were wrong and are corrected against TikTok's own docs:
the refresh token does not rotate on every use, it merely may come back
different, and TikTok publishes no statement that its Display and Content
Posting APIs are free, so the README no longer says so.

The long-form auth walkthrough moved from `references/setup.md` to `INSTALL.md`.
Nothing under `references/` was in `files`, so it shipped to nobody.

## 1.0.0

First release. 14 tools over TikTok's official Login Kit, Display API and
Content Posting API, for accounts you connect yourself.

Reading covers the profile and audience, every public video with views, likes,
comments, shares and a computed engagement rate, local ranking and search across
a scanned window, and an aggregate summary that reports a median alongside the
mean so one viral post cannot stand in for a typical one.

Publishing covers videos and photo carousels, plus a drafts path that needs only
`video.upload` and therefore works before TikTok has audited the app.

Two things drove the design. TikTok access tokens expire in 24 hours, so the
client refreshes on its own and keeps whichever refresh token comes back, which is the
difference between a server that works for a year and one that works for a day.
And TikTok's desktop OAuth flow wants a hex-encoded PKCE challenge rather than
the base64url that its own web flow uses, so `auth` implements the desktop
variant and a loopback listener rather than asking anyone to paste a code.
