/**
 * Base Agent
 *
 * Foundation for all Airgent agents.
 * Provides model interaction and logging.
 */

import type { AgentRole, AgentContext, ModelEntry } from "../types";
import { rootLogger } from "../utils/logger";
import { OpenCodeAPI } from "../api/opencode";

export abstract class BaseAgent {
  readonly role: AgentRole;
  protected api: OpenCodeAPI;
  protected model: ModelEntry;
  protected logger;
  protected context: AgentContext | null = null;

  constructor(role: AgentRole, model: ModelEntry, api: OpenCodeAPI) {
    this.role = role;
    this.model = model;
    this.api = api;
    this.logger = rootLogger.child(role);
  }

  /**
   * Initialize agent with session context.
   */
  init(context: AgentContext): void {
    this.context = context;
    this.logger.debug(`Initialized with session: ${context.sessionId}`);
  }

  /**
   * Send a prompt to the model and get the response text.
   */
  protected async think(prompt: string): Promise<string> {
    if (!this.context) {
      throw new Error("Agent not initialized - call init() first");
    }

    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: this.context.systemPrompt },
      { role: "user", content: prompt },
    ];

    const response = await this.api.chat(this.model, messages);
    return response.content;
  }

  /**
   * Stream a prompt and yield chunks as they arrive.
   */
  protected async *thinkStream(prompt: string): AsyncGenerator<string> {
    if (!this.context) {
      throw new Error("Agent not initialized - call init() first");
    }

    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: this.context.systemPrompt },
      { role: "user", content: prompt },
    ];

    yield* this.api.streamChat(this.model, messages);
  }

  /**
   * Switch to a different model configuration.
   */
  switchModel(model: ModelEntry): void {
    this.logger.info(`Switching model: ${this.model.model} -> ${model.model}`);
    this.model = model;
  }

  /**
   * Rough token count estimate (~4 chars/token).
   */
  protected estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Cleanup resources.
   */
  async destroy(): Promise<void> {
    this.context = null;
  }
}
