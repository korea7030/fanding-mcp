import { getActiveSession } from "../auth/session.js";
import { fetchChannelSection } from "../scraper/api.js";
import { upsertPost, getTrackerState, setTrackerState } from "../search/db.js";
import { mapListItemToDb } from "../scraper/mapper.js";

const POLL_INTERVAL_MS = 60_000;

interface Tracker {
  timer: ReturnType<typeof setTimeout>;
  accountLabel?: string;
}

// memberUrl별로 독립된 타이머를 가져서 여러 크리에이터를 동시에 트래킹할 수 있다.
const trackers = new Map<string, Tracker>();
const newPostCallbacks: Array<(memberUrl: string, postNo: number) => void> = [];

export function onNewPost(cb: (memberUrl: string, postNo: number) => void): void {
  newPostCallbacks.push(cb);
}

export function startTracking(memberUrl: string, accountLabel?: string): boolean {
  if (trackers.has(memberUrl)) return false;
  trackers.set(memberUrl, { timer: schedule(memberUrl), accountLabel });
  return true;
}

export function stopTracking(memberUrl?: string): string[] {
  const targets = memberUrl ? [memberUrl] : [...trackers.keys()];
  const stopped: string[] = [];
  for (const url of targets) {
    const tracker = trackers.get(url);
    if (!tracker) continue;
    clearTimeout(tracker.timer);
    trackers.delete(url);
    stopped.push(url);
  }
  return stopped;
}

export function isTracking(memberUrl?: string): boolean {
  return memberUrl ? trackers.has(memberUrl) : trackers.size > 0;
}

export function listTracking(): string[] {
  return [...trackers.keys()];
}

function schedule(memberUrl: string): ReturnType<typeof setTimeout> {
  return setTimeout(async () => {
    const tracker = trackers.get(memberUrl);
    if (!tracker) return;
    try {
      await poll(memberUrl, tracker.accountLabel);
    } catch (err) {
      console.error(`[fanding-mcp] ${memberUrl} poll error:`, err);
    }
    const current = trackers.get(memberUrl);
    if (current) {
      trackers.set(memberUrl, { ...current, timer: schedule(memberUrl) });
    }
  }, POLL_INTERVAL_MS);
}

async function poll(memberUrl: string, accountLabel?: string): Promise<void> {
  const session = getActiveSession(accountLabel);
  if (!session) {
    console.error(`[fanding-mcp] ${memberUrl}: 활성 세션 없음. 트래킹을 중지합니다.`);
    stopTracking(memberUrl);
    return;
  }

  const sections = await fetchChannelSection(memberUrl, session);
  const newSection = sections.find((s) => s.sType === "post_new");
  const latestPosts = newSection?.aSectionItem?.aPostList ?? [];
  if (latestPosts.length === 0) return;

  const stateKey = `last_seen_post_no_${memberUrl}`;
  const lastSeenPostNo = getTrackerState(stateKey);
  const latestPostNo = String(latestPosts[0].iPostNo);

  if (!lastSeenPostNo) {
    setTrackerState(stateKey, latestPostNo);
    return;
  }

  const newPosts = latestPosts.filter((p) => p.iPostNo > Number(lastSeenPostNo));
  for (const item of newPosts) {
    upsertPost(mapListItemToDb(item));
    newPostCallbacks.forEach((cb) => cb(memberUrl, item.iPostNo));
  }

  if (newPosts.length > 0) {
    setTrackerState(stateKey, latestPostNo);
  }
}
