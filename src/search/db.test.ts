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
    collection_title: null,
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
