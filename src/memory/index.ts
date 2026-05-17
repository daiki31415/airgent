/**
 * Memory System
 *
 * Manages structured memories with auto-linking and evidence tracking.
 */

import { randomUUID } from "node:crypto";
import { Storage } from "../storage";
import type { EvidenceEntry, StructuredMemory } from "../types";
import { rootLogger } from "../utils/logger";
import type { RawLogRow, MemoryRow } from "../storage/index";

export class MemorySystem {
  private storage: Storage;
  private logger = rootLogger.child("memory");

  constructor(storage: Storage) {
    this.storage = storage;
  }

  /**
   * Record a raw reasoning log.
   */
  recordRaw(sessionId: string, agentRole: string, content: string, tokenCount = 0): void {
    this.storage.insertRawLog(randomUUID(), sessionId, agentRole, content, tokenCount);
  }

  /**
   * Get raw logs for a session.
   */
  getRawLogsBySession(sessionId: string, limit = 100): RawLogRow[] {
    return this.storage.getRawLogs(sessionId, limit);
  }

  /**
   * Create a structured memory with auto-linking.
   */
  createMemory(params: {
    sessionId: string;
    bug: string;
    investigation: string;
    rootCause: string;
    fix: string;
    reason: string;
    evidence: EvidenceEntry[];
    confidence: number;
    tags: string[];
    files: string[];
    commands: string[];
  }): string {
    const id = randomUUID();

    this.storage.insertMemory({
      id,
      sessionId: params.sessionId,
      bug: params.bug,
      investigation: params.investigation,
      rootCause: params.rootCause,
      fix: params.fix,
      reason: params.reason,
      confidence: params.confidence,
      tags: params.tags,
      files: params.files,
      commands: params.commands,
    });

    // Insert evidence entries
    for (const ev of params.evidence) {
      this.storage.insertEvidence(randomUUID(), id, ev.type, ev.content, ev.source);
    }

    // Auto-link to similar memories
    this.autoLink(id, params.tags, params.confidence);

    this.logger.info(`Created memory: ${id} (${params.bug.slice(0, 60)})`);
    return id;
  }

  /**
   * Find relevant memories by tags.
   */
  findRelevant(tags: string[], minConfidence = 0.3): StructuredMemory[] {
    if (tags.length === 0) {
      return [] as StructuredMemory[];
    }
    const results = this.storage.searchMemories(tags, minConfidence);
    return results.map(r => this.rowToMemory(r)).filter(Boolean) as StructuredMemory[];
  }

  /**
   * Get linked memories.
   */
  getLinked(memoryId: string): StructuredMemory[] {
    const results = this.storage.getLinkedMemories(memoryId);
    return results.map(r => this.rowToMemory(r)).filter(Boolean) as StructuredMemory[];
  }

  /**
   * Get evidence for a memory.
   */
  getEvidence(memoryId: string): Array<{ id: string; type: string; content: string; source: string; timestamp: number }> {
    return this.storage.getEvidence(memoryId);
  }

  /**
   * Find contradictions in memory graph.
   */
  findContradictions(): unknown[] {
    return this.storage.findContradictions();
  }

  /**
   * Find circular references in memory links.
   */
  findCircularReferences(): unknown[] {
    return this.storage.findCircularReferences();
  }

  /**
   * Auto-link a new memory to existing similar ones.
   */
  private autoLink(newId: string, tags: string[], confidence: number): void {
    if (tags.length === 0) return;

    const similar = this.storage.searchMemories(tags, confidence * 0.8);
    for (const sim of similar) {
      const simId = sim.id as string;
      if (simId === newId) continue;

      // Calculate link confidence
      const simTags = JSON.parse((sim.tags as string) || "[]") as string[];
      const commonTags = tags.filter(t => simTags.includes(t));
      const linkConfidence = commonTags.length / Math.max(tags.length, simTags.length);
      const linkType = linkConfidence > 0.7 ? "same_cause" : "similar_pattern";

      this.storage.insertLink(randomUUID(), newId, simId, linkType, linkConfidence);
      this.logger.debug(`Auto-linked: ${newId} <-> ${simId} (${linkType}, ${linkConfidence.toFixed(2)})`);
    }
  }

  private rowToMemory(row: MemoryRow): StructuredMemory | null {
    if (!row || !row.id) return null;
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      bug: (row.bug as string) || "",
      investigation: (row.investigation as string) || "",
      root_cause: (row.root_cause as string) || "",
      fix: (row.fix as string) || "",
      reason: (row.reason as string) || "",
      evidence: [],
      confidence: (row.confidence as number) || 0.5,
      tags: JSON.parse((row.tags as string) || "[]"),
      files: JSON.parse((row.files as string) || "[]"),
      commands: JSON.parse((row.commands as string) || "[]"),
      created: (row.created as number) || 0,
      updated: (row.updated as number) || 0,
      links: [],
    };
  }
}
