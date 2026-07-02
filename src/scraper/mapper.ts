import type { FandingPost, FandingListItem } from "./api.js";
import type { Post } from "../search/db.js";

export function mapApiPostToDb(
  post: FandingPost,
  summary: string | null
): Post {
  const postNo = post.iPostNo;
  const creatorUrl = post.aCreatorInfo.sCreatorUrl;
  const videoFile = post.aFileList?.find((f) => f.sType === "video");

  return {
    id: String(postNo),
    post_no: postNo,
    title: post.sTitle,
    content: stripHtml(post.sContent ?? ""),
    content_html: post.sContent ?? "",
    author: post.aCreatorInfo.sNickname,
    creator_no: post.aCreatorInfo.iCreatorNo,
    creator_url: creatorUrl,
    published_at: post.sInsDatetime,
    url: `https://fanding.kr/${creatorUrl}/post/${postNo}`,
    like_count: post.iLikeCount ?? 0,
    view_count: post.iViewCount ?? 0,
    reply_count: post.iReplyCount ?? 0,
    duration: post.iDuration ?? 0,
    has_video: videoFile || post.aMediaList?.sVideoUploadUrl ? 1 : 0,
    collection_title: post.aCollectionData?.sCollectionTitle ?? null,
    summary,
    indexed_at: new Date().toISOString(),
  };
}

export function mapListItemToDb(item: FandingListItem): Post {
  const creatorUrl = item.aCreator.sCreatorUrl;
  return {
    id: String(item.iPostNo),
    post_no: item.iPostNo,
    title: item.sTitle,
    content: "",
    content_html: "",
    author: item.aCreator.sNickname,
    creator_no: item.aCreator.iCreatorNo,
    creator_url: creatorUrl,
    published_at: item.sInsDatetime,
    url: `https://fanding.kr/${creatorUrl}/post/${item.iPostNo}`,
    like_count: item.iLikeCount ?? 0,
    view_count: item.iViewCount ?? 0,
    reply_count: item.iReplyCount ?? 0,
    duration: item.iDuration ?? 0,
    has_video: item.sContentType === "M" && (item.iDuration ?? 0) > 0 ? 1 : 0,
    collection_title: null,
    summary: null,
    indexed_at: new Date().toISOString(),
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
