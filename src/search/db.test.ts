import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import type { Post } from "./db.js";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "1",
    post_no: 1,
    title: "hello world",
    content: "some content about AI",
    content_html: "<p>some content about AI</p>",
    author: "author",
    creator_no: 1,
    creator_url: "slug",
    published_at: "2026-01-01",
    url: "https://fanding.kr/slug/post/1",
    like_count: 5,
    view_count: 10,
    reply_count: 1,
    duration: 0,
    has_video: 0,
    collection_no: null,
    collection_title: null,
    collection_post_order: null,
    collection_post_count: null,
    summary: null,
    indexed_at: "2026-01-01",
    ...overrides,
  };
}

// db.ts는 모듈 로드 시점에 DATA_DIR을 계산하므로, 정적 import로는 이 값을 오버라이드할
// 수 없다 (import는 파일 상단으로 호이스팅되어 아래 env 설정보다 먼저 평가된다).
// 각 테스트가 독립된 임시 DB를 쓰도록 동적 import로 db.js를 불러온다.
async function freshDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fanding-mcp-test-"));
  process.env.FANDING_DATA_DIR = tmpDir;
  const mod = await import(`./db.js?t=${Date.now()}-${Math.random()}`);
  return { ...mod, tmpDir };
}

test("upsertPost: insert then update (FTS5 sync 회귀 테스트)", async () => {
  const { upsertPost, getRecentPosts, tmpDir } = await freshDb();

  upsertPost(makePost());
  upsertPost(makePost({ title: "hello world updated", like_count: 99 }));

  const recent = getRecentPosts(10);
  assert.equal(recent.length, 1, "upsert가 새 행을 만들면 안 되고 기존 행을 갱신해야 함");
  assert.equal(recent[0].title, "hello world updated");
  assert.equal(recent[0].like_count, 99);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("searchPosts: FTS5 전문검색이 매치/논매치를 정확히 반환", async () => {
  const { upsertPost, searchPosts, tmpDir } = await freshDb();

  upsertPost(makePost({ id: "1", post_no: 1, title: "반도체 시장 분석", content: "삼성전자 하이닉스" }));
  upsertPost(makePost({ id: "2", post_no: 2, title: "여행 후기", content: "제주도 다녀왔어요" }));

  assert.equal(searchPosts("반도체").length, 1);
  assert.equal(searchPosts("존재하지않는단어xyz").length, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("getTopPosts: like/view/reply 기준 정렬", async () => {
  const { upsertPost, getTopPosts, tmpDir } = await freshDb();

  upsertPost(makePost({ id: "1", post_no: 1, like_count: 5, view_count: 100 }));
  upsertPost(makePost({ id: "2", post_no: 2, like_count: 50, view_count: 10 }));

  const byLike = getTopPosts("like", 10);
  assert.equal(byLike[0].post_no, 2);

  const byView = getTopPosts("view", 10);
  assert.equal(byView[0].post_no, 1);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("listSeries: 저장된 시리즈 목록과 인덱싱 수 반환", async () => {
  const { upsertPost, listSeries, tmpDir } = await freshDb();

  upsertPost(makePost({
    id: "101",
    post_no: 101,
    collection_no: 300,
    collection_title: "시리즈 A",
    collection_post_order: 1,
    collection_post_count: 3,
  }));
  upsertPost(makePost({
    id: "102",
    post_no: 102,
    collection_no: 300,
    collection_title: "시리즈 A",
    collection_post_order: 2,
    collection_post_count: 3,
    published_at: "2026-01-02",
  }));
  upsertPost(makePost({ id: "103", post_no: 103, collection_no: null }));

  const series = listSeries();
  const target = series.find((s) => s.collection_no === 300);
  assert.ok(target);
  assert.equal(target.post_count, 3);
  assert.equal(target.indexed_post_count, 2);
  assert.equal(target.latest_published_at, "2026-01-02");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("getSeriesPosts: 시리즈 안에서 query/date/영상/랭킹 필터와 정렬 적용", async () => {
  const { upsertPost, getSeriesPosts, tmpDir } = await freshDb();

  upsertPost(makePost({
    id: "201",
    post_no: 201,
    title: "AI 첫 강의",
    content: "머신러닝 기초",
    collection_no: 500,
    collection_post_order: 2,
    published_at: "2026-01-01T10:00:00",
    like_count: 10,
    view_count: 100,
    has_video: 1,
  }));
  upsertPost(makePost({
    id: "202",
    post_no: 202,
    title: "AI 둘째 강의",
    content: "딥러닝 심화",
    collection_no: 500,
    collection_post_order: 1,
    published_at: "2026-01-02T10:00:00",
    like_count: 50,
    view_count: 20,
    has_video: 0,
  }));
  upsertPost(makePost({
    id: "203",
    post_no: 203,
    title: "다른 시리즈",
    content: "머신러닝",
    collection_no: 400,
    collection_post_order: 1,
    published_at: "2026-01-01T10:00:00",
    like_count: 100,
    view_count: 1000,
    has_video: 1,
  }));

  const seriesOrder = getSeriesPosts(500, { order: "series" });
  assert.deepEqual(seriesOrder.map((p) => p.post_no), [202, 201]);

  const filtered = getSeriesPosts(500, {
    query: "머신러닝",
    date: "2026-01-01",
    has_video: true,
    min_like: 5,
    min_view: 50,
    order: "like",
  });
  assert.deepEqual(filtered.map((p) => p.post_no), [201]);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
