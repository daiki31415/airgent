/**
 * OpenCode API Client
 *
 * Connects to the OpenCode server REST API.
 * Default: http://127.0.0.1:4096
 *
 * Server must be running: `opencode serve`
 * Auth: OPENCODE_SERVER_PASSWORD env var (username defaults to "opencode")
 */

import { rootLogger } from "../utils/logger";
import type { ModelEntry, OpenCodeResponse } from "../types";

const logger = rootLogger.child("api");

export interface ProviderInfo {
  id: string;
  name: string;
  models?: Record<string, { name?: string }>;
}

export interface ProviderAuthMethod {
  type: string;
  label?: string;
}

export interface OpenCodeSession {
  id: string;
  title?: string;
  parentID?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessagePart {
  type: string;
  text?: string;
  content?: string;
}

export interface MessageInfo {
  id: string;
  sessionID: string;
  role: "user" | "assistant" | "system";
  parts: MessagePart[];
  structured_output?: Record<string, unknown>;
  error?: { name: string; message: string; retries?: number };
}

export interface PromptResult {
  info: MessageInfo;
  parts: MessagePart[];
}

export class OpenCodeAPI {
  private baseUrl: string;
  private authHeader: string | null = null;

  constructor(options?: { baseUrl?: string; password?: string }) {
    this.baseUrl = (options?.baseUrl || process.env.OPENCODE_BASE_URL || "http://127.0.0.1:4096").replace(/\/+$/, "");

    const username = process.env.OPENCODE_SERVER_USERNAME || "opencode";
    const password = options?.password || process.env.OPENCODE_SERVER_PASSWORD || "";
    if (password) {
      this.authHeader = "Basic " + btoa(`${username}:${password}`);
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authHeader) h.Authorization = this.authHeader;
    return h;
  }

  // ---- Global ----

  async healthCheck(): Promise<{ healthy: boolean; version?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/global/health`, { headers: this.headers(), signal: AbortSignal.timeout(2000) });
      if (!res.ok) return { healthy: false };
      const data = await res.json() as { healthy: boolean; version?: string };
      return data;
    } catch {
      return { healthy: false };
    }
  }

  // ---- Provider ----

  async listProviders(): Promise<{ all: ProviderInfo[]; connected: string[]; defaults: Record<string, string> }> {
    const res = await fetch(`${this.baseUrl}/provider`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to list providers: ${res.status}`);
    return res.json() as Promise<{ all: ProviderInfo[]; connected: string[]; defaults: Record<string, string> }>;
  }

  async getAuthMethods(): Promise<Record<string, ProviderAuthMethod[]>> {
    const res = await fetch(`${this.baseUrl}/provider/auth`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get auth methods: ${res.status}`);
    return res.json() as Promise<Record<string, ProviderAuthMethod[]>>;
  }

  async setAuth(providerId: string, apiKey: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/auth/${providerId}`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({ type: "api", key: apiKey }),
    });
    if (!res.ok) throw new Error(`Failed to set auth for ${providerId}: ${res.status}`);
    return true;
  }

  // ---- Sessions ----

  async createSession(title?: string): Promise<OpenCodeSession> {
    const res = await fetch(`${this.baseUrl}/session`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
    return res.json() as Promise<OpenCodeSession>;
  }

  async listSessions(): Promise<OpenCodeSession[]> {
    const res = await fetch(`${this.baseUrl}/session`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to list sessions: ${res.status}`);
    return res.json() as Promise<OpenCodeSession[]>;
  }

  async getSession(id: string): Promise<OpenCodeSession> {
    const res = await fetch(`${this.baseUrl}/session/${id}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to get session: ${res.status}`);
    return res.json() as Promise<OpenCodeSession>;
  }

  async deleteSession(id: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/session/${id}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to delete session: ${res.status}`);
    return res.json() as Promise<boolean>;
  }

  async abortSession(id: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/session/${id}/abort`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to abort session: ${res.status}`);
    return res.json() as Promise<boolean>;
  }

  // ---- Messages ----

  async sendMessage(
    sessionId: string,
    model: { providerID: string; modelID: string },
    text: string,
    options?: { system?: string; noReply?: boolean }
  ): Promise<PromptResult> {
    const body: Record<string, unknown> = {
      model,
      parts: [{ type: "text", text }],
    };
    if (options?.system) body.system = options.system;
    if (options?.noReply) body.noReply = true;

    const res = await fetch(`${this.baseUrl}/session/${sessionId}/message`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Failed to send message: ${res.status} ${errText.slice(0, 200)}`);
    }

    return res.json() as Promise<PromptResult>;
  }

  async listMessages(sessionId: string, limit?: number): Promise<Array<{ info: MessageInfo; parts: MessagePart[] }>> {
    const url = limit
      ? `${this.baseUrl}/session/${sessionId}/message?limit=${limit}`
      : `${this.baseUrl}/session/${sessionId}/message`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to list messages: ${res.status}`);
    return res.json() as Promise<Array<{ info: MessageInfo; parts: MessagePart[] }>>;
  }

  // ---- Legacy compatibility ----
  // Wraps the server API to match the old ModelEntry-based interface used by agents.

  private _lastSessionId: string | null = null;

  async chat(
    model: ModelEntry,
    messages: Array<{ role: string; content: string }>
  ): Promise<OpenCodeResponse> {
    const startTime = Date.now();

    // Ensure we have a session
    let sessionId = this._lastSessionId;
    if (!sessionId) {
      const session = await this.createSession("airgent");
      sessionId = session.id;
      this._lastSessionId = sessionId;
    }

    // Convert messages array to a single text prompt
    // The last user message is the prompt, previous messages provide context
    const userMessages = messages.filter(m => m.role === "user");
    const systemMessages = messages.filter(m => m.role === "system");
    const lastUserMessage = userMessages[userMessages.length - 1];

    if (!lastUserMessage) {
      throw new Error("No user message in request");
    }

    // Build context from previous messages
    let contextText = "";
    if (userMessages.length > 1) {
      contextText = userMessages.slice(0, -1).map(m => `[Previous] ${m.content}`).join("\n\n");
    }

    const fullPrompt = contextText ? `${contextText}\n\n[Current] ${lastUserMessage.content}` : lastUserMessage.content;
    const systemPrompt = systemMessages.map(m => m.content).join("\n");

    // Parse model string: "provider/model" or use model.provider + model.model
    let providerID: string;
    let modelID: string;
    if (model.model.includes("/")) {
      const sep = model.model.indexOf("/");
      providerID = model.model.slice(0, sep);
      modelID = model.model.slice(sep + 1);
    } else {
      providerID = model.provider || "opencode";
      modelID = model.model;
    }

    logger.debug(`chat() ${providerID}/${modelID} - ${messages.length} messages`);

    const result = await this.sendMessage(sessionId, { providerID, modelID }, fullPrompt, {
      system: systemPrompt || undefined,
    });

    const elapsed = Date.now() - startTime;
    logger.debug(`Response in ${elapsed}ms`);

    // Extract text content from parts
    const content = result.parts
      .filter(p => p.type === "text")
      .map(p => p.text || p.content || "")
      .join("\n");

    return {
      id: result.info.id,
      content,
      model: `${providerID}/${modelID}`,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  async *streamChat(
    model: ModelEntry,
    messages: Array<{ role: string; content: string }>
  ): AsyncGenerator<string> {
    // Ensure a session exists
    let sessionId = this._lastSessionId;
    if (!sessionId) {
      const session = await this.createSession("airgent");
      sessionId = session.id;
      this._lastSessionId = sessionId;
    }

    // Build prompt from messages (same as chat())
    const userMessages = messages.filter(m => m.role === "user");
    const systemMessages = messages.filter(m => m.role === "system");
    const lastUserMessage = userMessages[userMessages.length - 1];
    if (!lastUserMessage) throw new Error("No user message in request");

    let contextText = "";
    if (userMessages.length > 1) {
      contextText = userMessages.slice(0, -1).map(m => `[Previous] ${m.content}`).join("\n\n");
    }
    const fullPrompt = contextText ? `${contextText}\n\n[Current] ${lastUserMessage.content}` : lastUserMessage.content;
    const systemPrompt = systemMessages.map(m => m.content).join("\n");

    let providerID: string;
    let modelID: string;
    if (model.model.includes("/")) {
      const sep = model.model.indexOf("/");
      providerID = model.model.slice(0, sep);
      modelID = model.model.slice(sep + 1);
    } else {
      providerID = model.provider || "opencode";
      modelID = model.model;
    }

    // Try SSE streaming via POST with Accept: text/event-stream
    const url = `${this.baseUrl}/session/${sessionId}/message`;
    const body: Record<string, unknown> = {
      model: { providerID, modelID },
      parts: [{ type: "text", text: fullPrompt }],
      stream: true,
    };
    if (systemPrompt) body.system = systemPrompt;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (this.authHeader) headers.Authorization = this.authHeader;

    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

      if (!res.ok) {
        // Non-streaming fallback
        logger.debug("SSE not available, falling back to non-streaming");
        const result = await this.chat(model, messages);
        yield result.content;
        return;
      }

      // Read SSE stream
      const reader = res.body?.getReader();
      if (!reader) {
        yield fullPrompt; // No body reader - return the prompt as-is
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data) as { type?: string; content?: string; text?: string };
              if (parsed.type === "delta" && parsed.content) {
                yield parsed.content;
              } else if (parsed.content) {
                yield parsed.content;
              } else if (parsed.text) {
                yield parsed.text;
              }
            } catch {
              // Not JSON - treat as plain text content
              if (data) yield data;
            }
          }
        }
      }
    } catch (err) {
      logger.warn(`Streaming failed: ${err}, falling back to non-streaming`);
      const result = await this.chat(model, messages);
      yield result.content;
    }
  }

  async getProviders(): Promise<string[]> {
    const data = await this.listProviders();
    return data.all.map(p => p.id);
  }
}
