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
  collection_no: number | null;
  collection_title: string | null;
  collection_post_order: number | null;
  collection_post_count: number | null;
  summary: string | null;
  indexed_at: string;
}

export interface Series {
  collection_no: number;
  collection_title: string | null;
  creator_no: number;
  creator_url: string;
  post_count: number;
  indexed_post_count: number;
  latest_published_at: string;
}

export interface SeriesPostFilters {
  query?: string;
  date?: string;
  has_video?: boolean;
  min_like?: number;
  min_view?: number;
  order?: "latest" | "oldest" | "like" | "view" | "reply" | "series";
  limit?: number;
  offset?: number;
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

function postColumnSet(db: Database.Database): Set<string> {
  return new Set(
    (db.prepare("PRAGMA table_info(posts)").all() as { name: string }[]).map((c) => c.name)
  );
}

function hasPostColumn(db: Database.Database, column: string): boolean {
  return postColumnSet(db).has(column);
}

function normalizePostRow(row: Partial<Post>): Post {
  return {
    ...row,
    collection_no: row.collection_no ?? null,
    collection_title: row.collection_title ?? null,
    collection_post_order: row.collection_post_order ?? null,
    collection_post_count: row.collection_post_count ?? null,
  } as Post;
}

function normalizePostRows(rows: Partial<Post>[]): Post[] {
  return rows.map(normalizePostRow);
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
      collection_no INTEGER,
      collection_title TEXT,
      collection_post_order INTEGER,
      collection_post_count INTEGER,
      summary TEXT,
      indexed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_creator_no ON posts(creator_no);
    CREATE INDEX IF NOT EXISTS idx_posts_like_count ON posts(like_count DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_collection_no ON posts(collection_no);

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

  ensureColumn(db, "posts", "collection_no", "INTEGER");
  ensureColumn(db, "posts", "collection_post_order", "INTEGER");
  ensureColumn(db, "posts", "collection_post_count", "INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS idx_posts_collection_no ON posts(collection_no);");
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
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
  const columns = postColumnSet(db);
  const collectionUpdateParts = [
    columns.has("collection_no") ? "collection_no=@collection_no" : null,
    columns.has("collection_title") ? "collection_title=@collection_title" : null,
    columns.has("collection_post_order") ? "collection_post_order=@collection_post_order" : null,
    columns.has("collection_post_count") ? "collection_post_count=@collection_post_count" : null,
  ].filter((part): part is string => part !== null);
  const collectionUpdateSql = collectionUpdateParts.length > 0
    ? `,\n      ${collectionUpdateParts.join(",\n      ")}`
    : "";
  const result = db
    .prepare(
      `
    UPDATE posts SET
      title=@title, content=@content, content_html=@content_html,
      like_count=@like_count, view_count=@view_count,
      reply_count=@reply_count, summary=@summary${collectionUpdateSql}
    WHERE id=@id
  `
    )
    .run(post);

  if (result.changes === 0) {
    const insertColumns = [
      "id", "post_no", "title", "content", "content_html", "author", "creator_no", "creator_url",
      "published_at", "url", "like_count", "view_count", "reply_count", "duration", "has_video",
      columns.has("collection_no") ? "collection_no" : null,
      columns.has("collection_title") ? "collection_title" : null,
      columns.has("collection_post_order") ? "collection_post_order" : null,
      columns.has("collection_post_count") ? "collection_post_count" : null,
      "summary", "indexed_at",
    ].filter((column): column is string => column !== null);
    const insertValues = insertColumns.map((column) => `@${column}`);
    db.prepare(
      `
      INSERT INTO posts (${insertColumns.join(", ")})
      VALUES (${insertValues.join(", ")})
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
  return normalizePostRows(db.prepare(`
    SELECT p.* FROM posts_fts f
    JOIN posts p ON p.id = f.id
    WHERE posts_fts MATCH ?
    ORDER BY p.published_at DESC
    LIMIT ? OFFSET ?
  `).all(query, limit, offset) as Partial<Post>[]);
}

export function getRecentPosts(limit = 20, offset = 0): Post[] {
  const db = getDb();
  return normalizePostRows(db.prepare(
    "SELECT * FROM posts ORDER BY published_at DESC LIMIT ? OFFSET ?"
  ).all(limit, offset) as Partial<Post>[]);
}

export function getTopPosts(by: "like" | "view" | "reply" = "like", limit = 20): Post[] {
  const col = by === "like" ? "like_count" : by === "view" ? "view_count" : "reply_count";
  const db = getDb();
  return normalizePostRows(db.prepare(
    `SELECT * FROM posts ORDER BY ${col} DESC LIMIT ?`
  ).all(limit) as Partial<Post>[]);
}

export function listSeries(): Series[] {
  const db = getDb();
  const columns = postColumnSet(db);
  if (!columns.has("collection_no")) return [];
  const postCountExpr = columns.has("collection_post_count")
    ? "COALESCE(MAX(collection_post_count), COUNT(*))"
    : "COUNT(*)";
  return db.prepare(`
    SELECT
      collection_no,
      COALESCE(MAX(collection_title), NULL) AS collection_title,
      creator_no,
      creator_url,
      ${postCountExpr} AS post_count,
      COUNT(*) AS indexed_post_count,
      MAX(published_at) AS latest_published_at
    FROM posts
    WHERE collection_no IS NOT NULL
    GROUP BY collection_no, creator_no, creator_url
    ORDER BY latest_published_at DESC
  `).all() as Series[];
}

export function getSeriesPosts(
  collectionNo: number,
  filters: SeriesPostFilters = {}
): Post[] {
  const db = getDb();
  const columns = postColumnSet(db);
  if (!columns.has("collection_no")) return [];
  const clauses = ["p.collection_no = ?"];
  const params: unknown[] = [collectionNo];

  if (filters.query?.trim()) {
    clauses.push("p.id IN (SELECT id FROM posts_fts WHERE posts_fts MATCH ?)");
    params.push(filters.query.trim());
  }
  if (filters.date?.trim()) {
    clauses.push("p.published_at LIKE ?");
    params.push(`${filters.date.trim()}%`);
  }
  if (filters.has_video !== undefined) {
    clauses.push("p.has_video = ?");
    params.push(filters.has_video ? 1 : 0);
  }
  if (filters.min_like !== undefined) {
    clauses.push("p.like_count >= ?");
    params.push(filters.min_like);
  }
  if (filters.min_view !== undefined) {
    clauses.push("p.view_count >= ?");
    params.push(filters.min_view);
  }

  const orderBy = (() => {
    switch (filters.order ?? "series") {
      case "latest":
        return "p.published_at DESC";
      case "oldest":
        return "p.published_at ASC";
      case "like":
        return "p.like_count DESC, p.published_at DESC";
      case "view":
        return "p.view_count DESC, p.published_at DESC";
      case "reply":
        return "p.reply_count DESC, p.published_at DESC";
      case "series":
        return columns.has("collection_post_order")
          ? "p.collection_post_order ASC, p.published_at ASC"
          : "p.published_at ASC";
    }
  })();

  params.push(filters.limit ?? 20, filters.offset ?? 0);
  return normalizePostRows(db.prepare(`
    SELECT p.*
    FROM posts p
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params) as Partial<Post>[]);
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
