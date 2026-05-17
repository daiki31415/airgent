/**
 * Compression Manager
 *
 * Context compression with metadata extraction and decompression.
 * RAW data is never deleted - only reference is compressed.
 */

import { randomUUID } from "node:crypto";
import { MemorySystem } from "../memory";
import { Storage } from "../storage";
import type { AgentMessage, CompressedEntry } from "../types";
import { rootLogger } from "../utils/logger";

export class CompressionManager {
  private memorySystem: MemorySystem;
  private storage: Storage;
  private logger = rootLogger.child("compression");

  constructor(memorySystem: MemorySystem, storage: Storage) {
    this.memorySystem = memorySystem;
    this.storage = storage;
  }

  /**
   * Compress a batch of messages into a compressed entry.
   */
  async compress(messages: AgentMessage[]): Promise<CompressedEntry> {
    const combined = messages.map(m => `[${m.role}]\n${m.content}`).join("\n\n");
    const metadata = this.extractMetadata(combined);

    const entry: CompressedEntry = {
      id: randomUUID(),
      originalId: messages[0]?.id || randomUUID(),
      title: metadata.topics.slice(0, 3).join(", ") || "Compressed context",
      topics: metadata.topics,
      timestamp: Date.now(),
      entities: metadata.entities,
      files: metadata.files,
      commands: metadata.commands,
      errorKeywords: metadata.errors,
      importanceScore: this.calculateImportance(metadata),
      tokenCount: Math.ceil(combined.length / 4),
      compressedContent: combined.length > 1000 ? combined.slice(0, 1000) + "\n...[truncated]" : combined,
    };

    return entry;
  }

  /**
   * Decompress a compressed entry by its ID (restore from storage).
   */
  async decompress(id: string): Promise<CompressedEntry> {
    const row = await this.findEntry(id);
    if (!row) throw new Error(`Compressed entry not found: ${id}`);
    return row;
  }

  /**
   * Compress all raw logs for a session.
   */
  async compressSession(sessionId: string): Promise<void> {
    const rawLogs = this.memorySystem.getRawLogsBySession(sessionId, 200);
    if (rawLogs.length === 0) return;

    const messages: AgentMessage[] = rawLogs.map(r => ({
      id: r.id,
      role: "user" as const,
      content: r.content,
      timestamp: r.timestamp || 0,
    }));

    const entry = await this.compress(messages);
    this.logger.info(`Compressed session ${sessionId}: ${messages.length} logs -> 1 entry`);
  }

  /**
   * Find compressed entries suitable for decompression based on topics/files/errors.
   */
  findForDecompression(options: {
    topics?: string[];
    files?: string[];
    errors?: string[];
  }): CompressedEntry[] {
    const allTerms = [...(options.topics || []), ...(options.files || []), ...(options.errors || [])];
    if (allTerms.length === 0) return [];

    const rows = this.storage.getCompressedByTopics(allTerms);
    return rows.map(r => ({
      id: r.id,
      originalId: r.original_id,
      title: r.title,
      topics: JSON.parse(r.topics || "[]"),
      timestamp: r.timestamp,
      entities: JSON.parse(r.entities || "[]"),
      files: JSON.parse(r.files || "[]"),
      commands: JSON.parse(r.commands || "[]"),
      errorKeywords: JSON.parse(r.error_keywords || "[]"),
      importanceScore: r.importance_score,
      tokenCount: r.token_count,
      compressedContent: r.compressed_content,
    }));
  }

  private findEntry(id: string): CompressedEntry | null {
    const row = this.storage.getCompressedByOriginalId(id);
    if (!row) return null;
    return {
      id: row.id,
      originalId: row.original_id,
      title: row.title,
      topics: JSON.parse(row.topics || "[]"),
      timestamp: row.timestamp,
      entities: JSON.parse(row.entities || "[]"),
      files: JSON.parse(row.files || "[]"),
      commands: JSON.parse(row.commands || "[]"),
      errorKeywords: JSON.parse(row.error_keywords || "[]"),
      importanceScore: row.importance_score,
      tokenCount: row.token_count,
      compressedContent: row.compressed_content,
    };
  }

  private extractMetadata(text: string): {
    topics: string[];
    entities: string[];
    files: string[];
    commands: string[];
    errors: string[];
  } {
    const topics = new Set<string>();
    const entities = new Set<string>();
    const files = new Set<string>();
    const commands = new Set<string>();
    const errors = new Set<string>();

    const lines = text.split("\n");

    for (const line of lines) {
      // Extract topics from headers and key phrases
      if (line.startsWith("#") || line.startsWith("##")) {
        topics.add(line.replace(/^#+\s*/, "").trim());
      }

      // Extract file paths
      const fileMatches = line.match(/[\w\-./]+\.(ts|js|tsx|jsx|py|rs|go|json|md|toml|yaml|yml)/g);
      if (fileMatches) fileMatches.forEach(f => files.add(f));

      // Extract commands
      const cmdMatches = line.match(/\$ (\S+(?:\s+\S+)*)/g);
      if (cmdMatches) cmdMatches.forEach(c => commands.add(c.slice(2)));

      // Extract error keywords
      const errorMatches = line.match(/\b(Error|TypeError|ReferenceError|SyntaxError|RangeError|E\d{4})\b/g);
      if (errorMatches) errorMatches.forEach(e => errors.add(e));

      // Extract entities (camelCase or PascalCase words)
      const entityMatches = line.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g);
      if (entityMatches) entityMatches.forEach(e => entities.add(e));
    }

    return {
      topics: Array.from(topics),
      entities: Array.from(entities),
      files: Array.from(files),
      commands: Array.from(commands),
      errors: Array.from(errors),
    };
  }

  private calculateImportance(metadata: {
    errors: string[];
    files: string[];
    commands: string[];
    entities: string[];
  }): number {
    let score = 0.3;

    // Errors increase importance
    score += Math.min(metadata.errors.length * 0.15, 0.3);

    // File changes increase importance
    score += Math.min(metadata.files.length * 0.05, 0.15);

    // Commands (tool usage) increase importance
    score += Math.min(metadata.commands.length * 0.05, 0.15);

    // Entity mentions increase importance
    score += Math.min(metadata.entities.length * 0.02, 0.1);

    return Math.min(score, 1.0);
  }
}
