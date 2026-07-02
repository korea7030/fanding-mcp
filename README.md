# fanding-mcp

fanding.kr 포스팅/영상 요약, 검색, 실시간 트래킹을 위한 MCP 서버.

## 설치

npm install만으로 끝나지 않고 시스템에 별도로 설치해야 하는 것들이 있습니다.

**시스템 의존성**
- Node.js 20+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — 영상 다운로드 (`brew install yt-dlp` 등)
- [ffmpeg](https://ffmpeg.org/) — 오디오 추출 (`brew install ffmpeg` 등)
- Playwright 브라우저 — OAuth 로그인 시 필요 (아래 설치 과정에 포함됨)

**설치 과정**
```bash
git clone <이 저장소 URL> fanding-mcp
cd fanding-mcp
npm install
npx playwright install chromium
npm run build
```

**MCP 클라이언트에 등록**: `mcp-config.json`은 이 저장소에 커밋되어 있는 **템플릿**입니다.
여기에 직접 실제 이메일/비밀번호/API 키를 채우지 마세요 — 저장소에 그대로 커밋/push될 수 있습니다.
아래 내용을 **Claude Desktop/Claude Code 등 저장소 밖에 있는 실제 설정 파일**에 복사해서
`args`의 경로만 방금 clone한 절대경로로 바꿔 넣으세요.
```json
{
  "mcpServers": {
    "fanding": {
      "command": "node",
      "args": ["/절대/경로/fanding-mcp/dist/index.js"],
      "env": {
        "FANDING_EMAIL": "",
        "FANDING_PASSWORD": "",
        "OPENAI_API_KEY": ""
      }
    }
  }
}
```

세션/DB/브라우저 프로필은 기본적으로 `fanding-mcp` 설치 위치 아래 `data/`에 저장됩니다
(어떤 작업 디렉토리에서 실행하든 항상 같은 곳). 다른 위치를 쓰고 싶으면 `.env.example`을
참고해서 `FANDING_DATA_DIR`(또는 세션만 따로 `SESSION_DIR`)를 설정하세요.

## 인증 방식

fanding.kr은 서드파티 앱용 OAuth/API를 제공하지 않기 때문에, 이 서버는 실제 브라우저(Playwright)로
로그인해서 세션 쿠키를 저장하고 재사용하는 방식을 씁니다. 두 가지 로그인 방식이 있고 용도가 다릅니다.

### email 로그인 (권장, 에이전트/헤드리스 환경용)

```
refresh_session({ login_method: "email" })
```

`FANDING_EMAIL`, `FANDING_PASSWORD` 환경변수만 있으면 완전 자동/헤드리스로 로그인합니다.
디스플레이가 없는 서버, CI, 클라우드 에이전트 환경에서 동작하는 유일한 방식이라 **다른 사람이
이 MCP를 자기 에이전트로 붙여 쓰는 경우 기본으로 삼아야 합니다.**

한계: CAPTCHA나 2단계 인증이 걸리면 실패합니다. 비밀번호를 환경변수에 평문으로 두는 것이므로
`.env`를 커밋하거나 로그에 남기지 않도록 주의하세요.

### OAuth 로그인 (naver/kakao/google/facebook/apple, 로컬 1회 설정용)

```
refresh_session({ login_method: "naver" })
```

`headless: false`로 실제 브라우저 창을 띄우고, 사용자가 직접 소셜 로그인을 완료해야 합니다.
**로컬 데스크톱(디스플레이가 있는 환경)에서만 동작**하며, 서버/클라우드 에이전트 환경에서는
브라우저 창을 띄울 수 없어 그대로 실패합니다. 최초 세션 발급을 사람이 직접 할 때만 쓰는 보조
수단으로 취급하세요.

provider마다 인증 완료를 감지하는 방식이 다릅니다 (실측 확인됨):
- naver/kakao/google/facebook: 같은 탭에서 provider로 리다이렉트 → 인증 후 fanding.kr로 복귀
- apple: 팝업 창(`response_mode=web_message`)으로 인증 → 팝업이 닫히면 완료로 판단

`waitForProviderRoundTrip`이 두 방식을 자동으로 구분해서 처리합니다.

### 세션 재사용과 자동 재로그인

두 방식 모두 로그인에 성공하면 `data/sessions`(패키지 설치 위치 기준, `SESSION_DIR`로 오버라이드
가능)에 쿠키/storage state를 저장합니다. 이후 `summarize_post`, `search_posts` 등 다른 도구들은
저장된 세션을 그대로 재사용하므로, 매 호출마다 다시 로그인할 필요는 없습니다.

API가 세션 만료(401/403)를 감지하면 **같은 로그인 방식으로 자동 재로그인 후 요청을 한 번
재시도**합니다.
- email: `FANDING_EMAIL`/`FANDING_PASSWORD`만 있으면 완전 무인으로 재로그인됩니다.
- OAuth: persistent 브라우저 프로필(`data/browser-profiles/<method>`)이 아직 로그인된
  상태면 무인으로 재로그인됩니다. 프로필까지 로그아웃된 상태면 사람이 직접 인증해야 하므로,
  브라우저 창을 띄운 채 기다리지 않고 즉시 실패하며 `refresh_session`을 다시 실행하라는
  에러를 반환합니다.

### 여러 크리에이터 동시 트래킹

`start_tracking`은 크리에이터별로 독립된 60초 폴링 타이머를 가지므로 여러 크리에이터를
동시에 트래킹할 수 있습니다. `stop_tracking`에 `member_url`을 주면 그 크리에이터만, 생략하면
전체를 중지합니다. `tracking_status`는 현재 트래킹 중인 크리에이터 목록을 보여줍니다.

## 개발

```
npm run build   # tsc
npm run dev     # tsx src/index.ts
npm start        # node dist/index.js
```
