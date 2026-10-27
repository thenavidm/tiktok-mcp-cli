# Versions

| Component | Version |
|---|---|
| Slipway | ^0.1.17 |
| MCP TypeScript SDK, through Slipway | 2.3.0 |
| TikTok Display API | v2 |
| TikTok Content Posting API | v2 |
| Node | >= 22 |

## 2.1.1, 2026-10-27

- **A rotated refresh token now survives the command that received it.** TikTok can answer a refresh with a new refresh token and retire the old one. 2.1.0 and earlier kept the new one in memory only, and every CLI command is a process of its own, so the next command started again from the token in the config, which TikTok had retired, and failed with exit 4, "Refresh token is invalid or expired": a `tiktok-cli doctor` followed minutes later by `tiktok-cli send-video-to-drafts` was enough. A long-running MCP server was safe until it restarted. Each account's latest refresh token, access token and expiry are now written right after every refresh to `tokens.json` in `TIKTOK_DATA_DIR`, by default this app's Slipway data folder (`~/Library/Application Support/slipway/tiktok` on macOS), 0600 in a 0700 folder, written to a temporary file and renamed into place. Every command and server start reads it.
- **A new login wins.** Each saved entry is keyed by a SHA-256 hash of the config token it grew from, and is used only while the config still holds that token. A new token from `tiktok-cli login` starts from the config and replaces the account's old entry.
- **Fewer refreshes.** A saved access token that still has five minutes left is used as it is, so most commands make no refresh call at all, which also keeps them clear of TikTok's rate limit.
- **Two commands refreshing at once both keep working.** Before refreshing, a client reads the file again and takes a newer token another process saved; if its own refresh is refused, it looks once more and retries with the token the other process got.
- **`revoke_access` deletes the account's saved tokens.** `doctor` says where the file is, how many accounts it holds, and warns if its mode is wider than 0600. No token is ever printed; a file that cannot be written is reported on stderr without one.
- **`TIKTOK_DATA_DIR`** is described by `agent-context` and in the README.
- **SECURITY.md said there is no token file.** There is one now, and it says why.
- The refresh error no longer prints two periods after TikTok's own.

### Upgrading

An account TikTok already refused under 2.1.0 needs one `tiktok-cli login`, and the new token in your config: the token there was retired, and no file holds its successor. From then on, refreshes keep themselves.

## 2.1.0, 2026-10-27

A video from a file on this machine. Still 14 tools.

- **`post_video` and `send_video_to_drafts` take `video_path`**, a video file on the machine running the server, beside `video_url`. TikTok's [getting started guide](https://developers.tiktok.com/doc/content-posting-api-get-started): "If you have the video file locally, set the source parameter to `FILE_UPLOAD`". The init call declares `video_size`, `chunk_size` and `total_chunk_count`, and the file goes to the `upload_url` TikTok returns, chunk by chunk, before the call returns. No verified domain is needed, which `PULL_FROM_URL` requires.
- **Chunks follow TikTok's [media transfer guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide)**: at least 5 MB and at most 64 MB each, the last up to 128 MB with the trailing bytes, `total_chunk_count` the size divided by the chunk size rounded down, 1 to 1000 chunks, in order, and a video under 5 MB whole. Anything under 20 MB goes whole; larger files go in 10,000,000-byte chunks, the size in TikTok's own worked example, so a file of 50,000,123 bytes is the five chunks the guide shows. MP4, WebM or MOV up to 4 GB, checked before TikTok hears of it. A chunk that fails with a 5xx is sent again; a 403 says the upload URL expired, since it is "valid for one hour after issuance" ([Direct Post reference](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)), and the error carries the `publish_id`. The file streams from disk rather than sitting in memory, and progress goes to a client that asks for it.
- **A file's result says so**: `status: "uploaded"`, `source: "FILE_UPLOAD"`, the file name, bytes and chunks, and `get_post_status` documents `PROCESSING_UPLOAD`, the status a file shows until TikTok has all of it. The URL path returns exactly what it did, and 2.0's bare URL, `tiktok-cli send-video-to-drafts https://…`, still fills `video_url`.
- **`post_video` and `post_photos` say what they do in TikTok's words** when they refuse or ask for approval: they post directly to the creator's account at the chosen privacy level once TikTok has processed the media, and only the TikTok app can delete it. They said Slipway's default, "is public or cannot be undone".
- **Photos stay URL-only.** TikTok's [photo post reference](https://developers.tiktok.com/doc/content-posting-api-reference-photo-post) says "Only PULL_FROM_URL is allowed" for photos, so `post_photos` and `send_photos_to_drafts` take no file, and their descriptions now say why.
- **No scheduling.** TikTok's posting endpoints take no publish time, and none is invented here.
- **The app reads its settings from the environment Slipway hands it**, which is `process.env` when it runs, so tests can give it an account without touching the real environment.

### Upgrading

Nothing to change for a URL. A script that passed something other than a URL as `post-video`'s first bare word gets a usage error as before; a file needs `--video-path`. A file sent from a client that stops waiting after a minute, such as Codex by default, needs `tool_timeout_sec` raised for this server, or the CLI.

## 2.0.1, 2026-10-05

- **Built on Slipway 0.1.17**, which a fresh install of 2.0.0 already used. Since the Slipway 2.0.0 was measured on, 0.1.10, `which` also reads a tool's argument names and prints a title once where a description opens with it, and the general help names the settings that connect an account and the safety switches and counts the rest, which `agent-context` describes one by one. [Slipway's changelog](https://github.com/thenavidm/slipway/blob/main/CHANGELOG.md) lists the rest.
- **A test checks that every setting is named in `--help` or described by `agent-context`**, where it asked `--help` to name each one.

## 2.0.0, 2026-10-05

Built on [Slipway](https://github.com/thenavidm/slipway) 0.1.10. The 14 tools keep their names and arguments, and every difference below was measured against 1.1.0, the last version on npm, before release.

- **A person approves each publish over MCP.** `post_video`, `post_photos` and `revoke_access` cannot be undone; Claude Code (2.1.246 and later) shows its own prompt for each, and a client that can show forms asks with an approval form whose one box starts unticked. Approvals are signed, bound to the exact call and work once. Where a client can do neither, the model's `confirm: true` still counts, and `TIKTOK_CONFIRM=model` makes it enough everywhere. Drafts still need nothing, and the audit log records who approved each write.
- **`TIKTOK_ALLOW_DESTRUCTIVE=0` still takes publishing and revoking off the list**, on both surfaces, and drafts keep working. A call to one of them anyway is refused with the setting to unset.
- **A smaller tool list.** 5,409 tokens in Claude Code with every tool loaded, down from 5,970: the per-tool `$schema` line, an `execution` field and `additionalProperties: false` are gone. The last one advertised strict input while unknown keys were dropped anyway; the schema now says what happens.
- **TikTok's error codes pick the exit code.** A missing scope or a rejected token exits 4, TikTok's posting caps 7, a privacy level the account cannot use or an unverified media domain 2, an unknown publish id 3, and a refresh token TikTok no longer honors 4. An unknown command and a write hidden by a safety setting exit 2 instead of 1, and `doctor` with nothing configured 10 instead of 1. 1 now means an unexpected error. Errors keep TikTok's code and its log id, which TikTok's support asks for, in `details`.
- **`which <words>` finds a command**, and `agent-context` describes every command, flag and setting as JSON. In Codex over MCP, finding the tool that saves a video to drafts took 47,503 input tokens instead of 47,557 (median of five).
- **`login`**, which 1.1 called `auth`. Both names work, and the token still goes alone to stdout.
- **`install <client>`** adds the server to Claude Code, Codex, Claude Desktop, Cursor, VS Code or Gemini CLI in each one's own format.
- **Less work to start.** The entry turns on Node's compile cache, and the server spends 145 ms of CPU before its first answer where 1.1.0 spent 181 (median of 21 runs, taking turns on one busy Mac). npx installs 4 dependencies instead of 94.
- **Releases reach npm again.** The publish workflow ran only when a GitHub release was created, so 1.1.1 was tagged and never published; 2.0.0 publishes on the tag, attaches the desktop extension to the release, and carries 1.1.1's npx fix. The CI handshake now speaks JSON-RPC itself, since the old MCP SDK is no longer a dependency.
- **Docs fixes.** The README has a Features table, the icon loads from cdn.navid.me, and THIRD_PARTY_NOTICES.md lists the production dependencies' licenses.

### Upgrading

Node 22 or newer; 1.1 ran on 20. Scripts keep working for success, a refused publish and missing setup; one that read exit 1 as an unknown command or a hidden write should read 2. Over MCP, expect an approval prompt or form for each publish; a headless agent that should publish with `confirm: true` alone needs `TIKTOK_CONFIRM=model`. A script that pipes JSON-RPC into the server must keep stdin open until it reads the answer: the server now stops when its input ends, as the MCP stdio binding asks. `--http` refuses a page from another site unless `TIKTOK_HTTP_ALLOWED_ORIGINS` lists it. Some terminal screens grew: the general help by 100 tokens, for `which`, `install`, the flags and the exit codes it now lists, which in Codex makes the CLI task 62 tokens longer (83,105 against 83,043, median of five); the command list by 24, for the lines that point to `which` and `--help`; and the refusal to publish without `--confirm` by 34, since it now says what would run and how to approve it.

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
