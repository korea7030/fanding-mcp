import { test } from "node:test";
import assert from "node:assert/strict";
import { mapApiPostToDb, mapListItemToDb } from "./mapper.js";
import type { FandingPost, FandingListItem } from "./api.js";

test("mapApiPostToDb: 필드 매핑과 HTML 스트립", () => {
  const apiPost = {
    iPostNo: 123,
    sTitle: "title",
    sContent: "<p>hello <b>world</b></p>",
    sInsDatetime: "2026-01-01",
    aCreatorInfo: { iCreatorNo: 1, sNickname: "author", sCreatorUrl: "slug" },
    iLikeCount: 1,
    iViewCount: 2,
    iReplyCount: 3,
    iDuration: 100,
    aFileList: [],
    aMediaList: {},
    aCollectionData: null,
  } as unknown as FandingPost;

  const post = mapApiPostToDb(apiPost, null);
  assert.equal(post.id, "123");
  assert.equal(post.content, "hello world");
  assert.equal(post.content_html, "<p>hello <b>world</b></p>");
  assert.equal(post.url, "https://fanding.kr/slug/post/123");
  assert.equal(post.has_video, 0);
  assert.equal(post.collection_no, null);
  assert.equal(post.collection_title, null);
});

test("mapApiPostToDb: 시리즈 정보 매핑", () => {
  const apiPost = {
    iPostNo: 123,
    sTitle: "title",
    sContent: "",
    sInsDatetime: "2026-01-01",
    aCreatorInfo: { iCreatorNo: 1, sNickname: "author", sCreatorUrl: "slug" },
    aFileList: [],
    aMediaList: {},
    aCollectionData: {
      iCollectionNo: 10,
      sCollectionTitle: "시리즈",
      iCollectionPostOrder: 2,
      iPostCount: 5,
    },
  } as unknown as FandingPost;

  const post = mapApiPostToDb(apiPost, null);
  assert.equal(post.collection_no, 10);
  assert.equal(post.collection_title, "시리즈");
  assert.equal(post.collection_post_order, 2);
  assert.equal(post.collection_post_count, 5);
});

test("mapApiPostToDb: 영상 파일이 있으면 has_video=1", () => {
  const apiPost = {
    iPostNo: 1,
    sTitle: "t",
    sContent: "",
    sInsDatetime: "2026-01-01",
    aCreatorInfo: { iCreatorNo: 1, sNickname: "a", sCreatorUrl: "slug" },
    aFileList: [{ sType: "video", sFullUploadUrl: "https://x/v.mp4" }],
    aMediaList: {},
    aCollectionData: null,
  } as unknown as FandingPost;

  assert.equal(mapApiPostToDb(apiPost, null).has_video, 1);
});

test("mapListItemToDb: 영상 콘텐츠 타입 + duration 기준 has_video 판정", () => {
  const videoItem = {
    iPostNo: 1,
    sTitle: "t",
    sContentType: "M",
    sInsDatetime: "2026-01-01",
    iLikeCount: 0,
    iReplyCount: 0,
    iViewCount: 0,
    iDuration: 60,
    iCollectionNo: null,
    aCreator: { iCreatorNo: 1, sNickname: "a", sCreatorUrl: "slug" },
  } as unknown as FandingListItem;
  assert.equal(mapListItemToDb(videoItem).has_video, 1);

  const textItem = { ...videoItem, sContentType: null, iDuration: null } as unknown as FandingListItem;
  assert.equal(mapListItemToDb(textItem).has_video, 0);
  assert.equal(mapListItemToDb(textItem).content, "");
});

test("mapListItemToDb: 시리즈 정보 매핑", () => {
  const item = {
    iPostNo: 1,
    sTitle: "t",
    sContentType: null,
    sInsDatetime: "2026-01-01",
    iLikeCount: 0,
    iReplyCount: 0,
    iViewCount: 0,
    iDuration: null,
    iCollectionNo: 10,
    sCollectionTitle: "목록 시리즈",
    iCollectionPostOrder: 3,
    iCollectionPostCount: 7,
    aCreator: { iCreatorNo: 1, sNickname: "a", sCreatorUrl: "slug" },
  } as unknown as FandingListItem;

  const post = mapListItemToDb(item);
  assert.equal(post.collection_no, 10);
  assert.equal(post.collection_title, "목록 시리즈");
  assert.equal(post.collection_post_order, 3);
  assert.equal(post.collection_post_count, 7);
});
