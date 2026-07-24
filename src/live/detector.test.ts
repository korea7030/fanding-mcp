import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultLiveSeriesTitleContainsStateKey,
  filterLiveSeriesTitleContainsPosts,
  normalizeTitleForContains,
} from "./detector.js";
import type { FandingListItem } from "../scraper/api.js";

function makeItem(overrides: Partial<FandingListItem> = {}): FandingListItem {
  return {
    iPostNo: 1,
    sTitle: "공지 긴급 점검 안내",
    sContentType: null,
    sInsDatetime: "2026-07-24T10:00:00",
    iLikeCount: 1,
    iReplyCount: 2,
    iViewCount: 3,
    iDuration: null,
    iCollectionNo: 100,
    sCollectionTitle: "시리즈",
    aCreator: {
      iCreatorNo: 1,
      sNickname: "creator",
      sCreatorUrl: "orlandokim",
    },
    ...overrides,
  };
}

test("normalizeTitleForContains: 기본값은 trim/space normalize/case-insensitive", () => {
  assert.equal(
    normalizeTitleForContains("  공지   긴급  ", {}),
    "공지 긴급"
  );
  assert.equal(
    normalizeTitleForContains("Hello", { case_sensitive: false }),
    "hello"
  );
  assert.equal(
    normalizeTitleForContains("Hello", { case_sensitive: true }),
    "Hello"
  );
});

test("filterLiveSeriesTitleContainsPosts: 제목 시작이 아니라 포함 조건으로 매칭", () => {
  const result = filterLiveSeriesTitleContainsPosts(
    [
      makeItem({ iPostNo: 10, sTitle: "공지 긴급 점검 안내" }),
      makeItem({ iPostNo: 11, sTitle: "긴급 공지", iCollectionNo: 200 }),
      makeItem({ iPostNo: 12, sTitle: "일반 공지" }),
    ],
    {
      member_url: "orlandokim",
      collection_no: 100,
      title_prefix: "긴급",
      include_unseen_only: false,
    }
  );

  assert.equal(result.source, "live_api");
  assert.equal(result.matched_count, 1);
  assert.equal(result.posts[0].post_no, 10);
  assert.equal(result.posts[0].is_new, true);
});

test("filterLiveSeriesTitleContainsPosts: include_unseen_only와 previous baseline 적용", () => {
  const result = filterLiveSeriesTitleContainsPosts(
    [
      makeItem({ iPostNo: 10, sTitle: "긴급 A" }),
      makeItem({ iPostNo: 12, sTitle: "B 긴급" }),
    ],
    {
      member_url: "orlandokim",
      collection_no: 100,
      title_prefix: "긴급",
      include_unseen_only: true,
    },
    10
  );

  assert.equal(result.matched_count, 2);
  assert.equal(result.new_count, 1);
  assert.deepEqual(result.posts.map((post) => post.post_no), [12]);
  assert.equal(result.latest_seen_post_no, 12);
  assert.equal(result.previous_seen_post_no, 10);
});

test("filterLiveSeriesTitleContainsPosts: since_post_no는 저장 state보다 우선", () => {
  const result = filterLiveSeriesTitleContainsPosts(
    [
      makeItem({ iPostNo: 12, sTitle: "긴급 A" }),
      makeItem({ iPostNo: 20, sTitle: "긴급 B" }),
    ],
    {
      member_url: "orlandokim",
      collection_no: 100,
      title_prefix: "긴급",
      include_unseen_only: true,
      since_post_no: 15,
    },
    100
  );

  assert.deepEqual(result.posts.map((post) => post.post_no), [20]);
  assert.equal(result.previous_seen_post_no, 15);
});

test("filterLiveSeriesTitleContainsPosts: ignore_state=true면 저장 state 무시", () => {
  const result = filterLiveSeriesTitleContainsPosts(
    [makeItem({ iPostNo: 12, sTitle: "긴급 A" })],
    {
      member_url: "orlandokim",
      collection_no: 100,
      title_prefix: "긴급",
      include_unseen_only: true,
      ignore_state: true,
    },
    100
  );

  assert.deepEqual(result.posts.map((post) => post.post_no), [12]);
  assert.equal(result.previous_seen_post_no, undefined);
});

test("defaultLiveSeriesTitleContainsStateKey: contains 정책 key 사용", () => {
  assert.equal(
    defaultLiveSeriesTitleContainsStateKey("orlandokim", 100, "긴급"),
    "series_title_contains:orlandokim:100:긴급"
  );
});
