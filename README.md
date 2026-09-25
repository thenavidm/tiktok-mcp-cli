<img src="https://cdn.navid.media/connectors/tiktok-icon.png" alt="TikTok" width="88">

# TikTok MCP Server & CLI

[![npm](https://img.shields.io/npm/v/@thenavidm/tiktok-mcp-cli?color=orange&label=npm)](https://www.npmjs.com/package/@thenavidm/tiktok-mcp-cli)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/thenavidm/tiktok-mcp-cli/ci.yml?branch=main&label=CI)](https://github.com/thenavidm/tiktok-mcp-cli/actions)
[![YouTube](https://img.shields.io/badge/YouTube-@thenavidm-red?logo=youtube&logoColor=white)](https://youtube.com/@thenavidm?sub_confirmation=1)
[![X](https://img.shields.io/badge/X-@thenavidm-black?logo=x)](https://x.com/thenavidm)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-thenavidm-0A66C2?logo=linkedin&logoColor=white)](https://linkedin.com/in/thenavidm)

TikTok MCP server and CLI for Claude Code and AI agents. 14 tools for your profile, video stats, top posts, publishing videos and photo carousels, drafts and post status.

One install gives you both surfaces, the same 14 tools under the same names.

It reads your real numbers. Views, likes, comments and shares per post, straight from TikTok rather than a scraper's guess.

It publishes too: a video or a photo carousel, or a draft into your TikTok inbox that you finish in the app.

Everything is scoped to accounts you connect yourself.

Built and maintained by [Navid Moazzez](https://navid.me?utm_source=github&utm_medium=referral&utm_campaign=tiktok-mcp-cli&utm_content=readme).

```
You:    Which of my TikToks beat my median view count this year, and what do they share?

Claude: [stats_summary -> top_videos]
        Median is 4,180 views across your last 60. Eleven beat it.

        Nine of the eleven open on a face with no text overlay. Your
        median post opens on a title card. The two exceptions are both
        under 12 seconds.

        Your best is 214k, which is why your mean reads 21,600 and is
        not a number any other post of yours has come close to.
```

## Two ways to use it

### Command line

`tiktok-cli` in your terminal, for scripting, cron, pipes, or just asking a
quick question without opening anything:

```bash
tiktok-cli                                        # every command, one line each
tiktok-cli get-profile                            # followers, total likes, video count
tiktok-cli list-videos --limit 50                 # your posts, newest first
tiktok-cli top-videos --metric shares --limit 10  # ranked by what travels
tiktok-cli stats-summary --scan 200               # mean, median, p90, cadence
tiktok-cli search-my-videos --query "AI OS"
tiktok-cli send-video-to-drafts --video-url https://cdn.example.com/clip.mp4
tiktok-cli post-video --video-url https://cdn.example.com/clip.mp4 \
  --privacy-level SELF_ONLY --title "Shipped." --confirm
tiktok-cli list-videos --limit 200 --json | jq '[.videos[] | select(.views > 10000)] | length'
tiktok-cli <command> --help                       # what any command takes
```

`--confirm` is the shell spelling of the confirmation that `post-video`,
`post-photos` and `revoke-access` require. `--json` gives JSON, `--compact` puts
it on one line, `--select id,views` keeps only the fields you name, and errors
are JSON on stderr whichever you pick.

Reading commands return real objects rather than prose, so `jq` and `--select`
reach the fields directly. [Section 8](#8-output-and-exit-codes) has the exit
codes a script branches on.

### MCP server, for AI agents

`tiktok-mcp` is what Claude Code, Claude Desktop, Cursor and the rest launch.
You never run it by hand:

```bash
claude mcp add tiktok \
  -e TIKTOK_CLIENT_KEY=your_client_key \
  -e TIKTOK_CLIENT_SECRET=your_client_secret \
  -e TIKTOK_REFRESH_TOKEN=your_refresh_token \
  -- npx -y @thenavidm/tiktok-mcp-cli@latest
```

Then just ask: _"rank my last 200 posts by shares and tell me what the top ten
have in common."_

Every other client is in [section 4](#4-connect-your-client-).

### Which one

| Where you are | What you can reach |
|---|---|
| An agent that can run shell commands, like Claude Code or Cursor | Both. The CLI is the cheaper one: it costs nothing until you type it |
| claude.ai, the Claude Desktop chat tab, or a phone | The server only. There is no shell to run a command in |
| A terminal, a script, cron or CI | The CLI only. There is no MCP client in a shell |

They are the same program reading the same array of tool definitions, so
anything one can do, the other can, and a tool added tomorrow is a command
tomorrow.

## Contents

| # | Section | What it covers |
|---|---|---|
| 1 | [What you can ask it](#1-what-you-can-ask-it-) | Real prompts, not features |
| 2 | [Quick install](#2-quick-install-) | The package, no account needed |
| 3 | [Set up your TikTok app](#3-set-up-your-tiktok-app-) | Every click |
| 4 | [Connect your client](#4-connect-your-client-) | Claude Code, Desktop, Cursor |
| 5 | [Check it worked](#5-check-it-worked-) | `doctor` |
| 6 | [Which surface, and what each costs](#6-which-surface-and-what-each-costs) | Measured tokens a turn, and how to spend less |
| 7 | [Tools](#7-tools-) | All 14, by what they reach |
| 8 | [Output and exit codes](#8-output-and-exit-codes) | What scripts branch on |
| 9 | [Environment variables](#9-environment-variables) | Credentials, safety, tuning |
| 10 | [Writing safely](#10-writing-safely-) | What is guarded and what is not |
| 11 | [Notes and gotchas](#11-notes-and-gotchas-) | The platform's real behaviour |
| 12 | [Troubleshooting](#12-troubleshooting-) | Symptom to cause |
| 13 | [FAQ](#13-faq-) | Including what an MCP server is |

## 1. What you can ask it 💬

- Which of my TikToks beat my median view count, and what do they have in common?
- What is my actual engagement rate per post, not the number the app shows me?
- How often am I posting, and has that changed over the last 60 videos?
- Find every video where I mentioned the AI OS and tell me how they performed.
- Rank my last 200 posts by shares rather than views. Shares are the ones that travel.
- Draft a TikTok from this MP4 and put it in my inbox so I can review it on my phone.
- Publish this photo carousel with the first image as the cover, comments off.
- Did the video I posted twenty minutes ago clear moderation yet?
- My follower count and total likes, then work out my average views per follower.

The thing you cannot do anywhere else: **rank your own catalogue by a metric TikTok's app will not sort by.** The app shows you a grid ordered by date. Asking "which posts actually travelled, by shares, across two hundred videos" has no answer inside TikTok, and it is one call here.

## 2. Quick install ⚡

Node 20 or newer. Nothing else.

    npx -y @thenavidm/tiktok-mcp-cli --version

That is the whole install for the MCP server. `npx` fetches it on demand, so
there is nothing to update later, and the `claude mcp add` line in
[section 4](#4-connect-your-client-) does it for you.

For the shell surface, install it once so `tiktok-cli` is on your PATH:

```bash
npm i -g @thenavidm/tiktok-mcp-cli
tiktok-cli --version
tiktok-cli                 # every command, one line each
```

Without a global install, `npx -y -p @thenavidm/tiktok-mcp-cli tiktok-cli` runs
the same binary.

Installing the package needs no TikTok account. Only the next section does.

## 3. Set up your TikTok app 🔑

TikTok has no personal access tokens. Every integration goes through an app you create, which is more work than most services and is the same for everybody.

The steps below are the short version. [INSTALL.md](INSTALL.md) is the long one: read it when something here did not work, or when you are deciding between Sandbox and Production.

> [!TIP]
> Use **Sandbox** mode while you set this up. A sandbox app works immediately with no review, against TikTok accounts you add to it yourself. Only switch to Production when you want other people to use it.

### Before you start

| You need | Check with | If missing |
|---|---|---|
| Node 20 or newer | `node -v` | [nodejs.org](https://nodejs.org) |
| A TikTok developer account | [developers.tiktok.com](https://developers.tiktok.com) | Sign up with your email, it is free |
| The TikTok account you want to connect | | Any account, personal or business |

### Step 1: Create the app

1. Log in at [developers.tiktok.com](https://developers.tiktok.com/login/), click the profile icon in the navigation bar, then **Manage apps**.
2. Click **Connect an app**.
3. When asked to **Select the app owner**, pick an organization if you have one, or your individual developer account.
4. Fill in the app name, icon and description. TikTok shows the description on the screen where you approve access, so write it for yourself.
5. Under **Platforms**, select **Desktop**. This server runs on your machine, which is what that platform means.

### Step 2: Add Login Kit and set the redirect URI

1. In the **Products** section click **Add products**, and add **Login Kit**.
2. In the Login Kit settings, set the **Redirect URI** to exactly:

       http://127.0.0.1:8481/callback/

TikTok allows loopback redirect URIs for desktop apps, which is what lets the next step happen entirely in your terminal. The trailing slash is part of the URI.

### Step 3: Add the scopes

In the **Scopes** section, add these four:

    user.info.basic
    user.info.profile
    user.info.stats
    video.list

Add these two as well, but only if you want to publish. They need the **Content Posting API** product added too:

    video.upload
    video.publish

> [!IMPORTANT]
> Only ask for scopes your app actually has. Sending an unapproved scope to TikTok's authorize URL fails the whole sign-in, not just that one permission.

### Step 4: Get your refresh token

Copy the **Client key** and **Client secret** from the **Credentials** section of the app page, then:

```bash
export TIKTOK_CLIENT_KEY=your_client_key
export TIKTOK_CLIENT_SECRET=your_client_secret

npx -y @thenavidm/tiktok-mcp-cli auth
```

It prints a URL. Open it, approve the access, and the terminal prints a refresh token valid for about 365 days. Add `--publish` if you added the publishing scopes.

### Step 5: Verify a domain, only if you will publish

TikTok downloads media from a URL rather than accepting an upload, and it will only pull from a domain you have proved you own.

1. Click **URL properties** at the top of the app page.
2. Click **Verify properties**.
3. Verify by **Domain** or by **URL prefix**, and follow the instructions shown.

Skip this if you are only reading, and skip it if you only use the drafts tools.

### Revoking access later

Call the `revoke_access` tool, or remove the app from **Settings**, **Security and permissions**, **Manage app permissions** in the TikTok app.

## 4. Connect your client 🔌

### Claude Code

```bash
claude mcp add tiktok \
  -e TIKTOK_CLIENT_KEY=your_client_key \
  -e TIKTOK_CLIENT_SECRET=your_client_secret \
  -e TIKTOK_REFRESH_TOKEN=your_refresh_token \
  -- npx -y @thenavidm/tiktok-mcp-cli@latest
```

Add `--scope user` to make it available in every project rather than the current one.

### Claude Desktop

The easiest route is the extension: download the [`.mcpb`](https://github.com/thenavidm/tiktok-mcp-cli/releases/latest)
from the latest release and double-click it. Claude Desktop asks for the client
key, secret and refresh token in a dialog, keeps the two secrets in your
operating system keychain, and carries its own dependencies, so nothing else has
to be installed first.

To wire it by hand instead:

| Platform | Config file |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "tiktok": {
      "command": "npx",
      "args": ["-y", "@thenavidm/tiktok-mcp-cli@latest"],
      "env": {
        "TIKTOK_CLIENT_KEY": "your_client_key",
        "TIKTOK_CLIENT_SECRET": "your_client_secret",
        "TIKTOK_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

> [!TIP]
> Claude Desktop does not inherit your shell PATH, so a bare `npx` can fail silently. Use the absolute path from `which npx`. Then quit the app completely rather than closing the window.

### Cursor

`.cursor/mcp.json`, same shape as Claude Desktop, key `mcpServers`.

### Windsurf

`~/.codeium/windsurf/mcp_config.json`, key `mcpServers`.

### VS Code

`.vscode/mcp.json`. The key is `servers`, not `mcpServers`, and each entry takes `"type": "stdio"`.

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.tiktok]
command = "npx"
args = ["-y", "@thenavidm/tiktok-mcp-cli@latest"]

[mcp_servers.tiktok.env]
TIKTOK_CLIENT_KEY = "your_client_key"
TIKTOK_CLIENT_SECRET = "your_client_secret"
TIKTOK_REFRESH_TOKEN = "your_refresh_token"
```

### Gemini CLI

`~/.gemini/settings.json`, key `mcpServers`.

### Everything else

Any stdio MCP client takes the same three things: the command `npx`, the args above, and the env block.

### Self-hosted over HTTP

```bash
npx -y @thenavidm/tiktok-mcp-cli@latest --http --port 8000
```

It binds `127.0.0.1` and refuses any other host without `TIKTOK_HTTP_TOKEN` set, because anything that can reach the port can publish to the connected account.

| Variable | What it does |
|---|---|
| `TIKTOK_HTTP_PORT` | Port to listen on. Default `8000`, and `--port` overrides it |
| `TIKTOK_HTTP_HOST` | Interface to bind. Default `127.0.0.1` |
| `TIKTOK_HTTP_TOKEN` | Bearer token required on every request. Mandatory on any host but `127.0.0.1` |

### More than one account

```
TIKTOK_ACCOUNTS=personal:refresh_token_one,brand:refresh_token_two
```

Then pass `account: "brand"` on any tool. Run `auth` once per account to get each token.

## 5. Check it worked 🩺

    npx -y @thenavidm/tiktok-mcp-cli@latest doctor

It tests every configured account, names which scopes were granted, and says which tools are unavailable and why.

The two failures that actually happen:

| It says | Do this |
|---|---|
| `token rejected` | Your refresh token expired or was revoked. Run `auth` again. |
| `publishing unavailable` | The account never granted `video.publish`. Add the Content Posting API product, then `auth --publish`. |

## 6. Which surface, and what each costs

Both surfaces carry the same 14 tools. They differ in when you pay for them.

| Cost | MCP server | CLI |
|---|---|---|
| Loaded every turn | **~4,200 tokens** | nothing |
| Loaded when TikTok comes up | nothing more | ~2,100, once |
| Works on claude.ai and mobile | yes | no, there is no shell there |
| Works in a script, cron or CI | no | yes |
| You invoke it by | asking in plain language | typing a command |

An MCP server sends its whole tool list to the model on **every turn**, whether
you mention TikTok or not. That is the price of being connected at all, before
you ask anything.

The number above is measured, not estimated: a real `tools/list` handshake
against this server returns 14 tool definitions costing **3,882 tokens**, and
the server instructions that ride alongside them cost **339**, for **4,221** a
turn. `TIKTOK_READ_ONLY=1` drops that to **2,402**, because it hides the five
write tools rather than merely refusing them.

Over twenty turns where TikTok comes up once, that is roughly 84,000 tokens
against 2,100. When the whole conversation is TikTok, the gap closes and the
server is the better experience, because you ask in plain language instead of
remembering flags.

### Where the 3,882 goes

Worth knowing, because most of it is not something anyone can write away:

| Part of the payload | Tokens | Share |
|---|---|---|
| JSON Schema structure: types, required lists, protocol keys | 1,972 | **51%** |
| Argument descriptions | 1,056 | 27% |
| Tool names and descriptions | 854 | 22% |

Half of it is the protocol serialising every tool as JSON Schema. Any MCP
server with this many arguments pays the same. The 49% that is prose is what
makes the tools usable without guessing.

### Spending less

**Turn the server off when you are not using TikTok.** In Claude Code that is
`@tiktok` to toggle, and every client has an equivalent.

**Set `TIKTOK_READ_ONLY=1`** if the agent only needs the numbers. Nine tools,
2,402 tokens a turn.

**Or install the CLI and skip the server.** All 14 tools stay reachable and the
standing cost is nothing at all: an agent reads `SKILL.md`, about 2,100 tokens,
once the subject comes up rather than on every turn regardless.

## 7. Tools 🛠️

**Your account**

| Tool | What it does |
|---|---|
| `list_accounts` | Every account configured, and the name to target it by |
| `get_profile` | Username, bio, verified flag, followers, total likes, video count |
| `revoke_access` | Hand the token back to TikTok. Needs `confirm` |

**Your videos**

| Tool | What it does |
|---|---|
| `list_videos` | Your posts newest first, with views, likes, comments, shares and engagement rate. Pages automatically |
| `get_videos` | Up to 20 by id, and the way to refresh an expired cover image URL |
| `top_videos` | Rank by views, likes, comments, shares or engagement rate |
| `search_my_videos` | Find your posts by text in the title or description |
| `stats_summary` | Totals, mean, median, 90th percentile and posting cadence |

**Publishing** — needs `video.publish` or `video.upload`

| Tool | What it does |
|---|---|
| `get_creator_info` | Which privacy levels this account can post at. Call it first |
| `post_video` | Publish a video from a public URL. Needs `confirm` |
| `post_photos` | Publish a carousel of up to 35 images. Needs `confirm` |
| `send_video_to_drafts` | Send a video to your TikTok inbox to finish in the app |
| `send_photos_to_drafts` | Send photos to your inbox |
| `get_post_status` | Track a post through download, moderation and publication |

## 8. Output and exit codes

Every command prints human-readable text by default and JSON when asked.

| Flag | What it does |
|---|---|
| `--json` | JSON on stdout |
| `--compact` | the same JSON on one line |
| `--agent` | machine mode: `--json --compact --no-input --no-color --yes` in one flag |
| `--select <a,b.c>` | keep only these fields; dotted paths descend and arrays are traversed element-wise |
| `--help` | the arguments, types and defaults, derived from the schema |

Errors are always JSON on stderr, whichever output flag you passed, so a caller
parses one shape.

Exit codes, so a script can tell a mistake it should fix from a failure it
should retry:

| Code | Meaning |
|---|---|
| 0 | Success |
| 2 | Usage error: wrong or missing arguments, or a write refused for want of `--confirm` |
| 3 | Not found |
| 4 | Authentication rejected, usually an expired refresh token |
| 5 | API error upstream |
| 7 | Rate limited, wait and retry |
| 10 | Nothing is configured yet |

```bash
if ! tiktok-cli post-video --video-url "$URL" --privacy-level SELF_ONLY --confirm; then
  case $? in
    2)  echo "bad arguments or no confirmation, not retrying" >&2; exit 1 ;;
    4)  echo "token expired, run tiktok-cli auth" >&2; exit 1 ;;
    7)  echo "rate limited, backing off" >&2; sleep 60 ;;
    10) echo "nothing configured" >&2; exit 1 ;;
    *)  echo "failed, will retry" >&2 ;;
  esac
fi
```

`tiktok-cli` with no arguments lists every command with its risk marked.
`tiktok-cli schema <command>` prints the JSON Schema an MCP client receives, so
the two surfaces are provably the same.

## 9. Environment variables

**Credentials**

| Variable | What it is |
|---|---|
| `TIKTOK_CLIENT_KEY` | From the Credentials section of your app at developers.tiktok.com |
| `TIKTOK_CLIENT_SECRET` | From the same place |
| `TIKTOK_REFRESH_TOKEN` | What `tiktok-cli auth` prints. One account |
| `TIKTOK_ACCOUNTS` | Several accounts, as `name:token,name:token` |

**Safety**

| Variable | What it does |
|---|---|
| `TIKTOK_READ_ONLY=1` | Removes all five write tools from the list entirely |
| `TIKTOK_ALLOW_DESTRUCTIVE=0` | Keeps the drafts tools, removes publishing and revoking |
| `TIKTOK_AUDIT_LOG=<path>` | One JSON line per attempted write, allowed and blocked alike |

**Tuning**

| Variable | Default | What it does |
|---|---|---|
| `TIKTOK_HTTP_PORT` | `8000` | Port for `--http`. `--port` overrides it |
| `TIKTOK_HTTP_HOST` | `127.0.0.1` | Interface for `--http` to bind |
| `TIKTOK_HTTP_TOKEN` | none | Bearer token required on every HTTP request. Mandatory on any host but `127.0.0.1` |

## 10. Writing safely 🛟

Writes work by default. Publishing is the point of the tool.

The three actions that cannot be undone from a chat window take `confirm: true`, or `--confirm` in the shell: `post_video`, `post_photos` and `revoke_access`. Drafts do not, because they land in your own inbox and go nowhere until you finish them. Confirming everything would train the reflex that makes the confirmation on a real publish worthless.

The three switches in [section 9](#9-environment-variables) are the harder stops. `TIKTOK_READ_ONLY=1` takes the list from 14 tools to 9 by removing every write rather than refusing it, because a model cannot call a tool it cannot see. `TIKTOK_ALLOW_DESTRUCTIVE=0` leaves 11: the drafts tools stay, publishing and revoking go. `TIKTOK_AUDIT_LOG` records every attempted write, allowed and blocked alike.

Captions and bios reach the model fenced and labelled as somebody else's words. That framing helps and it is not a guarantee. For an agent working unattended, `TIKTOK_READ_ONLY=1` is the real defence.

## 11. Notes and gotchas ⚠️

- **It can only see your own account.** TikTok's official API has no endpoint for anybody else's profile, videos, comments, followers, hashtags or search. Nothing here answers a question about a competitor or a trend, and no API key changes that.
- **There is no comments API.** You cannot read or reply to comments on your own posts through TikTok's official API.
- **Access tokens live 24 hours.** The server refreshes them for you. The refresh token behind it is valid for 365 days. TikTok's docs warn that a refresh may hand back a *different* refresh token, so the server keeps whichever one came back rather than the one you configured.
- **An unaudited app posts privately.** Until TikTok audits your app, every post lands private whatever privacy level you pass. Sandbox apps cannot post publicly at all.
- **A public URL is not enough to publish from.** TikTok pulls media only from a domain verified under URL properties. An unverified domain fails with `url_ownership_unverified` however reachable the file is.
- **`privacy_level` must come from `get_creator_info`.** TikTok rejects a value that is not in that account's current list rather than falling back to something safe.
- **Publishing returns a job, not a post.** Poll `get_post_status`. A public post reports no post id until moderation clears it, usually a minute and sometimes hours.
- **Cover image URLs expire after 6 hours.** Re-fetch with `get_videos` rather than storing the link.
- **Five pending drafts per 24 hours.** TikTok caps unpublished API drafts per account.
- **A photo post's `title` caps at 90**, far shorter than a video caption's 2200. Its `description` takes 4000, so the long text belongs there. TikTok counts all three in UTF-16 runes, which is its own phrasing for the unit.
- **Rate limits are per access token:** six posting calls a minute, thirty status checks, twenty creator-info queries. The reading endpoints allow 600 a minute on a sliding window.
- **Only public videos are visible.** TikTok documents `video/list` as returning the user's *public* video posts, so anything else is out of reach. `get_videos` takes at most 20 ids a call.

## 12. Troubleshooting 🔧

Run `doctor` first. It checks every account and names what is unavailable.

| Symptom | Cause |
|---|---|
| `scope_not_authorized` | The account never granted that scope. Re-run `auth`, with `--publish` if you need posting |
| Token rejected on every call | The refresh token expired after 365 days, or you revoked the app |
| `redirect_uri` error during `auth` | The URI in your app is not byte-identical to `http://127.0.0.1:8481/callback/`, usually the trailing slash |
| `auth` hangs, never returns | Port 8481 is taken. Run `auth --port 9000` and register that URI too |
| `url_ownership_unverified` | The media domain is not verified under URL properties |
| `privacy_level_option_mismatch` | You passed a level not in `get_creator_info`, often after the account went private |
| Post says complete, has no post id | Normal. Moderation has not cleared it yet |
| `unaudited_client_can_only_post_to_private_accounts` | Expected on a sandbox or unaudited app. Post `SELF_ONLY`, or apply for the audit |
| Only nine tools appear | `TIKTOK_READ_ONLY=1` is set |
| Nothing appears in Claude Desktop | It does not inherit your PATH. Use the absolute `npx` path and fully quit the app |

## 13. FAQ ❓

<details>
<summary><b>What is an MCP server?</b></summary>

An MCP server is a standard way to give an AI assistant real access to a tool, so it can act rather than guess. You install it once, your assistant gains the tools, and it works in Claude, Cursor, ChatGPT and anything else that speaks MCP.

</details>

<details>
<summary><b>What is TikTok's API, and why do I need my own app?</b></summary>

TikTok's API is the official way software reads and posts to a TikTok account. Unlike most services it issues no personal access tokens, so every integration goes through an app you register. That is more setup than usual and it is the same for everyone.

</details>

<details>
<summary><b>Do I need to be technical?</b></summary>

You need to be comfortable pasting commands into a terminal and filling in a web form. The developer-app registration is the fiddly part, and section 3 covers every click.

</details>

<details>
<summary><b>Can it see other people's TikToks?</b></summary>

It cannot. TikTok's official API only reaches the account that authorised your app. There is no endpoint for another profile, for search, for hashtags or for trends, so competitor research is not something this can do at any price.

</details>

<details>
<summary><b>Is my data sent anywhere?</b></summary>

Your credentials stay in your own client's config and the server runs on your machine. It talks to TikTok and to nothing else. There is no telemetry and no intermediate service.

</details>

<details>
<summary><b>Can it post something by accident?</b></summary>

It is unlikely to. Publishing requires `confirm: true`, which the model has to set deliberately after reading a description saying why. Setting `TIKTOK_READ_ONLY=1` removes every write tool, and `TIKTOK_ALLOW_DESTRUCTIVE=0` keeps drafts while removing publishing.

</details>

<details>
<summary><b>Does it cost anything?</b></summary>

This server is MIT licensed and costs nothing. TikTok publishes no price list for the Display and Content Posting APIs, and registering a developer app costs nothing, so budget for your own hosting and nothing else.

</details>

<details>
<summary><b>Why does everything post privately?</b></summary>

TikTok restricts unaudited apps to private posts, whatever privacy level you request. Apply for the Content Posting API audit in the developer portal to lift it, or keep using the drafts tools and publish from the app.

</details>

<details>
<summary><b>Can I connect more than one account?</b></summary>

You can. Run `auth` once per account and list them in `TIKTOK_ACCOUNTS` as `name:token` pairs, then pass `account` on any tool. Each account is refreshed independently, so one expired token does not hide the others.

</details>

<details>
<summary><b>What happens when my token expires?</b></summary>

Access tokens expire every 24 hours and the server refreshes them silently. The refresh token behind them lasts 365 days, after which `doctor` reports the account as rejected and you run `auth` again.

</details>

<details>
<summary><b>Does it work with ChatGPT and Cursor?</b></summary>

It works with Cursor, Windsurf, VS Code, Codex CLI, Gemini CLI and anything else speaking MCP over stdio, all covered in section 4. For a hosted client that needs a URL, run it with `--http` behind your own HTTPS endpoint.

</details>

<details>
<summary><b>How do I disconnect it?</b></summary>

Call `revoke_access`, or open the TikTok app and remove the app under Settings, Security and permissions, Manage app permissions. Then delete the entry from your client's config.

</details>

## Questions

Run into a problem or have a question? [Open an issue](https://github.com/thenavidm/tiktok-mcp-cli/issues) and I will help.

## About the author 👋

Navid Moazzez is a leading AI business strategist, and the host of the AI Creator Summit, watched by 100,000+ creators. He helps creators and founders master AI and build their own AI Operating System (AI OS) to automate their business and life. This TikTok MCP server is one piece of that system.

**Links**

- Personal website: [navid.me](https://navid.me)
- Link in bio: [navid.bio](https://navid.bio)
- Navid Media: [navid.media](https://navid.media)
- YouTube: [@thenavidm](https://youtube.com/@thenavidm?sub_confirmation=1) and [@thenavidai](https://youtube.com/@thenavidai?sub_confirmation=1)
- X: [@thenavidm](https://x.com/thenavidm)
- Instagram: [@thenavidm](https://instagram.com/thenavidm)
- LinkedIn: [thenavidm](https://linkedin.com/in/thenavidm)

If this is useful, star the repo and come say hi on [X](https://x.com/thenavidm).

## Dependencies

| Library | Licence | What it does |
|---|---|---|
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | The MCP protocol, stdio and streamable HTTP transports |
| [zod](https://github.com/colinhacks/zod) | MIT | Tool input schemas, and the validation behind them |

## License

[MIT](./LICENSE). Free to use, modify, and share.

Not affiliated with, endorsed by, or sponsored by TikTok. TikTok is a trademark of ByteDance Ltd.

---

© 2026 [NM Media](https://navid.media). Made with ❤️ by [Navid Moazzez](https://navid.me).
