import * as fs from "fs";
import * as path from "path";
import { spawn, execFile } from "child_process";
import { DATA_DIR, SESSION_DIR, PACKAGE_ROOT } from "../paths.js";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  optional?: boolean;
}

function checkWritableDir(dir: string): { ok: boolean; detail: string } {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.doctor-probe-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return { ok: true, detail: dir };
  } catch (e) {
    return { ok: false, detail: `${dir} — ${(e as Error).message}` };
  }
}

function checkBinaryOnPath(bin: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { timeout: 10_000 }, (err, stdout) => {
      if (err) resolve({ ok: false, detail: `${bin}를 PATH에서 찾을 수 없습니다` });
      else resolve({ ok: true, detail: stdout.trim().split("\n")[0] });
    });
  });
}

// dist/index.js를 자식 프로세스로 띄워 실제 MCP initialize 왕복이 되는지 확인한다.
// hermes tools list 같은 호스트 측 목록에 안 보여도 이 handshake가 되면 서버 자체는 정상이다.
async function checkMcpHandshake(entry: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry], {
      stdio: ["pipe", "pipe", "ignore"],
      env: process.env,
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, detail: "10초 안에 initialize 응답이 없습니다" });
    }, 10_000);

    let buf = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const line = buf.split("\n")[0];
      if (!buf.includes("\n")) return;
      clearTimeout(timer);
      child.kill();
      try {
        const res = JSON.parse(line);
        const name = res?.result?.serverInfo?.name;
        if (name === "fanding-mcp") resolve({ ok: true, detail: `serverInfo.name=${name}` });
        else resolve({ ok: false, detail: `예상치 못한 응답: ${line.slice(0, 200)}` });
      } catch {
        resolve({ ok: false, detail: `JSON 파싱 실패: ${line.slice(0, 200)}` });
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, detail: e.message });
    });

    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "fanding-mcp-doctor", version: "1.0" },
        },
      }) + "\n"
    );
  });
}

export async function runDoctor(): Promise<number> {
  const results: CheckResult[] = [];

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  results.push({
    name: "Node.js",
    ok: nodeMajor >= 20,
    detail: `v${process.versions.node}${nodeMajor >= 20 ? "" : " (>= 20 필요)"}`,
  });

  const entry = path.join(PACKAGE_ROOT, "dist", "index.js");
  results.push({ name: "dist/index.js", ok: fs.existsSync(entry), detail: entry });

  const dataCheck = checkWritableDir(DATA_DIR);
  results.push({ name: "FANDING_DATA_DIR", ok: dataCheck.ok, detail: dataCheck.detail });

  const sessionCheck = checkWritableDir(SESSION_DIR);
  results.push({ name: "SESSION_DIR", ok: sessionCheck.ok, detail: sessionCheck.detail });

  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  results.push({
    name: "PLAYWRIGHT_BROWSERS_PATH",
    ok: !browsersPath || fs.existsSync(browsersPath),
    detail: browsersPath
      ? fs.existsSync(browsersPath)
        ? browsersPath
        : `${browsersPath} — 디렉토리가 없습니다 (npx playwright install chromium 필요)`
      : "(미설정 — playwright 기본 캐시 위치 사용)",
  });

  try {
    const { chromium } = await import("playwright");
    const execPath = chromium.executablePath();
    const exists = fs.existsSync(execPath);
    results.push({
      name: "Chromium",
      ok: exists,
      detail: exists
        ? execPath
        : `${execPath} — 없음. PLAYWRIGHT_BROWSERS_PATH=<경로> npx playwright install chromium 을 실행하세요`,
    });
  } catch (e) {
    results.push({ name: "Chromium", ok: false, detail: (e as Error).message });
  }

  const apiKey = process.env.TRANSCRIPTION_API_KEY || process.env.OPENAI_API_KEY;
  results.push({
    name: "OPENAI_API_KEY",
    ok: !!apiKey,
    detail: apiKey ? "설정됨" : "미설정 — 영상 전사(summarize_video)만 실패하고 나머지는 동작합니다",
    optional: true,
  });

  for (const bin of ["yt-dlp", "ffmpeg"] as const) {
    const r = await checkBinaryOnPath(bin);
    results.push({
      name: bin,
      ok: r.ok,
      detail: r.ok ? r.detail : `${r.detail} — 영상 전사에만 필요합니다`,
      optional: true,
    });
  }

  try {
    const { getDb } = await import("../search/db.js");
    getDb().prepare("SELECT count(*) AS n FROM posts").get();
    results.push({ name: "SQLite DB", ok: true, detail: path.join(DATA_DIR, "fanding.db") });
  } catch (e) {
    results.push({ name: "SQLite DB", ok: false, detail: (e as Error).message });
  }

  if (fs.existsSync(entry)) {
    const hs = await checkMcpHandshake(entry);
    results.push({ name: "MCP stdio handshake", ok: hs.ok, detail: hs.detail });
  } else {
    results.push({ name: "MCP stdio handshake", ok: false, detail: "dist/index.js가 없어 건너뜀" });
  }

  console.log("fanding-mcp doctor\n");
  for (const r of results) {
    const mark = r.ok ? "OK  " : r.optional ? "WARN" : "FAIL";
    console.log(`${mark}  ${r.name}: ${r.detail}`);
  }

  const failed = results.filter((r) => !r.ok && !r.optional);
  console.log(
    failed.length === 0
      ? "\n모든 필수 항목 통과."
      : `\n필수 항목 ${failed.length}개 실패: ${failed.map((r) => r.name).join(", ")}`
  );
  return failed.length === 0 ? 0 : 1;
}
