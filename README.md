# fanding-mcp

fanding.kr 포스팅/영상 요약, 검색, 실시간 트래킹을 위한 MCP 서버.

> **비공식 도구입니다.** fanding.kr은 서드파티 앱용 공식 API/OAuth를 제공하지 않아서,
> 이 프로젝트는 실제 브라우저 자동화로 로그인해서 웹에서 보이는 데이터를 가져오는 방식으로
> 동작합니다. fanding.kr의 이용약관/robots 정책을 위반할 수 있고, 과도하게 사용하면 봇
> 탐지에 걸려 계정이 제재될 수 있습니다. 개인 사용 목적으로만 쓰고, 사용에 따른 책임은
> 전적으로 사용자 본인에게 있습니다. fanding.kr 또는 이 프로젝트의 개발자와는 무관합니다.

## 설치

### 시스템 의존성

- Node.js 20+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp), [ffmpeg](https://ffmpeg.org/) — 영상 전사에만 필요 (`brew install yt-dlp ffmpeg` 등)
- Playwright Chromium — 로그인에 필요 (아래 설치 명령 참고)

### npx / npm 설치 (권장)

빌드 없이 npm registry에서 바로 실행합니다.

```bash
# 바로 실행 (MCP stdio 서버로 동작)
npx -y @korea7030/fanding-mcp

# 또는 전역 설치
npm install -g @korea7030/fanding-mcp
fanding-mcp doctor
```

Playwright 브라우저는 별도로 한 번 설치해야 합니다. **설치할 때와 실행할 때
`PLAYWRIGHT_BROWSERS_PATH`가 같아야 합니다.**

```bash
PLAYWRIGHT_BROWSERS_PATH=/원하는/절대/경로/.playwright npx playwright install chromium
```

### git clone 설치 (개발용)

```bash
git clone <이 저장소 URL> fanding-mcp
cd fanding-mcp
npm install
npx playwright install chromium
npm run build
```

## 경로 설정 (환경변수)

모든 데이터 경로는 **명시 env → 안전한 기본값** 순서로 결정되며, `process.cwd()`에는
의존하지 않습니다. Docker/Hermes 환경에서는 항상 **절대 경로를 env로 명시**하세요.

| 환경변수 | 용도 | 기본값 |
|---|---|---|
| `FANDING_DATA_DIR` | DB/세션/브라우저 프로필 루트 | `<패키지 루트>/data`가 있으면 그 위치, 없으면 `~/.fanding-mcp/data` |
| `SESSION_DIR` | 세션 파일 위치 | `$FANDING_DATA_DIR/sessions` |
| `PLAYWRIGHT_BROWSERS_PATH` | Playwright 브라우저 위치 | Playwright 기본 캐시 |
| `OPENAI_API_KEY` | 영상 전사 (Whisper) | — |
| `FANDING_EMAIL` / `FANDING_PASSWORD` | 이메일 로그인 | — |

디렉토리는 서버 시작 시 자동 생성됩니다. 전체 목록은 `.env.example` 참고.

## MCP 클라이언트 등록

### Hermes (config.yaml)

`fanding-mcp config` 명령이 붙여넣을 snippet을 만들어 줍니다:

```bash
npx -y @korea7030/fanding-mcp config --profile invest-bot
```

npx 기반 (권장):

```yaml
mcp_servers:
  fanding:
    command: npx
    args:
      - -y
      - "@korea7030/fanding-mcp"
    timeout: 30
    connect_timeout: 10
    env:
      FANDING_DATA_DIR: /opt/data/profiles/invest-bot/workspace/fanding-mcp-data
      PLAYWRIGHT_BROWSERS_PATH: /opt/data/profiles/invest-bot/workspace/fanding-playwright
      OPENAI_API_KEY: ${OPENAI_API_KEY}
```

git clone으로 직접 빌드한 경우:

```yaml
mcp_servers:
  fanding:
    command: node
    args:
      - /opt/data/profiles/invest-bot/workspace/fanding-mcp/dist/index.js
    timeout: 30
    connect_timeout: 10
    env:
      FANDING_DATA_DIR: /opt/data/profiles/invest-bot/workspace/fanding-mcp/data
      PLAYWRIGHT_BROWSERS_PATH: /opt/data/profiles/invest-bot/workspace/fanding-mcp/.playwright
      OPENAI_API_KEY: ${OPENAI_API_KEY}
```

> **경로는 반드시 컨테이너 내부 경로여야 합니다.** Hermes는 Docker 컨테이너 안에서 MCP
> 서버를 실행하므로, config에 호스트 경로(`/Users/...`)를 넣으면 동작하지 않습니다.
> 호스트의 `~/.hermes-*/profiles/<프로필>/workspace/...`는 컨테이너의
> `/opt/data/profiles/<프로필>/workspace/...`에 대응합니다.

Playwright 브라우저도 컨테이너 안에서, config와 같은 경로로 설치하세요:

```bash
PLAYWRIGHT_BROWSERS_PATH=/opt/data/profiles/invest-bot/workspace/fanding-playwright \
  npx playwright install chromium
```

### Claude Desktop / Claude Code (JSON)

`mcp-config.json` 템플릿 참고 (실제 자격증명은 저장소 밖 설정 파일에만 넣으세요):

```json
{
  "mcpServers": {
    "fanding": {
      "command": "npx",
      "args": ["-y", "@korea7030/fanding-mcp"],
      "env": {
        "FANDING_EMAIL": "",
        "FANDING_PASSWORD": "",
        "OPENAI_API_KEY": ""
      }
    }
  }
}
```

## 설치 검증

### 0차: doctor

```bash
fanding-mcp doctor        # 또는 npx -y @korea7030/fanding-mcp doctor
```

Node 버전, 경로 쓰기 권한, Chromium, API 키, SQLite, MCP handshake까지 한 번에 점검합니다.
Hermes에서 쓸 때는 **컨테이너 안에서, config와 같은 env를 주고** 실행해야 실제 실행 환경이
검증됩니다.

### 1차: MCP stdio handshake 직접 확인

```bash
python3 - <<'PY'
import subprocess, json

p = subprocess.Popen(
    ["npx", "-y", "@korea7030/fanding-mcp"],  # git clone이면 ["node", "dist/index.js"]
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
)
msg = {
    "jsonrpc": "2.0", "id": 1, "method": "initialize",
    "params": {"protocolVersion": "2024-11-05", "capabilities": {},
               "clientInfo": {"name": "test", "version": "1.0"}},
}
p.stdin.write(json.dumps(msg) + "\n")
p.stdin.flush()
print("Response:", p.stdout.readline())
p.terminate()
PY
```

성공 기준: 응답에 `"serverInfo": {"name": "fanding-mcp", ...}`가 포함되어야 합니다.

### 2차: Hermes에서 실제 도구 호출

에이전트에게 `mcp_fanding_list_sessions` 또는 `mcp_fanding_tracking_status` 호출을 시키세요.
세션이 있으면 아래처럼 응답합니다:

```json
[
  {
    "account_label": "...",
    "login_method": "email",
    "status": "active"
  }
]
```

> **`hermes tools list`에 의존하지 마세요.** `hermes tools list | grep fanding`에 도구가
> 표시되지 않아도 MCP 서버가 실제로 로드되어 있을 수 있습니다 (실측 확인됨). 최종 검증은
> 반드시 실제 MCP tool call로 하세요.

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

두 방식 모두 로그인에 성공하면 `SESSION_DIR`(기본 `$FANDING_DATA_DIR/sessions`)에 쿠키/storage
state를 저장합니다. 이후 `summarize_post`, `search_posts` 등 다른 도구들은 저장된 세션을 그대로
재사용하므로, 매 호출마다 다시 로그인할 필요는 없습니다.

API가 세션 만료(401/403)를 감지하면 **같은 로그인 방식으로 자동 재로그인 후 요청을 한 번
재시도**합니다.
- email: `FANDING_EMAIL`/`FANDING_PASSWORD`만 있으면 완전 무인으로 재로그인됩니다.
- OAuth: persistent 브라우저 프로필(`$FANDING_DATA_DIR/browser-profiles/<method>`)이 아직 로그인된
  상태면 무인으로 재로그인됩니다. 프로필까지 로그아웃된 상태면 사람이 직접 인증해야 하므로,
  브라우저 창을 띄운 채 기다리지 않고 즉시 실패하며 `refresh_session`을 다시 실행하라는
  에러를 반환합니다.

### 여러 크리에이터 동시 트래킹

`start_tracking`은 크리에이터별로 독립된 60초 폴링 타이머를 가지므로 여러 크리에이터를
동시에 트래킹할 수 있습니다. `stop_tracking`에 `member_url`을 주면 그 크리에이터만, 생략하면
전체를 중지합니다. `tracking_status`는 현재 트래킹 중인 크리에이터 목록을 보여줍니다.

## Troubleshooting

- **`hermes tools list`에 fanding이 안 보임** — 표시 여부와 실제 로드 여부는 다릅니다.
  `mcp_fanding_list_sessions`를 실제로 호출해서 판단하세요.
- **Chromium을 못 찾음** — 설치 시점과 실행 시점의 `PLAYWRIGHT_BROWSERS_PATH`가 다른 경우가
  대부분입니다. config의 env와 같은 값으로 `npx playwright install chromium`을 다시 실행하세요.
- **데이터가 엉뚱한 곳에 생김** — env 없이 npx로 실행하면 기본값 `~/.fanding-mcp/data`를
  씁니다. 기존 git clone 설치의 `data/`를 계속 쓰려면 `FANDING_DATA_DIR`로 그 경로를 명시하세요.
- 나머지는 `fanding-mcp doctor`가 대부분 짚어줍니다.

## CLI 명령

```
fanding-mcp              # MCP stdio 서버 실행 (기본)
fanding-mcp doctor       # 설치 상태 점검
fanding-mcp config       # MCP config snippet 출력
  --profile <name>       # Hermes 컨테이너 경로(/opt/data/profiles/<name>/...) 기준으로 출력
```

## 개발

```
npm run build   # tsc
npm run dev     # tsx src/index.ts
npm start       # node dist/index.js
npm test        # node:test (tsx로 실행, 순수 로직 + DB 계층 회귀 테스트)
```

배포 (`prepublishOnly`가 build+test를 자동 실행):

```bash
npm pack --dry-run   # dist/index.js가 포함되는지 확인
npm publish
```
