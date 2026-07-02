import { fileURLToPath } from "url";
import * as path from "path";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 이 파일은 dist/paths.js로 컴파일되므로, 이 파일의 위치(패키지 설치 위치) 기준으로
// data 디렉토리를 고정한다. process.cwd()에 의존하면 MCP 호스트가 이 서버를 어떤
// 작업 디렉토리에서 띄우는지에 따라 세션/DB/브라우저 프로필이 엉뚱한 곳에 생길 수 있다.
const PACKAGE_ROOT = path.resolve(HERE, "..");

export const DATA_DIR = process.env.FANDING_DATA_DIR ?? path.join(PACKAGE_ROOT, "data");
