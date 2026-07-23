import { request } from "undici";
import * as fs from "fs";
import * as path from "path";
import { getActiveSession, markExpired, type Session } from "../auth/session.js";
import { loginWithEmail, loginWithOAuth } from "../auth/login.js";

const BASE_URL = "https://fanding.kr/rest";

export interface FandingPost {
  iPostNo: number;
  sTitle: string;
  sContent: string;
  sInsDatetime: string;
  sContentType: string;
  iLikeCount: number;
  iReplyCount: number;
  iViewCount: number;
  iDuration: number;
  aCreatorInfo: {
    iMemberNo: number;
    iCreatorNo: number;
    sNickname: string;
    sCreatorUrl: string;
    sThumbnailUrl: string;
  };
  aMediaList: {
    sVideoUploadUrl: string | null;
    sIsConverting: string;
  };
  aFileList: FandingFile[];
  aCollectionData: {
    iCollectionNo: number;
    sCollectionTitle: string;
    iCollectionPostOrder: number;
    iPostCount: number;
  } | null;
  aAuthInfo: {
    sIsLock: string;
    sPublicRange: string;
    sIsFander: string;
  };
}

export interface FandingFile {
  iFileNo: number;
  sFileName: string;
  sType: "video" | "image";
  sFullUploadUrl: string;
  iDuration: number;
  iFileSize: number;
}

export interface FandingListItem {
  iPostNo: number;
  sTitle: string;
  sContentType: string | null;
  sInsDatetime: string;
  iLikeCount: number;
  iReplyCount: number;
  iViewCount: number;
  iDuration: number | null;
  iCollectionNo: number | null;
  sCollectionTitle?: string | null;
  iCollectionPostOrder?: number | null;
  iCollectionPostCount?: number | null;
  iPostCount?: number | null;
  aCollectionData?: {
    iCollectionNo?: number | null;
    sCollectionTitle?: string | null;
    iCollectionPostOrder?: number | null;
    iPostCount?: number | null;
  } | null;
  aCreator: {
    iCreatorNo: number;
    sNickname: string;
    sCreatorUrl: string;
  };
}

function buildCookieHeader(cookies: object[]): string {
  return (cookies as any[])
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

// 세션 만료 시 같은 로그인 방식으로 자동 재로그인한다. email은 자격증명만 있으면 완전
// 무인으로 가능하다. OAuth는 persistent 브라우저 프로필이 아직 로그인된 상태면 무인으로
// 가능하지만, 사람이 직접 인증해야 하는 상황이면 (REAUTH_REQUIRED) 여기서 명확한 에러로
// 바꿔서 던진다 - 무인 컨텍스트(트래킹 폴링 등)에서 브라우저를 띄운 채 무한정 기다리면 안 된다.
async function reLoginSameMethod(session: Session): Promise<string> {
  if (session.login_method === "email") {
    const email = process.env.FANDING_EMAIL;
    const password = process.env.FANDING_PASSWORD;
    if (!email || !password) {
      throw new Error(
        "세션이 만료되었고 FANDING_EMAIL/FANDING_PASSWORD가 없어 자동 재로그인할 수 없습니다. refresh_session을 다시 실행해주세요."
      );
    }
    return await loginWithEmail(email, password);
  }

  try {
    return await loginWithOAuth(session.login_method, { interactive: false });
  } catch {
    throw new Error(
      `세션이 만료되었고 ${session.login_method} 브라우저 프로필도 로그아웃되어 자동 재로그인할 수 없습니다. refresh_session을 다시 실행해주세요.`
    );
  }
}

// index_creator_posts처럼 짧은 시간에 API를 여러 번 연달아 호출하는 경로가 있어,
// fanding.kr을 과도하게 두들겨서 봇 탐지에 걸리지 않도록 요청 사이 최소 간격을 둔다.
const MIN_REQUEST_INTERVAL_MS = 300;
let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_RATE_LIMIT_RETRIES = 3;

interface ApiGetOptions {
  autoRelogin?: boolean;
}

async function apiGet<T>(
  path: string,
  session: Session,
  options: ApiGetOptions = {}
): Promise<T> {
  const autoRelogin = options.autoRelogin ?? true;
  const attempt = async (s: Session): Promise<T> => {
    for (let retry = 0; ; retry++) {
      await throttle();
      const cookieHeader = buildCookieHeader(s.cookies as object[]);
      const { statusCode, headers, body } = await request(`${BASE_URL}${path}`, {
        method: "GET",
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "ko-KR,ko;q=0.9",
          cookie: cookieHeader,
          referer: "https://fanding.kr/feeds",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        },
      });

      if (statusCode === 429) {
        if (retry >= MAX_RATE_LIMIT_RETRIES) {
          throw new Error("fanding.kr 요청 속도 제한(429)이 계속되어 중단했습니다. 잠시 후 다시 시도해주세요.");
        }
        const retryAfterHeader = headers["retry-after"];
        const retryAfterSec = Number(Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader);
        const backoffMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : 1000 * 2 ** retry;
        console.error(`[fanding-mcp] 429 응답, ${backoffMs}ms 대기 후 재시도 (${retry + 1}/${MAX_RATE_LIMIT_RETRIES})`);
        await sleep(backoffMs);
        continue;
      }

      const text = await body.text();

      if (statusCode === 401 || statusCode === 403) {
        markExpired(s.account_label);
        throw new Error("SESSION_EXPIRED");
      }

      const json = JSON.parse(text) as { bIsResult: boolean; sCode: string; aData: T };
      if (!json.bIsResult) {
        throw new Error(`API error: ${json.sCode}`);
      }

      return json.aData;
    }
  };

  try {
    return await attempt(session);
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "SESSION_EXPIRED" || !autoRelogin) throw err;

    console.error(`[fanding-mcp] 세션 만료 감지, ${session.login_method} 방식으로 자동 재로그인 시도`);
    const newLabel = await reLoginSameMethod(session);
    const newSession = getActiveSession(newLabel);
    if (!newSession) throw err;
    return await attempt(newSession);
  }
}

export async function fetchPost(
  postNo: number,
  accountLabel?: string,
  options: ApiGetOptions = {}
): Promise<FandingPost> {
  const session = getActiveSession(accountLabel);
  if (!session) throw new Error("No active session. Run refresh_session first.");

  const data = await apiGet<{ oPostData: FandingPost }>(
    `/post?iPostNo=${postNo}`,
    session,
    options
  );
  return data.oPostData;
}

// 특정 포스팅 기준 관련 목록 (같은 크리에이터의 최근 포스팅)
export async function fetchRelatedList(
  postNo: number,
  limit: number,
  session: Session,
  options: ApiGetOptions = {}
): Promise<FandingListItem[]> {
  const data = await apiGet<{ aPostList: FandingListItem[] }>(
    `/post/related_list?iLimit=${limit}&iPostNo=${postNo}`,
    session,
    options
  );
  return data.aPostList ?? [];
}

export interface FandingChannelSection {
  iSectionNo: number;
  sTitle: string;
  sType: "post_new" | "post_select" | "collection_select" | string;
  iTotalCount: number;
  aSectionItem: {
    aPostList?: FandingListItem[];
  };
}

// 크리에이터 홈 섹션 (최신 포스팅 목록 + 총 갯수 포함)
export async function fetchChannelSection(
  memberUrl: string,
  session: Session,
  options: ApiGetOptions = {}
): Promise<FandingChannelSection[]> {
  const data = await apiGet<{ iTotalCount: number; aSectionList: FandingChannelSection[] }>(
    `/channel/section?sMemberUrl=${memberUrl}&sTab=home`,
    session,
    options
  );
  return data.aSectionList ?? [];
}

export async function fetchRecentPostsForCreator(
  memberUrl: string,
  limit: number,
  session: Session,
  options: ApiGetOptions = {}
): Promise<FandingListItem[]> {
  const sections = await fetchChannelSection(memberUrl, session, options);
  const newSection = sections.find((s) => s.sType === "post_new");
  const latestPosts = newSection?.aSectionItem?.aPostList ?? [];
  if (latestPosts.length === 0 || limit <= 0) return [];

  const all = new Map<number, FandingListItem>();
  latestPosts.forEach((p) => all.set(p.iPostNo, p));

  let pivotPostNo = Math.min(...latestPosts.map((p) => p.iPostNo));
  while (all.size < limit) {
    const batch = await fetchRelatedList(pivotPostNo, Math.min(20, limit - all.size), session, options);
    if (batch.length === 0) break;

    let added = 0;
    for (const p of batch) {
      if (!all.has(p.iPostNo)) {
        all.set(p.iPostNo, p);
        added++;
      }
    }
    if (added === 0) break;

    pivotPostNo = Math.min(...batch.map((p) => p.iPostNo));
  }

  return Array.from(all.values()).sort((a, b) => b.iPostNo - a.iPostNo).slice(0, limit);
}

// related_list 역방향 순회로 전체 포스팅 수집
export async function fetchAllPostsForCreator(
  memberUrl: string,
  accountLabel?: string
): Promise<FandingListItem[]> {
  const session = getActiveSession(accountLabel);
  if (!session) throw new Error("No active session.");

  // 1. 최신 포스팅 번호 확인
  const sections = await fetchChannelSection(memberUrl, session);
  const newSection = sections.find((s) => s.sType === "post_new");
  const latestPosts = newSection?.aSectionItem?.aPostList ?? [];
  if (latestPosts.length === 0) return [];

  const totalCount = newSection?.iTotalCount ?? 0;
  const all = new Map<number, FandingListItem>();
  latestPosts.forEach((p) => all.set(p.iPostNo, p));

  // 2. related_list로 역방향 순회 (oldest iPostNo 기준으로 계속 요청)
  let pivotPostNo = Math.min(...latestPosts.map((p) => p.iPostNo));

  while (all.size < totalCount) {
    const batch = await fetchRelatedList(pivotPostNo, 20, session);
    if (batch.length === 0) break;

    let added = 0;
    for (const p of batch) {
      if (!all.has(p.iPostNo)) {
        all.set(p.iPostNo, p);
        added++;
      }
    }
    if (added === 0) break;

    pivotPostNo = Math.min(...batch.map((p) => p.iPostNo));
  }

  return Array.from(all.values()).sort((a, b) => b.iPostNo - a.iPostNo);
}

export function extractVideoUrl(post: FandingPost): string | null {
  if (post.aMediaList?.sVideoUploadUrl) return post.aMediaList.sVideoUploadUrl;
  const videoFile = post.aFileList.find((f) => f.sType === "video");
  return videoFile?.sFullUploadUrl ?? null;
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export interface FandingAttachedFile {
  url: string;
  name: string;
  sizeBytes: number;
}

// PDF 등 첨부파일은 aFileList(이미지/영상만 있음)에 없고, sContent HTML 안에
// <a class="fd-editor-file" href="..." data-fd-name="..." data-fd-size="..."> 형태로
// 박혀있다 (실측 확인됨).
const FILE_LINK_RE = /<a[^>]*class="fd-editor-file"[^>]*>/g;

export function extractAttachedFiles(post: FandingPost): FandingAttachedFile[] {
  const html = post.sContent ?? "";
  const files: FandingAttachedFile[] = [];
  for (const tag of html.match(FILE_LINK_RE) ?? []) {
    const href = /href="([^"]*)"/.exec(tag)?.[1];
    if (!href) continue;
    const name = /data-fd-name="([^"]*)"/.exec(tag)?.[1];
    const size = /data-fd-size="([^"]*)"/.exec(tag)?.[1];
    files.push({
      url: href,
      name: decodeHtmlEntities(name) || href.split("/").pop() || "file",
      sizeBytes: size ? Number(size) : 0,
    });
  }
  return files;
}

function decodeHtmlEntities(s?: string): string {
  if (!s) return "";
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_");
}

const ALLOWED_MEDIA_HOSTS = ["fanding.kr", "cloudfront.net"];

// 파일/영상 URL은 크리에이터가 작성한 포스팅 콘텐츠에서 그대로 뽑아온 것이라 완전히
// 신뢰할 수 없다. 내부망 주소 등으로 요청을 보내는 SSRF를 막기 위해 fanding.kr 자체와
// CDN(cloudfront.net) 도메인만 다운로드를 허용한다.
export function isAllowedMediaUrl(urlString: string): boolean {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return ALLOWED_MEDIA_HOSTS.some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
  );
}

export async function downloadFile(
  file: FandingAttachedFile,
  destinationDir: string,
  cookies: object[]
): Promise<string> {
  if (!isAllowedMediaUrl(file.url)) {
    throw new Error(`허용되지 않은 다운로드 URL입니다: ${file.url}`);
  }
  fs.mkdirSync(destinationDir, { recursive: true });

  const { statusCode, body } = await request(file.url, {
    method: "GET",
    headers: { cookie: buildCookieHeader(cookies) },
  });
  if (statusCode !== 200) {
    throw new Error(`파일 다운로드 실패 (status ${statusCode}): ${file.url}`);
  }

  const destPath = path.join(destinationDir, sanitizeFileName(file.name));
  const buffer = Buffer.from(await body.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return destPath;
}
