# Install

## Setting up a TikTok app, in full

The README has the short version. This is the one to read when something in it
did not work, or when you are deciding between Sandbox and Production.

Every label below was checked against TikTok's own documentation. TikTok
rewrites this dashboard, so if a name has moved, the goal in each step is what
to go by rather than the exact word.

## Have an agent do it

An agent cannot sign in to TikTok for you. Only you can create the app and
approve the access. What it can do is walk you through it, wire up the config,
and check the result.

Paste this into Claude Code, Cursor, or any agent with terminal access:

```
Help me connect the TikTok MCP server.

1. Walk me through creating an app at developers.tiktok.com: Manage apps,
   Connect an app, Desktop platform, Login Kit product.
2. Tell me the exact redirect URI to register, and wait while I do it.
3. Ask me for my client key and secret, then run the auth command and wait
   for me to approve it in the browser.
4. Add the result to my client config and run doctor.

Stop and wait at each step that needs me. Do not guess a value.
```

## Sandbox or Production

Start in Sandbox.

| Aspect | Sandbox | Production |
|---|---|---|
| App review | not needed | required before anyone can use it |
| Who can authorize | TikTok accounts you add to the sandbox | anyone, once approved |
| Public posting | no | yes, after the Content Posting audit |
| URL verification | only for the Content Posting API | Terms, Privacy and Web/Desktop URLs too |

If you are the only person using this, a sandbox app does everything except
post publicly. Reading your own stats, ranking your catalog and pushing
drafts to your inbox all work.

A sandbox client key begins with `sb`. `doctor` points this out, because a
sandbox key that fails to authorize a colleague's account looks like a broken
credential rather than the restriction it is.

## The redirect URI

TikTok allows loopback addresses for desktop apps, which is what lets `auth`
finish in your terminal instead of asking you to paste a code out of a URL bar.

Register exactly:

    http://127.0.0.1:8481/callback/

Rules TikTok applies to these:

- Only `localhost` or `127.0.0.1` as the host
- A port is required, and `*` works as a wildcard
- No query string or fragment
- Under 512 characters, and at most 10 URIs per app

The trailing slash is part of the URI. A mismatch of one character produces a
generic parameter error at token exchange, which reads as a bad client key and
sends people looking in the wrong place.

If port 8481 is busy, run `auth --port 9000` and register that URI too, or
register `http://127.0.0.1:*/callback/` once and stop worrying about it.

## Scopes

Read-only, which is everything except publishing:

```
user.info.basic
user.info.profile
user.info.stats
video.list
```

`user.info.basic` alone does not include the follower count or the username.
TikTok moved those to `user.info.stats` and `user.info.profile`, so an app
asking only for basic gets an avatar and a display name and nothing else.

Publishing, which needs the Content Posting API product added first:

```
video.upload
video.publish
```

`video.upload` is the drafts path and `video.publish` is direct posting. Adding
upload alone is a reasonable place to stop: nothing goes public without you
finishing it in the app.

Never send a scope the app does not have. TikTok fails the entire sign-in
rather than granting the rest.

## Publishing from a URL

TikTok pulls media rather than accepting an upload, and only from a domain you
have proved you own.

1. **URL properties** at the top of the app page
2. **Verify properties**, with the app in the right mode
3. Verify by **Domain**, or by **URL prefix** and upload the signature file it
   gives you to that path

Then every `video_url` and every entry in `photo_urls` has to sit on that
domain. A signed URL from object storage on an unverified domain fails, however
public it is.

TikTok has one hour to download the file. A slow or bandwidth-limited origin
fails with `video_pull_failed`, and that one is worth retrying.

## The audit, if you want public posts

Until TikTok audits the app, every post lands private whatever privacy level
you send. The error code, when it blocks the call outright, is
`unaudited_client_can_only_post_to_private_accounts`.

Apply through the Content Posting API application in the developer portal. In
the meantime `SELF_ONLY` posts and the drafts tools both work, and drafts are
the better path: the post ends up public with the creator's own hand on it.

## Token lifetimes

| Credential | Lives |
|---|---|
| Access token | 24 hours |
| Refresh token | 365 days. A refresh may return a different one, so the server keeps whatever comes back |

The server handles the first entirely. The second is why `doctor` exists: when
a year has passed the failure is a rejected token on every call, and the fix is
to run `auth` again.
