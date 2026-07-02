import { chromium, type BrowserContext, type Page } from "playwright";
import * as path from "path";
import { createAccountLabel, saveSession, type LoginMethod } from "./session.js";
import { DATA_DIR } from "../paths.js";

const FANDING_URL = "https://fanding.kr";
const PROFILE_DIR = path.join(DATA_DIR, "browser-profiles");

// Provider별 로그인 버튼 셀렉터 (fanding.kr 로그인 모달 실측 완료)
const PROVIDERS: Record<Exclude<LoginMethod, "email">, { buttonSelector: string }> = {
  naver: { buttonSelector: '.social-item[data-type="naver"]' },
  kakao: { buttonSelector: '.social-item[data-type="kakao"]' },
  google: { buttonSelector: '.social-item[data-type="google"]' },
  facebook: { buttonSelector: '.social-item[data-type="facebook"]' },
  apple: { buttonSelector: '.social-item[data-type="apple"]' },
};

// OAuth: naver/kakao/google/facebook은 같은 탭에서 provider로 리다이렉트되지만,
// apple은 팝업 창(response_mode=web_message)으로 뜬다. 두 방식을 다 처리해야 한다.
// (초기 URL이 이미 fanding.kr이므로 "돌아옴"만 확인하면 실제 인증 없이도 즉시 통과해버리는
// 문제가 있어, 리다이렉트 방식은 먼저 provider로 "떠나는 것"부터 확인한다)
async function waitForProviderRoundTrip(
  page: Page,
  context: BrowserContext,
  timeoutMs = 120_000
): Promise<void> {
  const popup = await Promise.race([
    context.waitForEvent("page", { timeout: timeoutMs }).catch(() => null),
    page
      .waitForURL((url) => !url.hostname.endsWith("fanding.kr"), { timeout: timeoutMs })
      .then(() => null)
      .catch(() => null),
  ]);

  if (popup) {
    // apple 등 팝업 기반 provider: 팝업이 닫힐 때까지 대기
    await popup.waitForEvent("close", { timeout: timeoutMs }).catch(() => {});
  } else {
    // naver/kakao/google/facebook 등 리다이렉트 기반 provider: fanding.kr로 복귀 대기
    await page.waitForURL((url) => url.hostname.endsWith("fanding.kr"), { timeout: timeoutMs });
  }
  await page.waitForLoadState("domcontentloaded").catch(() => {});
}

// 이메일 로그인: 인증 성공 시 모달이 닫힌다 (실패 시 모달 내 에러 메시지와 함께 유지됨)
async function waitForEmailLoginDialogClose(page: Page, timeoutMs = 120_000): Promise<void> {
  await page.waitForSelector('[role="dialog"]', { state: "hidden", timeout: timeoutMs });
}

// provider 왕복(팝업 종료/리다이렉트 복귀)이나 모달 닫힘은 실제 로그인 완료의 "신호"일 뿐,
// fanding.kr이 인증 코드를 세션으로 교환하는 처리는 비동기로 조금 더 걸릴 수 있다.
// 사이드바의 "로그인" 버튼이 실제로 사라질 때까지 기다려서 진짜 로그인 완료를 확인한다.
// (앱이 상태 반영에 새로고침이 필요한 경우를 대비해 한 번 재시도한다)
async function waitForLoggedInState(page: Page, timeoutMs = 120_000): Promise<void> {
  try {
    await page.waitForSelector(".side-nav__login", { state: "detached", timeout: 15_000 });
  } catch {
    await page.reload();
    await page.waitForSelector(".side-nav__login", { state: "detached", timeout: timeoutMs });
  }
}

// OAuth 로그인 (사용자가 직접 인증 완료).
// interactive: false면 자동 재로그인 등 무인 컨텍스트에서 호출된 것으로 보고, persistent
// 프로필이 이미 로그인된 상태가 아니면 (사람이 직접 인증해야 하는 상황) 브라우저 창을 띄워
// 무한정 기다리지 않고 즉시 실패한다.
export async function loginWithOAuth(
  method: Exclude<LoginMethod, "email">,
  opts: { interactive?: boolean } = {}
): Promise<string> {
  const { interactive = true } = opts;
  const profileDir = path.join(PROFILE_DIR, method);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !interactive,
    viewport: { width: 1280, height: 800 },
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(FANDING_URL);

  // persistent 프로필이 이전 로그인으로 이미 인증된 상태일 수 있다 (사이드바에 로그인 버튼이 없음)
  const loginButton = await page.$(".side-nav__login");
  if (loginButton) {
    if (!interactive) {
      await context.close();
      throw new Error("REAUTH_REQUIRED");
    }

    await loginButton.click();

    const provider = PROVIDERS[method];
    await page.click(provider.buttonSelector);

    console.error(`[fanding-mcp] ${method} 로그인 창이 열렸습니다. 직접 인증을 완료해 주세요.`);
    await waitForProviderRoundTrip(page, context);
    await waitForLoggedInState(page);
  } else {
    console.error(`[fanding-mcp] 이미 로그인된 프로필입니다. 현재 세션을 저장합니다.`);
  }

  const storageState = await context.storageState();
  await context.close();

  const accountLabel = createAccountLabel();
  saveSession({
    account_label: accountLabel,
    login_method: method,
    cookies: storageState.cookies,
    storage_state: storageState,
    created_at: new Date().toISOString(),
    last_validated_at: new Date().toISOString(),
    status: "active",
  });

  return accountLabel;
}

// 이메일 로그인 (자동화)
export async function loginWithEmail(email: string, password: string): Promise<string> {
  const context = await chromium.launch({ headless: true }).then((b) =>
    b.newContext()
  );

  const page = await context.newPage();
  await page.goto(FANDING_URL);
  await page.click(".side-nav__login");

  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('[role="dialog"] button:has-text("로그인")');

  await waitForEmailLoginDialogClose(page);
  await waitForLoggedInState(page);

  const storageState = await context.storageState();
  await context.close();

  const accountLabel = createAccountLabel();
  saveSession({
    account_label: accountLabel,
    login_method: "email",
    cookies: storageState.cookies,
    storage_state: storageState,
    created_at: new Date().toISOString(),
    last_validated_at: new Date().toISOString(),
    status: "active",
  });

  return accountLabel;
}
