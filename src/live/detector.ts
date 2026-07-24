import * as fs from "fs";
import * as path from "path";
import { DATA_DIR } from "../paths.js";
import type { FandingListItem } from "../scraper/api.js";

export interface LiveSeriesTitleContainsOptions {
  member_url: string;
  collection_no: number;
  title_prefix: string;
  limit?: number;
  state_key?: string;
  since_post_no?: number;
  update_state?: boolean;
  include_unseen_only?: boolean;
  ignore_state?: boolean;
  case_sensitive?: boolean;
  trim_title?: boolean;
  normalize_space?: boolean;
  dry_run?: boolean;
}

export interface LiveSeriesTitleContainsPost {
  post_no: number;
  title: string;
  published_at?: string;
  url: string;
  collection_no?: number;
  collection_title?: string;
  author?: string;
  like_count?: number;
  view_count?: number;
  reply_count?: number;
  is_new: boolean;
}

export interface LivePrefixStateEntry {
  last_seen_post_no: number;
  updated_at: string;
}

export type LivePrefixState = Record<string, LivePrefixStateEntry>;

export interface LiveSeriesTitleContainsResult {
  ok: true;
  source: "live_api";
  member_url: string;
  collection_no: number;
  title_prefix: string;
  checked_at: string;
  latest_seen_post_no?: number;
  previous_seen_post_no?: number;
  matched_count: number;
  new_count: number;
  posts: LiveSeriesTitleContainsPost[];
  state?: {
    key: string;
    previous_last_seen_post_no?: number;
    updated_last_seen_post_no?: number;
    updated: boolean;
  };
}

export function livePrefixStatePath(): string {
  return path.join(DATA_DIR, "live-prefix-state.json");
}

export function defaultLiveSeriesTitleContainsStateKey(
  memberUrl: string,
  collectionNo: number,
  titlePrefix: string
): string {
  return `series_title_contains:${memberUrl}:${collectionNo}:${titlePrefix}`;
}

export function readLivePrefixState(statePath = livePrefixStatePath()): LivePrefixState {
  if (!fs.existsSync(statePath)) return {};
  return JSON.parse(fs.readFileSync(statePath, "utf-8")) as LivePrefixState;
}

export function writeLivePrefixState(
  state: LivePrefixState,
  statePath = livePrefixStatePath()
): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function normalizeTitleForContains(
  value: string,
  options: Pick<LiveSeriesTitleContainsOptions, "case_sensitive" | "trim_title" | "normalize_space">
): string {
  let title = value;
  if (options.normalize_space ?? true) title = title.replace(/\s+/g, " ");
  if (options.trim_title ?? true) title = title.trim();
  if (!(options.case_sensitive ?? false)) title = title.toLocaleLowerCase();
  return title;
}

export function getListItemCollectionNo(item: FandingListItem): number | null {
  return item.aCollectionData?.iCollectionNo ?? item.iCollectionNo ?? null;
}

export function getListItemCollectionTitle(item: FandingListItem): string | undefined {
  return item.aCollectionData?.sCollectionTitle ?? item.sCollectionTitle ?? undefined;
}

export function filterLiveSeriesTitleContainsPosts(
  items: FandingListItem[],
  options: LiveSeriesTitleContainsOptions,
  previousLastSeenPostNo?: number
): Omit<LiveSeriesTitleContainsResult, "checked_at" | "state"> {
  const normalizedNeedle = normalizeTitleForContains(options.title_prefix, options);
  const baseline = options.since_post_no ?? (options.ignore_state ? 0 : previousLastSeenPostNo ?? 0);

  const matchingPosts = items
    .filter((item) => getListItemCollectionNo(item) === options.collection_no)
    .filter((item) =>
      normalizeTitleForContains(item.sTitle ?? "", options).includes(normalizedNeedle)
    )
    .map((item) => {
      const collectionNo = getListItemCollectionNo(item) ?? undefined;
      const postNo = item.iPostNo;
      return {
        post_no: postNo,
        title: item.sTitle,
        published_at: item.sInsDatetime,
        url: `https://fanding.kr/${item.aCreator.sCreatorUrl}/post/${postNo}`,
        collection_no: collectionNo,
        collection_title: getListItemCollectionTitle(item),
        author: item.aCreator.sNickname,
        like_count: item.iLikeCount ?? 0,
        view_count: item.iViewCount ?? 0,
        reply_count: item.iReplyCount ?? 0,
        is_new: postNo > baseline,
      };
    })
    .sort((a, b) => b.post_no - a.post_no);

  const posts = (options.include_unseen_only ?? true)
    ? matchingPosts.filter((post) => post.is_new)
    : matchingPosts;

  return {
    ok: true,
    source: "live_api",
    member_url: options.member_url,
    collection_no: options.collection_no,
    title_prefix: options.title_prefix,
    latest_seen_post_no: matchingPosts[0]?.post_no,
    previous_seen_post_no: baseline || undefined,
    matched_count: matchingPosts.length,
    new_count: matchingPosts.filter((post) => post.is_new).length,
    posts,
  };
}
