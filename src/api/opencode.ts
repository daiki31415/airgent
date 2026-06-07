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
import { safeSplit } from "../utils/safe-split";
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
  // Each call creates a temporary session on the opencode server and deletes it
  // afterwards so airgent sessions don't pollute the opencode session list.
  //
  // PERFORMANCE NOTE: This creates/destroys a session for EVERY chat() and
  // streamChat() call. Under high load this will hammer the OpenCode server
  // with session churn (2 HTTP requests per call: create + delete).
  //
  // Consider implementing connection pooling or reusing a persistent session
  // per airgent session for production workloads. The current approach
  // prioritizes isolation and simplicity over throughput.

  private async withTempSession<T>(
    fn: (sessionId: string) => Promise<T>
  ): Promise<T> {
    const session = await this.createSession();
    try {
      return await fn(session.id);
    } finally {
      this.deleteSession(session.id).catch(err =>
        logger.warn(`Failed to clean up session ${session.id}: ${err}`)
      );
    }
  }

  private buildPromptSpec(
    model: ModelEntry,
    messages: Array<{ role: string; content: string }>
  ): { fullPrompt: string; systemPrompt: string; providerID: string; modelID: string } {
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
    const [providerPart, modelPart] = safeSplit(model.model, "/");
    if (modelPart) {
      providerID = providerPart;
      modelID = modelPart;
    } else {
      providerID = model.provider || "opencode";
      modelID = model.model;
    }

    return { fullPrompt, systemPrompt, providerID, modelID };
  }

  async chat(
    model: ModelEntry,
    messages: Array<{ role: string; content: string }>
  ): Promise<OpenCodeResponse> {
    const startTime = Date.now();
    const { fullPrompt, systemPrompt, providerID, modelID } = this.buildPromptSpec(model, messages);

    logger.debug(`chat() ${providerID}/${modelID} - ${messages.length} messages`);

    const result = await this.withTempSession(sessionId =>
      this.sendMessage(sessionId, { providerID, modelID }, fullPrompt, {
        system: systemPrompt || undefined,
      })
    );

    const elapsed = Date.now() - startTime;
    logger.debug(`Response in ${elapsed}ms`);

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
    const startTime = Date.now();
    const { fullPrompt, systemPrompt, providerID, modelID } = this.buildPromptSpec(model, messages);

    logger.debug(`streamChat() ${providerID}/${modelID} - ${messages.length} messages`);

    // Create a temporary session for this stream
    const session = await this.createSession();
    const sessionId = session.id;

    try {
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

      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

      if (!res.ok) {
        const result = await this.chat(model, messages);
        yield result.content;
        return;
      }

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        const data = await res.json() as PromptResult;
        const textContent = data.parts
          .filter(p => p.type === "text")
          .map(p => p.text || p.content || "")
          .join("\n");
        yield textContent;
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        const result = await this.chat(model, messages);
        yield result.content;
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
              if (data) yield data;
            }
          }
        }
      }

      const elapsed = Date.now() - startTime;
      logger.debug(`Stream completed in ${elapsed}ms`);
    } catch (err) {
      logger.warn(`Streaming failed: ${err}, falling back to non-streaming`);
      const result = await this.chat(model, messages);
      yield result.content;
    } finally {
      // Clean up the temporary session
      this.deleteSession(sessionId).catch(err =>
        logger.warn(`Failed to clean up session ${sessionId}: ${err}`)
      );
    }
  }

  async getProviders(): Promise<string[]> {
    const data = await this.listProviders();
    return data.all.map(p => p.id);
  }

  // ---- MCP ----

  async listMCP(): Promise<Record<string, { status: string; error?: string }>> {
    const res = await fetch(`${this.baseUrl}/mcp`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to list MCP servers: ${res.status}`);
    return res.json() as Promise<Record<string, { status: string; error?: string }>>;
  }

  async addMCP(name: string, config: Record<string, unknown>): Promise<Record<string, { status: string }>> {
    const res = await fetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ name, config }),
    });
    if (!res.ok) throw new Error(`Failed to add MCP server: ${res.status}`);
    return res.json() as Promise<Record<string, { status: string }>>;
  }

  async connectMCP(name: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/mcp/${encodeURIComponent(name)}/connect`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to connect MCP server: ${res.status}`);
  }

  async disconnectMCP(name: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/mcp/${encodeURIComponent(name)}/disconnect`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Failed to disconnect MCP server: ${res.status}`);
  }
}
