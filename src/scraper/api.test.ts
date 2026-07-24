import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedMediaUrl, extractAttachedFiles, extractVideoUrl, stripHtml } from "./api.js";
import type { FandingPost } from "./api.js";

test("isAllowedMediaUrl: Fanding CDN exact host만 허용 (SSRF 가드 회귀 테스트)", () => {
  assert.equal(isAllowedMediaUrl("https://video.cdn.fanding.com/file.mp4"), true);
  assert.equal(isAllowedMediaUrl("https://file.cdn.fanding.com/file.pdf"), true);
  assert.equal(isAllowedMediaUrl("https://cdn.fanding.com/file.pdf"), true);

  assert.equal(isAllowedMediaUrl("http://169.254.169.254/latest/meta-data/"), false, "내부 IP 차단");
  assert.equal(isAllowedMediaUrl("https://evil.com/steal"), false, "무관한 도메인 차단");
  assert.equal(isAllowedMediaUrl("https://fanding.com.evil.com/steal"), false, "도메인 스푸핑 차단");
  assert.equal(isAllowedMediaUrl("https://x.video.cdn.fanding.com/steal"), false, "하위 도메인 확장 차단");
  assert.equal(isAllowedMediaUrl("https://dcjnmis8jxmbl.cloudfront.net/file.pdf"), false, "범용 cloudfront 차단");
  assert.equal(isAllowedMediaUrl("http://video.cdn.fanding.com/insecure"), false, "http 차단");
  assert.equal(isAllowedMediaUrl("not a url"), false);
});

test("extractAttachedFiles: fd-editor-file 링크 파싱", () => {
  const html =
    '<a class="fd-editor-file" href="https://file.cdn.fanding.com/f.pdf" data-fd-name="my file.pdf" data-fd-size="12345"></a>';
  const files = extractAttachedFiles({ sContent: html } as FandingPost);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "my file.pdf");
  assert.equal(files[0].sizeBytes, 12345);
});

test("extractAttachedFiles: 첨부파일 없으면 빈 배열", () => {
  assert.deepEqual(extractAttachedFiles({ sContent: "<p>그냥 텍스트</p>" } as FandingPost), []);
});

test("extractVideoUrl: aMediaList 우선, 없으면 aFileList의 video 항목", () => {
  const withMediaList = {
    aMediaList: { sVideoUploadUrl: "https://x/video.m3u8" },
    aFileList: [],
  } as unknown as FandingPost;
  assert.equal(extractVideoUrl(withMediaList), "https://x/video.m3u8");

  const withFileList = {
    aMediaList: {},
    aFileList: [{ sType: "video", sFullUploadUrl: "https://x/v2.mp4" }],
  } as unknown as FandingPost;
  assert.equal(extractVideoUrl(withFileList), "https://x/v2.mp4");

  const withNeither = { aMediaList: {}, aFileList: [] } as unknown as FandingPost;
  assert.equal(extractVideoUrl(withNeither), null);
});

test("stripHtml: 태그 제거 및 공백 정리", () => {
  assert.equal(stripHtml("<p>hello   <b>world</b></p>"), "hello world");
  assert.equal(stripHtml(""), "");
});
