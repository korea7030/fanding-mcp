import { DATA_DIR, PACKAGE_ROOT } from "../paths.js";
import * as path from "path";

const PKG = "@korea7030/fanding-mcp";

// Hermes config.yaml에 그대로 붙여넣을 수 있는 snippet을 출력한다.
// --profile을 주면 Hermes Docker 컨테이너 내부 경로(/opt/data/profiles/<name>/...)를 쓴다.
// config에 들어가는 경로는 항상 "컨테이너 기준" 절대 경로여야 한다 — 호스트 경로(/Users/...)를
// 넣으면 컨테이너 안에서 해석되지 않는다.
export function printConfig(argv: string[]): void {
  const profileIdx = argv.indexOf("--profile");
  const profile = profileIdx >= 0 ? argv[profileIdx + 1] : null;
  if (profileIdx >= 0 && !profile) {
    console.error("--profile 뒤에 프로필 이름이 필요합니다 (예: --profile invest-bot)");
    process.exitCode = 1;
    return;
  }

  const workspace = profile ? `/opt/data/profiles/${profile}/workspace` : null;
  const dataDir = workspace ? `${workspace}/fanding-mcp-data` : DATA_DIR;
  const browsersDir = workspace
    ? `${workspace}/fanding-playwright`
    : process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(DATA_DIR, ".playwright");

  const npxYaml = `mcp_servers:
  fanding:
    command: npx
    args:
      - -y
      - "${PKG}"
    timeout: 30
    connect_timeout: 10
    env:
      FANDING_DATA_DIR: ${dataDir}
      PLAYWRIGHT_BROWSERS_PATH: ${browsersDir}
      OPENAI_API_KEY: \${OPENAI_API_KEY}`;

  const localEntry = workspace
    ? `${workspace}/fanding-mcp/dist/index.js`
    : path.join(PACKAGE_ROOT, "dist", "index.js");
  const localYaml = `mcp_servers:
  fanding:
    command: node
    args:
      - ${localEntry}
    timeout: 30
    connect_timeout: 10
    env:
      FANDING_DATA_DIR: ${dataDir}
      PLAYWRIGHT_BROWSERS_PATH: ${browsersDir}
      OPENAI_API_KEY: \${OPENAI_API_KEY}`;

  console.log("# npx 기반 (권장 — npm registry에서 자동 설치/실행)");
  console.log(npxYaml);
  console.log();
  console.log("# git clone 기반 (dist를 직접 빌드한 경우)");
  console.log(localYaml);
  console.log();
  console.log("# 참고:");
  console.log("# - 이메일 로그인을 쓰려면 env에 FANDING_EMAIL, FANDING_PASSWORD도 추가하세요.");
  console.log("# - Playwright 브라우저는 미리 설치해야 합니다:");
  console.log(`#     PLAYWRIGHT_BROWSERS_PATH=${browsersDir} npx playwright install chromium`);
  if (profile) {
    console.log("# - 위 경로는 Hermes Docker 컨테이너 내부 경로입니다. 호스트에서는");
    console.log(`#     ~/.hermes-*/profiles/${profile}/workspace/... 에 대응합니다.`);
  }
}
