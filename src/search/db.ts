import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import { DATA_DIR } from "../paths.js";

const DB_PATH = path.join(DATA_DIR, "fanding.db");

export interface Post {
  id: string;           // iPostNo as string
  post_no: number;
  title: string;
  content: string;      // HTML stripped to plain text
  content_html: string;
  author: string;
  creator_no: number;
  creator_url: string;
  published_at: string;
  url: string;
  like_count: number;
  view_count: number;
  reply_count: number;
  duration: number;     // seconds
  has_video: number;
  collection_title: string | null;
  summary: string | null;
  indexed_at: string;
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      post_no INTEGER UNIQUE NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      content_html TEXT NOT NULL,
      author TEXT NOT NULL,
      creator_no INTEGER NOT NULL,
      creator_url TEXT NOT NULL,
      published_at TEXT NOT NULL,
      url TEXT NOT NULL,
      like_count INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      reply_count INTEGER DEFAULT 0,
      duration INTEGER DEFAULT 0,
      has_video INTEGER DEFAULT 0,
      collection_title TEXT,
      summary TEXT,
      indexed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_creator_no ON posts(creator_no);
    CREATE INDEX IF NOT EXISTS idx_posts_like_count ON posts(like_count DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
      id UNINDEXED,
      title,
      content,
      author,
      collection_title,
      summary,
      content='posts',
      content_rowid='rowid'
    );

    CREATE TABLE IF NOT EXISTS videos (
      post_id TEXT PRIMARY KEY,
      video_url TEXT,
      transcript TEXT,
      summary TEXT,
      transcribed_at TEXT,
      FOREIGN KEY(post_id) REFERENCES posts(id)
    );

    CREATE TABLE IF NOT EXISTS tracker_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // posts_fts(FTS5 external-content 테이블)를 트리거로 동기화하면 SQLITE_CORRUPT_VTAB가
  // 비결정적으로 발생한다 (실측 확인됨 - id 기준/rowid 기준 필터 둘 다에서 재현됨). 트리거가
  // 트랜잭션 안에서 가상 테이블을 건드리는 조합 자체가 불안정한 것으로 보여, 트리거는 전부
  // 없애고 upsertPost/upsertVideoTranscript에서 애플리케이션 코드로 직접 동기화한다
  // (기존에 깔린 트리거가 있는 DB도 여기서 제거된다).
  db.exec(`
    DROP TRIGGER IF EXISTS posts_ai;
    DROP TRIGGER IF EXISTS posts_au;
    DROP TRIGGER IF EXISTS posts_ad;
  `);
}

function syncFtsRow(db: Database.Database, id: string): void {
  const row = db
    .prepare(
      "SELECT rowid, id, title, content, author, collection_title, summary FROM posts WHERE id = ?"
    )
    .get(id) as
    | { rowid: number; id: string; title: string; content: string; author: string; collection_title: string | null; summary: string | null }
    | undefined;
  if (!row) return;

  // posts_fts는 content='posts'인 external-content 테이블이라, "SELECT ... FROM posts_fts
  // WHERE rowid=?"는 FTS 인덱스가 아니라 content 테이블(posts)의 값을 그대로 읽어온다.
  // 즉 이미 posts에 넣은 rowid는 인덱스에 한 번도 안 들어갔어도 "존재하는 것처럼" 보여서
  // 존재 확인으로 DELETE 여부를 판단할 수 없다. 그리고 한 번도 INSERT된 적 없는 빈
  // FTS5 인덱스에 DELETE를 날리면 매치가 없어도 그 자체로 SQLITE_CORRUPT_VTAB가 난다
  // (둘 다 실측 확인됨). 그래서 INSERT를 먼저 시도하고, rowid 충돌(이미 인덱싱된 경우)
  // 때만 UPDATE로 전환한다.
  try {
    db.prepare(
      `INSERT INTO posts_fts(rowid, id, title, content, author, collection_title, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(row.rowid, row.id, row.title, row.content, row.author, row.collection_title, row.summary);
  } catch {
    db.prepare(
      `UPDATE posts_fts SET title=?, content=?, author=?, collection_title=?, summary=?
       WHERE rowid=?`
    ).run(row.title, row.content, row.author, row.collection_title, row.summary, row.rowid);
  }
}

export function upsertPost(post: Post): void {
  const db = getDb();
  const result = db
    .prepare(
      `
    UPDATE posts SET
      title=@title, content=@content, content_html=@content_html,
      like_count=@like_count, view_count=@view_count,
      reply_count=@reply_count, summary=@summary,
      collection_title=@collection_title
    WHERE id=@id
  `
    )
    .run(post);

  if (result.changes === 0) {
    db.prepare(
      `
      INSERT INTO posts (
        id, post_no, title, content, content_html, author, creator_no, creator_url,
        published_at, url, like_count, view_count, reply_count, duration,
        has_video, collection_title, summary, indexed_at
      ) VALUES (
        @id, @post_no, @title, @content, @content_html, @author, @creator_no, @creator_url,
        @published_at, @url, @like_count, @view_count, @reply_count, @duration,
        @has_video, @collection_title, @summary, @indexed_at
      )
    `
    ).run(post);
  }

  syncFtsRow(db, post.id);
}

export function upsertVideoTranscript(
  postId: string,
  videoUrl: string,
  transcript: string,
  summary: string
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO videos (post_id, video_url, transcript, summary, transcribed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(post_id) DO UPDATE SET
      transcript=excluded.transcript, summary=excluded.summary,
      transcribed_at=excluded.transcribed_at
  `).run(postId, videoUrl, transcript, summary, new Date().toISOString());

  db.prepare("UPDATE posts SET summary=? WHERE id=?").run(summary, postId);
  syncFtsRow(db, postId);
}

export function searchPosts(query: string, limit = 20, offset = 0): Post[] {
  const db = getDb();
  return db.prepare(`
    SELECT p.* FROM posts_fts f
    JOIN posts p ON p.id = f.id
    WHERE posts_fts MATCH ?
    ORDER BY p.published_at DESC
    LIMIT ? OFFSET ?
  `).all(query, limit, offset) as Post[];
}

export function getRecentPosts(limit = 20, offset = 0): Post[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM posts ORDER BY published_at DESC LIMIT ? OFFSET ?"
  ).all(limit, offset) as Post[];
}

export function getTopPosts(by: "like" | "view" | "reply" = "like", limit = 20): Post[] {
  const col = by === "like" ? "like_count" : by === "view" ? "view_count" : "reply_count";
  const db = getDb();
  return db.prepare(
    `SELECT * FROM posts ORDER BY ${col} DESC LIMIT ?`
  ).all(limit) as Post[];
}

export function getTrackerState(key: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM tracker_state WHERE key=?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setTrackerState(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO tracker_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).run(key, value);
}
