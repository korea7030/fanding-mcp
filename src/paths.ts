import { fileURLToPath } from "url";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 이 파일은 dist/paths.js로 컴파일되므로, 패키지 루트는 이 파일 위치 기준으로 고정한다.
// process.cwd()는 MCP 호스트가 서버를 어떤 작업 디렉토리에서 띄우는지에 따라 달라지므로
// 절대 신뢰하지 않는다. 모든 경로는 (1) 명시 env → (2) 안전한 기본값 순으로 결정된다.
export const PACKAGE_ROOT = path.resolve(HERE, "..");

// 기본 data 위치:
// - 기존 git clone 설치에서 쓰던 <패키지 루트>/data가 이미 있으면 그대로 사용 (마이그레이션 호환)
// - 없으면 ~/.fanding-mcp/data. npx로 실행하면 패키지 루트가 npm 캐시(~/.npm/_npx/...) 안이라
//   언제든 지워질 수 있으므로, 캐시 밖의 홈 디렉토리를 기본값으로 쓴다.
function defaultDataDir(): string {
  const local = path.join(PACKAGE_ROOT, "data");
  if (fs.existsSync(local)) return local;
  return path.join(os.homedir(), ".fanding-mcp", "data");
}

export const DATA_DIR = process.env.FANDING_DATA_DIR ?? defaultDataDir();
export const SESSION_DIR = process.env.SESSION_DIR ?? path.join(DATA_DIR, "sessions");

export function ensureDataDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}
