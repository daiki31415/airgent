/**
 * Airgent Storage Layer
 *
 * Single SQLite database with all tables.
 * Merged from 5 separate DBs into one.
 */

import { Database } from "bun:sqlite";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { rootLogger } from "../utils/logger";

export interface RawLogRow {
  id: string; session_id: string; agent_role: string; content: string;
  timestamp: number; token_count: number;
}

export interface MemoryRow {
  id: string; session_id: string; bug: string; investigation: string;
  root_cause: string; fix: string; reason: string; confidence: number;
  tags: string; files: string; commands: string; created: number; updated: number;
}

export interface SessionRow {
  id: string; start_time: number; end_time: number | null;
  status: string; error_count: number; total_tokens: number; model_used: string;
}

export interface CompressedRow {
  id: string; original_id: string; title: string; topics: string;
  timestamp: number; entities: string; files: string; commands: string;
  error_keywords: string; importance_score: number; token_count: number;
  compressed_content: string;
}

const STORAGE_DIR = path.join(
  os.homedir(),
  ".config",
  "Airgent",
  "memory"
);

export class Storage {
  private db: Database;
  private logger = rootLogger.child("db");

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(STORAGE_DIR, "airgent.db");
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });

    this.db = new Database(finalPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA synchronous=NORMAL");
    this.init();
    this.logger.info(`Storage initialized at ${finalPath}`);
  }

  private init(): void {
    // Raw logs
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS raw_logs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        agent_role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        token_count INTEGER DEFAULT 0
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_raw_session ON raw_logs(session_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_raw_ts ON raw_logs(timestamp)");

    // Structured memories
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        bug TEXT DEFAULT '',
        investigation TEXT DEFAULT '',
        root_cause TEXT DEFAULT '',
        fix TEXT DEFAULT '',
        reason TEXT DEFAULT '',
        confidence REAL DEFAULT 0.5,
        tags TEXT DEFAULT '[]',
        files TEXT DEFAULT '[]',
        commands TEXT DEFAULT '[]',
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_mem_session ON memories(session_id)");

    // Evidence entries
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('observed','inferred','generated','verified')),
        content TEXT NOT NULL,
        source TEXT DEFAULT '',
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_ev_memory ON evidence(memory_id)");

    // Memory links
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_links (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('same_cause','derived','similar_pattern','related_component')),
        confidence REAL DEFAULT 0.5,
        FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_link_source ON memory_links(source_id)");

    // Sessions
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','failed','crashed')),
        error_count INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        model_used TEXT DEFAULT ''
      )
    `);

    // Session messages
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        token_count INTEGER DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_sm_session ON session_messages(session_id)");

    // Compressed entries
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS compressed_entries (
        id TEXT PRIMARY KEY,
        original_id TEXT NOT NULL,
        title TEXT DEFAULT '',
        topics TEXT DEFAULT '[]',
        timestamp INTEGER NOT NULL,
        entities TEXT DEFAULT '[]',
        files TEXT DEFAULT '[]',
        commands TEXT DEFAULT '[]',
        error_keywords TEXT DEFAULT '[]',
        importance_score REAL DEFAULT 0.5,
        token_count INTEGER DEFAULT 0,
        compressed_content TEXT NOT NULL
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_comp_topics ON compressed_entries(topics)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_comp_importance ON compressed_entries(importance_score)");

    // Metadata (key-value + sync state in one table)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated INTEGER NOT NULL
      )
    `);
  }

  // ---- RAW Logs ----

  insertRawLog(id: string, sessionId: string, agentRole: string, content: string, tokenCount = 0): void {
    this.db.prepare(
      "INSERT INTO raw_logs (id, session_id, agent_role, content, timestamp, token_count) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, sessionId, agentRole, content, Date.now(), tokenCount);
  }

  getRawLogs(sessionId: string, limit = 100): RawLogRow[] {
    return this.db.prepare(
      "SELECT * FROM raw_logs WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?"
    ).all(sessionId, limit) as RawLogRow[];
  }

  deleteRawLogsOlderThan(timestamp: number): void {
    this.db.prepare("DELETE FROM raw_logs WHERE timestamp < ?").run(timestamp);
  }

  // ---- Memories ----

  insertMemory(m: {
    id: string; sessionId: string; bug: string; investigation: string;
    rootCause: string; fix: string; reason: string; confidence: number;
    tags: string[]; files: string[]; commands: string[];
  }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO memories (id,session_id,bug,investigation,root_cause,fix,reason,confidence,tags,files,commands,created,updated)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(m.id, m.sessionId, m.bug, m.investigation, m.rootCause, m.fix, m.reason, m.confidence,
      JSON.stringify(m.tags), JSON.stringify(m.files), JSON.stringify(m.commands), now, now);
  }

  getMemory(id: string): MemoryRow | null {
    return this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as MemoryRow | null;
  }

  searchMemories(tags: string[], minConfidence = 0.3): MemoryRow[] {
    const conditions = tags.map(() => "tags LIKE ?").join(" OR ");
    return this.db.prepare(
      `SELECT * FROM memories WHERE confidence >= ? AND (${conditions}) ORDER BY confidence DESC LIMIT 20`
    ).all(minConfidence, ...tags.map(t => `%${t}%`)) as MemoryRow[];
  }

  getLinkedMemories(memoryId: string): (MemoryRow & { link_type: string; link_confidence: number })[] {
    return this.db.prepare(`
      SELECT m.*, l.type as link_type, l.confidence as link_confidence
      FROM memories m JOIN memory_links l ON (l.target_id = m.id OR l.source_id = m.id)
      WHERE (l.source_id = ? OR l.target_id = ?) AND l.confidence >= 0.5
    `).all(memoryId, memoryId) as (MemoryRow & { link_type: string; link_confidence: number })[];
  }

  insertLink(id: string, sourceId: string, targetId: string, type: string, confidence: number): void {
    this.db.prepare(
      "INSERT INTO memory_links (id, source_id, target_id, type, confidence) VALUES (?, ?, ?, ?, ?)"
    ).run(id, sourceId, targetId, type, confidence);
  }

  insertEvidence(id: string, memoryId: string, type: string, content: string, source: string): void {
    this.db.prepare(
      "INSERT INTO evidence (id, memory_id, type, content, source, timestamp) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, memoryId, type, content, source, Date.now());
  }

  getEvidence(memoryId: string): Array<{ id: string; type: string; content: string; source: string; timestamp: number }> {
    return this.db.prepare("SELECT * FROM evidence WHERE memory_id = ? ORDER BY timestamp").all(memoryId) as Array<{ id: string; type: string; content: string; source: string; timestamp: number }>;
  }

  findContradictions(): Array<{ m1_id: string; m1_cause: string; m2_id: string; m2_cause: string }> {
    return this.db.prepare(`
      SELECT m1.id as m1_id, m1.root_cause as m1_cause, m2.id as m2_id, m2.root_cause as m2_cause
      FROM memories m1 JOIN memory_links l ON l.source_id = m1.id
      JOIN memories m2 ON m2.id = l.target_id
      WHERE l.type = 'same_cause' AND m1.root_cause != m2.root_cause AND l.confidence > 0.5
    `).all() as Array<{ m1_id: string; m1_cause: string; m2_id: string; m2_cause: string }>;
  }

  findCircularReferences(): Array<{ source_id: string; target_id: string; cycle_point: string }> {
    return this.db.prepare(`
      SELECT l1.source_id, l1.target_id, l2.source_id as cycle_point
      FROM memory_links l1 JOIN memory_links l2 ON l1.target_id = l2.source_id
      WHERE l2.target_id = l1.source_id AND l1.id < l2.id
    `).all() as Array<{ source_id: string; target_id: string; cycle_point: string }>;
  }

  // ---- Sessions ----

  createSession(id: string, model?: string): void {
    this.db.prepare(
      "INSERT INTO sessions (id, start_time, status, model_used) VALUES (?, ?, 'active', ?)"
    ).run(id, Date.now(), model || "unknown");
  }

  endSession(id: string, status: string): void {
    this.db.prepare("UPDATE sessions SET end_time = ?, status = ? WHERE id = ?").run(Date.now(), status, id);
  }

  getSession(id: string): SessionRow | null {
    return this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | null;
  }

  getActiveSessions(): SessionRow[] {
    return this.db.prepare("SELECT * FROM sessions WHERE status = 'active'").all() as SessionRow[];
  }

  addSessionMessage(id: string, sessionId: string, role: string, content: string, tokenCount = 0): void {
    this.db.prepare(
      "INSERT INTO session_messages (id, session_id, role, content, timestamp, token_count) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, sessionId, role, content, Date.now(), tokenCount);
  }

  // ---- Compressed Entries ----

  insertCompressedEntry(e: {
    id: string; originalId: string; title: string; topics: string[];
    entities: string[]; files: string[]; commands: string[];
    errorKeywords: string[]; importanceScore: number; tokenCount: number; compressedContent: string;
  }): void {
    this.db.prepare(`
      INSERT INTO compressed_entries (id,original_id,title,topics,timestamp,entities,files,commands,error_keywords,importance_score,token_count,compressed_content)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(e.id, e.originalId, e.title, JSON.stringify(e.topics), Date.now(),
      JSON.stringify(e.entities), JSON.stringify(e.files), JSON.stringify(e.commands),
      JSON.stringify(e.errorKeywords), e.importanceScore, e.tokenCount, e.compressedContent);
  }

  getCompressedByTopics(topics: string[]): CompressedRow[] {
    const conditions = topics.map(() => "topics LIKE ?").join(" OR ");
    return this.db.prepare(
      `SELECT * FROM compressed_entries WHERE ${conditions} ORDER BY importance_score DESC LIMIT 10`
    ).all(...topics.map(t => `%${t}%`)) as CompressedRow[];
  }

  getCompressedByOriginalId(originalId: string): CompressedRow | null {
    return this.db.prepare("SELECT * FROM compressed_entries WHERE original_id = ?").get(originalId) as CompressedRow | null;
  }

  // ---- Metadata ----

  setMetadata(key: string, value: string): void {
    const now = Date.now();
    this.db.prepare("INSERT INTO metadata (key, value, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated = ?")
      .run(key, value, now, value, now);
  }

  getMetadata(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM metadata WHERE key = ?").get(key) as { value: string } | null;
    return row?.value || null;
  }

  getAllCompressed(): Array<{ id: string; originalId: string; title: string; topics: string[]; timestamp: number; entities: string[]; files: string[]; commands: string[]; errorKeywords: string[]; importanceScore: number; tokenCount: number; compressedContent: string }> {
    const rows = this.db.prepare("SELECT * FROM compressed_entries ORDER BY timestamp DESC").all() as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: r.id as string,
      originalId: r.original_id as string,
      title: (r.title as string) || "",
      topics: JSON.parse((r.topics as string) || "[]"),
      timestamp: (r.timestamp as number) || 0,
      entities: JSON.parse((r.entities as string) || "[]"),
      files: JSON.parse((r.files as string) || "[]"),
      commands: JSON.parse((r.commands as string) || "[]"),
      errorKeywords: JSON.parse((r.error_keywords as string) || "[]"),
      importanceScore: (r.importance_score as number) || 0,
      tokenCount: (r.token_count as number) || 0,
      compressedContent: (r.compressed_content as string) || "",
    }));
  }

  getAllMetadata(): Record<string, string> {
    const rows = this.db.prepare("SELECT key, value FROM metadata").all() as Array<{ key: string; value: string }>;
    const result: Record<string, string> = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
  }

  getRecentSessions(limit = 50): Array<{ id: string; summary: string }> {
    const rows = this.db.prepare(
      "SELECT id, status || ' ' || model_used as summary FROM sessions ORDER BY start_time DESC LIMIT ?"
    ).all(limit) as Array<{ id: string; summary: string }>;
    return rows;
  }

  saveCompressedEntry(entry: { id: string; originalId: string; title: string; topics: string[]; timestamp: number; entities: string[]; files: string[]; commands: string[]; errorKeywords: string[]; importanceScore: number; tokenCount: number; compressedContent: string }): void {
    const existing = this.db.prepare("SELECT id FROM compressed_entries WHERE id = ?").get(entry.id);
    if (existing) return;
    this.db.prepare(`
      INSERT INTO compressed_entries (id,original_id,title,topics,timestamp,entities,files,commands,error_keywords,importance_score,token_count,compressed_content)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(entry.id, entry.originalId, entry.title, JSON.stringify(entry.topics), entry.timestamp,
      JSON.stringify(entry.entities), JSON.stringify(entry.files), JSON.stringify(entry.commands),
      JSON.stringify(entry.errorKeywords), entry.importanceScore, entry.tokenCount, entry.compressedContent);
  }

  // ---- Maintenance ----

  close(): void {
    this.db.close();
    this.logger.info("Database closed");
  }
}
