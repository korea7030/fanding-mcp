import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { DATA_DIR } from "../paths.js";

export type LoginMethod =
  | "naver"
  | "kakao"
  | "google"
  | "facebook"
  | "apple"
  | "email";

export interface Session {
  account_label: string;
  login_method: LoginMethod;
  cookies: object[];
  storage_state: object;
  created_at: string;
  last_validated_at: string;
  status: "active" | "expired";
}

const SESSION_DIR = process.env.SESSION_DIR ?? path.join(DATA_DIR, "sessions");

function sessionPath(accountLabel: string) {
  return path.join(SESSION_DIR, `${accountLabel}.json`);
}

export function createAccountLabel(): string {
  return randomUUID();
}

export function saveSession(session: Session): void {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(sessionPath(session.account_label), JSON.stringify(session, null, 2), {
    mode: 0o600,
  });
}

export function loadSession(accountLabel: string): Session | null {
  const p = sessionPath(accountLabel);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as Session;
}

export function listSessions(): Session[] {
  if (!fs.existsSync(SESSION_DIR)) return [];
  return fs
    .readdirSync(SESSION_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(SESSION_DIR, f), "utf-8")) as Session);
}

export function deleteSession(accountLabel: string): boolean {
  const p = sessionPath(accountLabel);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

export function markExpired(accountLabel: string): void {
  const session = loadSession(accountLabel);
  if (!session) return;
  session.status = "expired";
  saveSession(session);
}

export function getActiveSession(accountLabel?: string): Session | null {
  if (accountLabel) return loadSession(accountLabel);
  const sessions = listSessions().filter((s) => s.status === "active");
  if (sessions.length === 0) return null;
  return sessions.sort(
    (a, b) =>
      new Date(b.last_validated_at).getTime() -
      new Date(a.last_validated_at).getTime()
  )[0];
}
