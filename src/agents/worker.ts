/**
 * Worker Agent
 *
 * Responsibility: Primary task execution.
 * Uses skills and compressed context for enhanced generation.
 */

import { BaseAgent } from "./base";
import { CompressionManager } from "../compression";
import { SkillsManager } from "../skills";
import { MemorySystem } from "../memory";
import type { CompressedEntry } from "../types";

export class WorkerAgent extends BaseAgent {
  private compression: CompressionManager;
  private skills: SkillsManager;
  private memorySystem: MemorySystem;

  constructor(
    model: import("../types").ModelEntry,
    api: import("../api/opencode").OpenCodeAPI,
    compression: CompressionManager,
    skills: SkillsManager,
    memorySystem: MemorySystem
  ) {
    super("worker", model, api);
    this.compression = compression;
    this.skills = skills;
    this.memorySystem = memorySystem;
  }

  async execute(prompt: string, onChunk?: (chunk: string) => void): Promise<{ content: string }> {
    this.logger.info(`Executing: ${prompt.slice(0, 100)}`);

    const decompressed = this.findRelevantContext(prompt);
    let contextEnhancement = "";
    if (decompressed.length > 0) {
      contextEnhancement =
        "Relevant past context:\n" +
        decompressed.slice(0, 3).map(e => `- ${e.title}: ${e.topics.join(", ")}`).join("\n");
    }

    const fullPrompt = [contextEnhancement, prompt].filter(Boolean).join("\n\n");

    this.memorySystem.recordRaw(this.context?.sessionId || "", "worker", fullPrompt, this.estimateTokens(fullPrompt));

    if (onChunk) {
      let content = "";
      for await (const chunk of this.thinkStream(fullPrompt)) {
        content += chunk;
        onChunk(chunk);
      }
      this.memorySystem.recordRaw(this.context?.sessionId || "", "worker_response", content, this.estimateTokens(content));
      return { content };
    }

    const result = await this.think(fullPrompt);
    this.memorySystem.recordRaw(this.context?.sessionId || "", "worker_response", result, this.estimateTokens(result));
    return { content: result };
  }

  private findRelevantContext(prompt: string): CompressedEntry[] {
    const topics = this.extractTopics(prompt);
    return topics.length > 0 ? this.compression.findForDecompression({ topics }) : [];
  }

  private extractTopics(text: string): string[] {
    const topics = new Set<string>();
    const patterns = [
      /(?:error|bug|fix|issue):\s*(\w+)/gi,
      /(?:in|of|for)\s+(the\s+)?(\w+\.\w+)/g,
      /\b(?:TypeError|ReferenceError|SyntaxError)\w*/g,
    ];

    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        if (match) {
          const captured = match[match.length - 1];
          if (captured && captured.length > 2) topics.add(captured.toLowerCase());
        }
      }
    }
    return Array.from(topics);
  }
}
