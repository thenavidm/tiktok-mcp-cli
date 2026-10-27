/**
 * Publishing, and the draft path that works before your app is audited.
 *
 * Order matters here and getting it wrong is the most common failure: call
 * `get_creator_info` first. The privacy level you pass has to be one of the
 * values it returns for that account, and TikTok rejects the post outright
 * rather than falling back to a safe default.
 *
 * A video comes from a URL or from a file on this machine. By URL
 * (`PULL_FROM_URL`) TikTok pulls the file from a domain you have proved you own
 * under URL Properties, so a link to a bucket you have not verified fails with
 * `url_ownership_unverified` no matter how public the file is. From a file
 * (`FILE_UPLOAD`) no domain is involved: the init call declares the size and
 * chunks, and the file goes to the upload_url TikTok returns, inside the hour
 * that URL lasts. Photos take URLs only: TikTok's photo posts allow nothing but
 * `PULL_FROM_URL`.
 */

import { UsageError } from "@thenavidm/slipway";
import { z } from "zod";
import { localVideo, sendChunks, type LocalVideo } from "../api/upload.js";
import { accountArg, confirmArg, defineTool, type AnyToolSpec, type ToolContext } from "./kit.js";
import type { ToolContext as RunContext } from "@thenavidm/slipway";

const PRIVACY = z
  .enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"])
  .describe(
    "Must be one of the values get_creator_info returns in privacy_level_options for this account. A private account cannot use PUBLIC_TO_EVERYONE, and passing it fails the call.",
  );

/* TikTok requires both brand toggles on every direct post, so they default
   rather than being optional in the payload. Declaring a paid partnership you
   do not have is a disclosure problem, so the default is false both ways. */
const BRAND = {
  brand_content_toggle: z
    .boolean()
    .optional()
    .describe("True if this is a paid partnership promoting somebody else's business. Defaults false."),
  brand_organic_toggle: z
    .boolean()
    .optional()
    .describe("True if this promotes the creator's own business. Defaults false."),
};

/** The two ways to hand TikTok a video. Exactly one is passed. */
const VIDEO_SOURCE = {
  video_url: z
    .string()
    .url()
    .optional()
    .describe(
      "Public URL of the video file (PULL_FROM_URL). Its domain must be verified under URL Properties in your TikTok app, and TikTok has one hour to download it. Pass this or video_path.",
    ),
  video_path: z
    .string()
    .optional()
    .describe(
      "A video file on the machine running this server (FILE_UPLOAD): MP4, WebM or MOV, up to 4 GB. Needs no verified domain. It is sent in chunks before the call returns. Pass this or video_url.",
    ),
};

type Source = { source_info: Record<string, unknown>; local?: LocalVideo };

/** Pick the source TikTok's init call needs, and check a local file before anything is sent. */
async function videoSource(args: { video_url?: string; video_path?: string }): Promise<Source> {
  if (args.video_url && args.video_path) throw new UsageError("Pass video_url or video_path, not both.");
  if (args.video_url) return { source_info: { source: "PULL_FROM_URL", video_url: args.video_url } };
  if (!args.video_path) throw new UsageError("Pass the video: video_url for a file on your verified domain, or video_path for a file on this machine.");
  const local = await localVideo(args.video_path);
  return { source_info: { source: "FILE_UPLOAD", ...local.plan }, local };
}

/** After init: send a local file to the upload_url, reporting progress as it goes. */
async function sendLocal(
  local: LocalVideo,
  result: { publish_id?: string; upload_url?: string },
  ctx: RunContext<ToolContext>,
): Promise<Record<string, unknown>> {
  if (!result.upload_url) {
    throw new UsageError("TikTok accepted the post but returned no upload_url to send the file to. Check get_post_status before trying again.");
  }
  await sendChunks(result.upload_url, local, {
    publishId: result.publish_id,
    signal: ctx.signal,
    onProgress: (sent, total) => void ctx.progress(sent, total, `sent ${(sent / 1e6).toFixed(1)} of ${(total / 1e6).toFixed(1)} MB`),
  });
  return { source: "FILE_UPLOAD", file: local.name, bytes: local.size, chunks: local.plan.total_chunk_count };
}

const summaryOf = (args: { video_url?: string; video_path?: string }): string =>
  args.video_path ? ` from ${args.video_path.split(/[\\/]/).pop()}` : "";

const getCreatorInfo = defineTool({
  name: "get_creator_info",
  title: "Read posting permissions",
  description:
    "What this account is allowed to post: which privacy levels are available, whether comments, duet or stitch are switched off, and the longest video it may upload. Call this before post_video or post_photos. TikTok requires the privacy level to come from the list this returns, and it changes when the creator flips their account private.",
  schema: { ...accountArg },
  risk: "read",
  handler: async ({ account }, ctx) =>
    ctx.client(account).request("POST", "/post/publish/creator_info/query/"),
});

const postVideo = defineTool({
  name: "post_video",
  title: "Publish a video to TikTok",
  description:
    "Publish a video straight to the account (Direct Post), from a public URL on your verified domain or from a file on this machine. A file is sent in chunks before the call returns. Returns a publish_id; poll get_post_status with it, because TikTok processes the video after it has it, and the post is live only at PUBLISH_COMPLETE. While your app is unaudited every post lands private no matter which privacy_level you pass. TikTok's API cannot delete a post: only the TikTok app can.",
  schema: {
    ...VIDEO_SOURCE,
    title: z
      .string()
      .optional()
      .describe("The caption. Hashtags and @mentions work inline. Up to 2200 UTF-16 units."),
    privacy_level: PRIVACY,
    disable_comment: z.boolean().optional(),
    disable_duet: z.boolean().optional(),
    disable_stitch: z.boolean().optional(),
    video_cover_timestamp_ms: z
      .number()
      .int()
      .optional()
      .describe("Which frame to use as the cover, in milliseconds. Defaults to the first frame."),
    is_aigc: z
      .boolean()
      .optional()
      .describe("True if the video is AI-generated. Adds TikTok's AI-generated label to the description."),
    ...BRAND,
    ...confirmArg,
    ...accountArg,
  },
  risk: "destructive",
  // 2.0 took the URL as a bare word, when it was the first required argument.
  positional: ["video_url"],
  consequence:
    "posts the video directly to the creator's TikTok account at the chosen privacy level once TikTok has processed it, and only the TikTok app can delete it",
  summary: (args) =>
    `Publish a video${summaryOf(args)} at ${args.privacy_level}${args.title ? ` captioned "${String(args.title).slice(0, 60)}"` : ""}.`,
  handler: async (args, ctx) => {
    const { source_info, local } = await videoSource(args);
    const result = (await ctx.client(args.account).request("POST", "/post/publish/video/init/", {
      body: {
        post_info: {
          privacy_level: args.privacy_level,
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.disable_comment !== undefined ? { disable_comment: args.disable_comment } : {}),
          ...(args.disable_duet !== undefined ? { disable_duet: args.disable_duet } : {}),
          ...(args.disable_stitch !== undefined ? { disable_stitch: args.disable_stitch } : {}),
          ...(args.video_cover_timestamp_ms !== undefined
            ? { video_cover_timestamp_ms: args.video_cover_timestamp_ms }
            : {}),
          ...(args.is_aigc !== undefined ? { is_aigc: args.is_aigc } : {}),
          brand_content_toggle: args.brand_content_toggle ?? false,
          brand_organic_toggle: args.brand_organic_toggle ?? false,
        },
        source_info,
      },
    })) as { publish_id?: string; upload_url?: string };

    if (local) {
      return {
        publish_id: result.publish_id ?? null,
        status: "uploaded",
        ...(await sendLocal(local, result, ctx)),
        next: "Poll get_post_status with this publish_id: PROCESSING_UPLOAD while TikTok takes in the file, then PUBLISH_COMPLETE. A public post only reports its post_id once TikTok's moderation clears it.",
      };
    }
    return {
      publish_id: result.publish_id ?? null,
      status: "accepted",
      next: "Poll get_post_status with this publish_id. A public post only reports its post_id once TikTok's moderation clears it, usually within a minute.",
    };
  },
});

const postPhotos = defineTool({
  name: "post_photos",
  title: "Publish a photo carousel to TikTok",
  description:
    "Publish a photo carousel of up to 35 images from public URLs. Returns a publish_id; poll get_post_status with it. Same domain-verification and audit rules as post_video. Photos come from URLs only: TikTok's photo posts accept PULL_FROM_URL and no file upload, so a local image has to be hosted on your verified domain first.",
  schema: {
    photo_urls: z
      .array(z.string().url())
      .min(1)
      .max(35)
      .describe("Public image URLs, in the order they should appear. Their domain must be verified in your TikTok app."),
    photo_cover_index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Zero-based index of the image to use as the cover. Default 0."),
    title: z.string().optional().describe("Post title. Up to 90 UTF-16 units, shorter than a video caption."),
    description: z.string().optional().describe("Post description. Up to 4000 UTF-16 units."),
    privacy_level: PRIVACY,
    disable_comment: z.boolean().optional(),
    auto_add_music: z
      .boolean()
      .optional()
      .describe("Let TikTok pick a soundtrack. The creator can change it later in the app."),
    is_aigc: z.boolean().optional(),
    ...BRAND,
    ...confirmArg,
    ...accountArg,
  },
  risk: "destructive",
  consequence:
    "posts the photos directly to the creator's TikTok account at the chosen privacy level once TikTok has processed them, and only the TikTok app can delete them",
  summary: ({ photo_urls, privacy_level }) =>
    `Publish a ${photo_urls.length}-photo carousel at ${privacy_level}.`,
  handler: async (args, ctx) => {
    const result = (await ctx.client(args.account).request("POST", "/post/publish/content/init/", {
      body: {
        media_type: "PHOTO",
        post_mode: "DIRECT_POST",
        ...(args.is_aigc !== undefined ? { is_aigc: args.is_aigc } : {}),
        post_info: {
          privacy_level: args.privacy_level,
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
          ...(args.disable_comment !== undefined ? { disable_comment: args.disable_comment } : {}),
          ...(args.auto_add_music !== undefined ? { auto_add_music: args.auto_add_music } : {}),
          brand_content_toggle: args.brand_content_toggle ?? false,
          brand_organic_toggle: args.brand_organic_toggle ?? false,
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_images: args.photo_urls,
          photo_cover_index: args.photo_cover_index ?? 0,
        },
      },
    })) as { publish_id?: string };

    return { publish_id: result.publish_id ?? null, status: "accepted", next: "Poll get_post_status." };
  },
});

const draftVideo = defineTool({
  name: "send_video_to_drafts",
  title: "Send a video to the TikTok inbox",
  description:
    "Send a video to the account's TikTok inbox instead of publishing it, from a public URL on your verified domain or from a file on this machine. The creator gets a notification and finishes the post in the app, so nothing goes public without them. Needs only video.upload, which makes this the path that works before your app passes the Content Posting audit. TikTok allows at most 5 unpublished drafts from the API in any 24 hours.",
  schema: { ...VIDEO_SOURCE, ...accountArg },
  risk: "write",
  positional: ["video_url"],
  summary: (args) => `Send a video${summaryOf(args)} to the TikTok inbox as a draft.`,
  handler: async (args, ctx) => {
    const { source_info, local } = await videoSource(args);
    const result = (await ctx.client(args.account).request("POST", "/post/publish/inbox/video/init/", {
      body: { source_info },
    })) as { publish_id?: string; upload_url?: string };
    if (local) {
      return {
        publish_id: result.publish_id ?? null,
        status: "uploaded",
        ...(await sendLocal(local, result, ctx)),
        next: "Poll get_post_status: SEND_TO_USER_INBOX once it has arrived, and the creator finishes it from the notification in the TikTok app.",
      };
    }
    return {
      publish_id: result.publish_id ?? null,
      status: "sent_to_inbox",
      next: "The creator opens the notification in the TikTok app to finish and publish it.",
    };
  },
});

const draftPhotos = defineTool({
  name: "send_photos_to_drafts",
  title: "Send a photo carousel to the TikTok inbox",
  description:
    "Send photos to the account's TikTok inbox for the creator to finish in the app. Needs only video.upload. The creator's TikTok app must be version 31.8 or newer or TikTok rejects it. Photos come from URLs on your verified domain only: TikTok's photo posts accept no file upload.",
  schema: {
    photo_urls: z.array(z.string().url()).min(1).max(35),
    photo_cover_index: z.number().int().min(0).optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    ...accountArg,
  },
  risk: "write",
  summary: ({ photo_urls }) => `Send ${photo_urls.length} photos to the TikTok inbox.`,
  handler: async (args, ctx) => {
    const result = (await ctx.client(args.account).request("POST", "/post/publish/content/init/", {
      body: {
        media_type: "PHOTO",
        post_mode: "MEDIA_UPLOAD",
        post_info: {
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_images: args.photo_urls,
          photo_cover_index: args.photo_cover_index ?? 0,
        },
      },
    })) as { publish_id?: string };
    return { publish_id: result.publish_id ?? null, status: "sent_to_inbox" };
  },
});

const getPostStatus = defineTool({
  name: "get_post_status",
  title: "Check what happened to a post",
  description:
    "Track a post created by post_video, post_photos or either drafts tool. Statuses: PROCESSING_UPLOAD while a file sent from this machine is still arriving (uploaded_bytes says how much), PROCESSING_DOWNLOAD while TikTok fetches a URL, SEND_TO_USER_INBOX for a draft that arrived, PUBLISH_COMPLETE when it is posted, FAILED with a fail_reason. A public post only reports its post_id after moderation clears it, which is usually a minute but can be hours, so an empty post_id on a PUBLISH_COMPLETE is normal rather than an error.",
  schema: {
    publish_id: z.string().describe("The publish_id returned when the post was created."),
    ...accountArg,
  },
  risk: "read",
  handler: async ({ publish_id, account }, ctx) =>
    ctx.client(account).request("POST", "/post/publish/status/fetch/", { body: { publish_id } }),
});

export const PUBLISH_TOOLS: AnyToolSpec[] = [
  getCreatorInfo,
  postVideo,
  postPhotos,
  draftVideo,
  draftPhotos,
  getPostStatus,
] as unknown as AnyToolSpec[];
