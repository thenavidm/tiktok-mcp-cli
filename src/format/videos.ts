import { frame } from "./frame.js";

/**
 * Shaping TikTok's payloads for a model rather than passing raw JSON through.
 */

/** Every field on TikTok's Video Object. */
export const VIDEO_FIELDS =
  "id,create_time,cover_image_url,share_url,video_description,duration,height,width,title,embed_html,embed_link,like_count,comment_count,share_count,view_count,is_aigc";

/** Every User Object field across the three user.info scopes. */
export const USER_FIELDS =
  "open_id,union_id,avatar_url,avatar_large_url,display_name,bio_description,profile_deep_link,is_verified,username,follower_count,following_count,likes_count,video_count";

export type RawVideo = Record<string, unknown>;

export type Video = {
  id: string;
  url: string | null;
  posted_at: string | null;
  title: string | null;
  description: string | null;
  duration_seconds: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  engagement_rate: number | null;
  ai_generated: boolean | null;
  cover_image_url: string | null;
};

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * `create_time` is Unix SECONDS, unlike the pagination cursor on the same
 * endpoint, which is milliseconds. Mixing them up yields dates in 1970 or in
 * the far future, so both conversions live here rather than at each call site.
 */
export function shapeVideo(raw: RawVideo): Video {
  const views = num(raw.view_count);
  const likes = num(raw.like_count);
  const comments = num(raw.comment_count);
  const shares = num(raw.share_count);

  /* Engagement rate is computed here because every caller wants it and TikTok
     does not return it. Doing it once avoids a model dividing by a null. */
  const interactions = (likes ?? 0) + (comments ?? 0) + (shares ?? 0);
  const engagement = views && views > 0 ? Number(((interactions / views) * 100).toFixed(2)) : null;

  const created = num(raw.create_time);

  return {
    id: String(raw.id ?? ""),
    url: str(raw.share_url),
    posted_at: created ? new Date(created * 1000).toISOString() : null,
    title: str(raw.title),
    description: str(raw.video_description),
    duration_seconds: num(raw.duration),
    views,
    likes,
    comments,
    shares,
    engagement_rate: engagement,
    ai_generated: typeof raw.is_aigc === "boolean" ? raw.is_aigc : null,
    cover_image_url: str(raw.cover_image_url),
  };
}

/**
 * Captions are written by whoever posted them, and on a connected account that
 * is usually the user, but not always: a duet or a repost carries someone
 * else's words. Framing every caption uniformly is cheaper than deciding which
 * ones are trustworthy, and the cost is a few tokens per video.
 */
export function framedCaptions(videos: Video[]): string[] {
  return videos
    .filter((v) => v.description || v.title)
    .map((v) => frame(`Caption of video ${v.id}`, [v.title, v.description].filter(Boolean).join("\n")));
}

/** Percentile over a sorted copy. Used by the stats summary. */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx] ?? null;
}

export type StatsSummary = {
  videos_counted: number;
  covering: { from: string | null; to: string | null };
  views: { total: number; mean: number; median: number | null; p90: number | null; best: number | null };
  engagement_rate: { mean: number | null; median: number | null };
  posting_cadence_days: number | null;
};

/**
 * Aggregate a batch of videos.
 *
 * This exists so a model does not page a back catalogue into its context just
 * to work out an average. Median and p90 are reported alongside the mean
 * because a single viral video drags a mean far away from what a typical post
 * does, and "what does a normal post get" is the actual question.
 */
export function summarise(videos: Video[]): StatsSummary {
  const views = videos.map((v) => v.views).filter((v): v is number => v !== null);
  const rates = videos.map((v) => v.engagement_rate).filter((v): v is number => v !== null);
  const sortedViews = [...views].sort((a, b) => a - b);
  const sortedRates = [...rates].sort((a, b) => a - b);

  const dates = videos
    .map((v) => v.posted_at)
    .filter((d): d is string => d !== null)
    .sort();

  let cadence: number | null = null;
  if (dates.length > 1) {
    const first = new Date(dates[0]!).getTime();
    const last = new Date(dates[dates.length - 1]!).getTime();
    const days = (last - first) / 86_400_000;
    cadence = days > 0 ? Number((days / (dates.length - 1)).toFixed(1)) : null;
  }

  const total = views.reduce((a, b) => a + b, 0);
  const meanRate = rates.length ? Number((rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(2)) : null;

  return {
    videos_counted: videos.length,
    covering: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    views: {
      total,
      mean: views.length ? Math.round(total / views.length) : 0,
      median: percentile(sortedViews, 50),
      p90: percentile(sortedViews, 90),
      best: sortedViews[sortedViews.length - 1] ?? null,
    },
    engagement_rate: { mean: meanRate, median: percentile(sortedRates, 50) },
    posting_cadence_days: cadence,
  };
}
