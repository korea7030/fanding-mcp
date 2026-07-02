import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { isAllowedMediaUrl } from "../scraper/api.js";

const execFileAsync = promisify(execFile);
const TEMP_DIR = path.join(os.tmpdir(), "fanding-mcp-videos");

export async function downloadVideo(
  videoUrl: string,
  cookiesJson: object[]
): Promise<string> {
  if (!isAllowedMediaUrl(videoUrl)) {
    throw new Error(`허용되지 않은 영상 URL입니다: ${videoUrl}`);
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const cookiesFile = path.join(TEMP_DIR, `cookies-${Date.now()}.txt`);
  fs.writeFileSync(cookiesFile, formatNetscapeCookies(cookiesJson), { mode: 0o600 });

  const basename = `video-${Date.now()}`;
  const outputPath = path.join(TEMP_DIR, `${basename}.mp3`);

  try {
    // fanding.kr의 HLS 스트림은 오디오 단독 트랙이 없고 영상+오디오가 묶여있는 경우가
    // 많다 (실측 확인됨). bestaudio/best로 받으면 화질 좋은 영상까지 통째로 받아서
    // Whisper의 25MB 제한을 쉽게 넘긴다. worstaudio/worst로 가장 작은 스트림을 받고
    // ffmpeg으로 오디오만 추출한다 (전사 품질에는 화질이 필요 없다).
    await execFileAsync("yt-dlp", [
      "--cookies", cookiesFile,
      "--format", "worstaudio/worst",
      "--extract-audio",
      "--audio-format", "mp3",
      "--output", path.join(TEMP_DIR, `${basename}.%(ext)s`),
      "--no-playlist",
      videoUrl,
    ]);
    return outputPath;
  } finally {
    fs.unlinkSync(cookiesFile);
  }
}

export async function transcribeAudio(audioPath: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for transcription");

  const formData = new FormData();
  formData.append("file", new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));
  formData.append("model", "whisper-1");
  formData.append("language", "ko");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Whisper API error: ${response.status} ${await response.text()}`);
  }

  const result = (await response.json()) as { text: string };
  return result.text;
}

export async function transcribeVideo(
  videoUrl: string,
  cookies: object[]
): Promise<string> {
  let audioPath: string | null = null;
  try {
    audioPath = await downloadVideo(videoUrl, cookies);
    const transcript = await transcribeAudio(audioPath);
    return transcript;
  } finally {
    if (audioPath && fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
  }
}

function formatNetscapeCookies(cookies: object[]): string {
  const lines = ["# Netscape HTTP Cookie File"];
  for (const c of cookies as any[]) {
    const domain = c.domain ?? "";
    // 2번째 필드는 "domain_specified"(서브도메인 포함 여부)이며 domain이 .으로 시작하는지
    // 여부여야 한다. httpOnly와는 무관하다 (실측 확인됨 - httpOnly를 넣으면 domain이
    // .으로 시작하는데 이 필드가 FALSE인 경우가 생겨서 Python cookiejar가
    // "domain_specified == initial_dot" 어설션 에러로 거부한다).
    const domainSpecified = domain.startsWith(".") ? "TRUE" : "FALSE";
    const secure = c.secure ? "TRUE" : "FALSE";
    const expiry = c.expires && c.expires > 0 ? Math.floor(c.expires) : 0;
    lines.push(
      [domain, domainSpecified, c.path ?? "/", secure, expiry, c.name, c.value].join("\t")
    );
  }
  return lines.join("\n");
}
