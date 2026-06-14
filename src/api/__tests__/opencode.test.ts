/**
 * Tests for OpenCodeAPI (opencode.ts)
 *
 * Mocks globalThis.fetch to avoid real network calls.
 * Covers health, session, message, provider, auth, MCP, chat, and streamChat.
 */

import { describe, expect, test, beforeAll, afterAll, mock } from "bun:test";

const originalFetch = globalThis.fetch;

// ---- Helpers ----

function mockFetch(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): void {
  globalThis.fetch = (async (_url: string, _init?: RequestInit) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
      headers: new Map(Object.entries(headers || { "content-type": "application/json" })),
    } as unknown as Response;
  }) as typeof fetch;
}

function mockFetchWithUrl(
  handler: (url: string, init?: RequestInit) => { status: number; body: unknown; headers?: Record<string, string> },
): void {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const result = handler(url, init);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.body,
      text: async () => JSON.stringify(result.body),
      headers: new Map(Object.entries(result.headers || { "content-type": "application/json" })),
    } as unknown as Response;
  }) as typeof fetch;
}

// ---- Tests ----

describe("OpenCodeAPI", () => {
  let OpenCodeAPI: typeof import("../opencode").OpenCodeAPI;

  beforeAll(async () => {
    process.env.OPENCODE_BASE_URL = "http://test:4096";
    process.env.OPENCODE_SERVER_USERNAME = "opencode";
    process.env.OPENCODE_SERVER_PASSWORD = "test-password";
    const mod = await import("../opencode");
    OpenCodeAPI = mod.OpenCodeAPI;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    delete process.env.OPENCODE_BASE_URL;
    delete process.env.OPENCODE_SERVER_USERNAME;
    delete process.env.OPENCODE_SERVER_PASSWORD;
  });

  // ---- Constructor ----

  test("constructor uses default baseUrl when no options given", () => {
    delete process.env.OPENCODE_BASE_URL;
    const api = new OpenCodeAPI();
    expect((api as any).baseUrl).toBe("http://127.0.0.1:4096");
    process.env.OPENCODE_BASE_URL = "http://test:4096";
  });

  test("constructor uses provided baseUrl", () => {
    const api = new OpenCodeAPI({ baseUrl: "http://custom:5000" });
    expect((api as any).baseUrl).toBe("http://custom:5000");
  });

  test("constructor strips trailing slash from baseUrl", () => {
    const api = new OpenCodeAPI({ baseUrl: "http://test:4096/" });
    expect((api as any).baseUrl).toBe("http://test:4096");
  });

  test("constructor sets auth header when password provided", () => {
    const api = new OpenCodeAPI({ password: "mypass" });
    const header = (api as any).authHeader;
    expect(header).toContain("Basic ");
  });

  test("constructor no auth header when no password", () => {
    delete process.env.OPENCODE_SERVER_PASSWORD;
    const api = new OpenCodeAPI();
    expect((api as any).authHeader).toBeNull();
    process.env.OPENCODE_SERVER_PASSWORD = "test-password";
  });

  // ---- Health ----

  test("healthCheck returns healthy when server responds", async () => {
    mockFetch(200, { healthy: true, version: "1.0.0" });
    const api = new OpenCodeAPI();
    const result = await api.healthCheck();
    expect(result.healthy).toBe(true);
    expect(result.version).toBe("1.0.0");
  });

  test("healthCheck returns unhealthy on non-ok response", async () => {
    mockFetch(500, {});
    const api = new OpenCodeAPI();
    const result = await api.healthCheck();
    expect(result.healthy).toBe(false);
  });

  test("healthCheck returns unhealthy on fetch error", async () => {
    globalThis.fetch = (async () => { throw new Error("network error"); }) as typeof fetch;
    const api = new OpenCodeAPI();
    const result = await api.healthCheck();
    expect(result.healthy).toBe(false);
  });

  // ---- Sessions ----

  test("createSession sends POST and returns session", async () => {
    mockFetch(200, { id: "sess-1", createdAt: "2024-01-01", updatedAt: "2024-01-01" });
    const api = new OpenCodeAPI();
    const session = await api.createSession("test session");
    expect(session.id).toBe("sess-1");
  });

  test("createSession throws on non-ok", async () => {
    mockFetch(400, {});
    const api = new OpenCodeAPI();
    expect(api.createSession()).rejects.toThrow("Failed to create session");
  });

  test("listSessions returns array", async () => {
    mockFetch(200, [{ id: "s1" }, { id: "s2" }]);
    const api = new OpenCodeAPI();
    const sessions = await api.listSessions();
    expect(sessions).toHaveLength(2);
  });

  test("getSession returns single session", async () => {
    mockFetch(200, { id: "sess-42" });
    const api = new OpenCodeAPI();
    const session = await api.getSession("sess-42");
    expect(session.id).toBe("sess-42");
  });

  test("deleteSession returns boolean", async () => {
    mockFetch(200, true);
    const api = new OpenCodeAPI();
    const result = await api.deleteSession("sess-1");
    expect(result).toBe(true);
  });

  test("abortSession sends POST", async () => {
    let methodCalled = "";
    mockFetchWithUrl((url, init) => {
      methodCalled = init?.method || "GET";
      return { status: 200, body: true };
    });
    const api = new OpenCodeAPI();
    await api.abortSession("sess-1");
    expect(methodCalled).toBe("POST");
  });

  // ---- Messages ----

  test("sendMessage returns prompt result", async () => {
    mockFetch(200, {
      info: { id: "msg-1", sessionID: "sess-1", role: "assistant", parts: [] },
      parts: [{ type: "text", text: "Hello!" }],
    });
    const api = new OpenCodeAPI();
    const result = await api.sendMessage("sess-1", { providerID: "openai", modelID: "gpt-4" }, "Hi");
    expect(result.info.id).toBe("msg-1");
    expect(result.parts[0]!.text).toBe("Hello!");
  });

  test("sendMessage throws on non-ok", async () => {
    mockFetch(500, { error: "server error" });
    const api = new OpenCodeAPI();
    expect(
      api.sendMessage("sess-1", { providerID: "openai", modelID: "gpt-4" }, "Hi"),
    ).rejects.toThrow("Failed to send message");
  });

  test("sendMessage passes system prompt option", async () => {
    let sentBody: unknown;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sentBody = init?.body ? JSON.parse(init.body as string) : null;
      return { ok: true, status: 200, json: async () => ({ info: { id: "m1", sessionID: "s1", role: "assistant", parts: [] }, parts: [] }) } as unknown as Response;
    }) as typeof fetch;

    const api = new OpenCodeAPI();
    await api.sendMessage("sess-1", { providerID: "openai", modelID: "gpt-4" }, "Hi", { system: "Be helpful" });
    expect((sentBody as any).system).toBe("Be helpful");
  });

  test("listMessages returns array of messages", async () => {
    mockFetch(200, [{ info: { id: "m1", sessionID: "s1", role: "assistant", parts: [] }, parts: [] }]);
    const api = new OpenCodeAPI();
    const msgs = await api.listMessages("sess-1");
    expect(msgs).toHaveLength(1);
  });

  test("listMessages with limit appends query param", async () => {
    let calledUrl = "";
    globalThis.fetch = (async (url: string) => {
      calledUrl = url;
      return { ok: true, status: 200, json: async () => [] } as unknown as Response;
    }) as typeof fetch;

    const api = new OpenCodeAPI();
    await api.listMessages("sess-1", 10);
    expect(calledUrl).toContain("limit=10");
  });

  // ---- Providers ----

  test("listProviders returns provider data", async () => {
    mockFetch(200, { all: [{ id: "openai", name: "OpenAI" }], connected: ["openai"], defaults: { openai: "gpt-4" } });
    const api = new OpenCodeAPI();
    const result = await api.listProviders();
    expect(result.connected).toContain("openai");
  });

  test("getAuthMethods returns auth methods", async () => {
    mockFetch(200, { openai: [{ type: "api", label: "API Key" }] });
    const api = new OpenCodeAPI();
    const result = await api.getAuthMethods();
    expect(result.openai).toHaveLength(1);
  });

  test("setAuth sends PUT with API key", async () => {
    let sentMethod = "";
    let sentBody: unknown;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sentMethod = init?.method || "GET";
      sentBody = init?.body ? JSON.parse(init.body as string) : null;
      return { ok: true, status: 200, json: async () => true } as unknown as Response;
    }) as typeof fetch;

    const api = new OpenCodeAPI();
    await api.setAuth("openai", "sk-xxx");
    expect(sentMethod).toBe("PUT");
    expect((sentBody as any).key).toBe("sk-xxx");
  });

  // ---- getProviders ----

  test("getProviders returns provider IDs", async () => {
    mockFetch(200, { all: [{ id: "openai" }, { id: "anthropic" }], connected: [], defaults: {} });
    const api = new OpenCodeAPI();
    const ids = await api.getProviders();
    expect(ids).toEqual(["openai", "anthropic"]);
  });

  // ---- MCP methods (already tested in mcp.test.ts, adding a couple more) ----

  test("listMCP returns server status map", async () => {
    mockFetch(200, { "server-a": { status: "connected" } });
    const api = new OpenCodeAPI();
    const result = await api.listMCP();
    expect(result["server-a"]!.status).toBe("connected");
    expect(Object.keys(result)).toHaveLength(1);
  });

  test("addMCP sends POST with config", async () => {
    let sentMethod = "";
    let sentBody: unknown;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sentMethod = init?.method || "GET";
      sentBody = init?.body ? JSON.parse(init.body as string) : null;
      return { ok: true, status: 200, json: async () => ({ "new-server": { status: "added" } }) } as unknown as Response;
    }) as typeof fetch;

    const api = new OpenCodeAPI();
    await api.addMCP("new-server", { type: "local", command: ["node", "server.js"], enabled: true });
    expect(sentMethod).toBe("POST");
    expect((sentBody as any).name).toBe("new-server");
  });

  // ---- Chat ----

  test("chat with single user message returns content", async () => {
    // chat() creates temp session, sends message, returns content
    let callCount = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        // createSession
        return { ok: true, status: 200, json: async () => ({ id: "tmp-sess", createdAt: "", updatedAt: "" }) } as unknown as Response;
      }
      if (callCount === 2) {
        // sendMessage
        return {
          ok: true, status: 200,
          json: async () => ({
            info: { id: "msg-1", sessionID: "tmp-sess", role: "assistant", parts: [{ type: "text", text: "Hello back!" }] },
            parts: [{ type: "text", text: "Hello back!" }],
          }),
        } as unknown as Response;
      }
      // deleteSession (cleanup)
      return { ok: true, status: 200, json: async () => true } as unknown as Response;
    }) as typeof fetch;

    const api = new OpenCodeAPI();
    const response = await api.chat(
      { provider: "openai", model: "gpt-4" },
      [{ role: "user", content: "Hello" }],
    );
    expect(response.content).toBe("Hello back!");
    expect(response.model).toBe("openai/gpt-4");
    expect(response.id).toBeDefined();
  });

  test("chat with system messages includes system prompt", async () => {
    let sentBody: unknown;
    let callCount = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, status: 200, json: async () => ({ id: "tmp-sess", createdAt: "", updatedAt: "" }) } as unknown as Response;
      }
      if (callCount === 2) {
        sentBody = init?.body ? JSON.parse(init.body as string) : null;
        return {
          ok: true, status: 200,
          json: async () => ({
            info: { id: "m1", sessionID: "tmp-sess", role: "assistant", parts: [{ type: "text", text: "ok" }] },
            parts: [{ type: "text", text: "ok" }],
          }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => true } as unknown as Response;
    }) as typeof fetch;

    const api = new OpenCodeAPI();
    await api.chat(
      { provider: "openai", model: "gpt-4" },
      [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Hi" },
      ],
    );
    // The system prompt should be in the sent body
    expect((sentBody as any)?.system).toContain("You are helpful");
  });

  test("chat with multiple user messages includes context", async () => {
    let sentBody: unknown;
    let callCount = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, status: 200, json: async () => ({ id: "tmp-sess", createdAt: "", updatedAt: "" }) } as unknown as Response;
      }
      if (callCount === 2) {
        sentBody = init?.body ? JSON.parse(init.body as string) : null;
        return {
          ok: true, status: 200,
          json: async () => ({
            info: { id: "m1", sessionID: "tmp-sess", role: "assistant", parts: [{ type: "text", text: "ok" }] },
            parts: [{ type: "text", text: "ok" }],
          }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => true } as unknown as Response;
    }) as typeof fetch;

    const api = new OpenCodeAPI();
    await api.chat(
      { provider: "openai", model: "gpt-4" },
      [
        { role: "user", content: "First" },
        { role: "user", content: "Second" },
      ],
    );
    const parts = (sentBody as any)?.parts;
    expect(parts).toBeDefined();
    // The full prompt should contain previous context
    const text = parts[0]?.text || "";
    expect(text).toContain("Second");
  });

  test("chat throws when no user message", async () => {
    const api = new OpenCodeAPI();
    expect(
      api.chat({ provider: "openai", model: "gpt-4" }, [{ role: "system", content: "be nice" }]),
    ).rejects.toThrow("No user message");
  });

  // ---- Legacy model format with slash ----

  test("chat handles model with provider/model format", async () => {
    let callCount = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, status: 200, json: async () => ({ id: "tmp-sess", createdAt: "", updatedAt: "" }) } as unknown as Response;
      }
      if (callCount === 2) {
        const body = init?.body ? JSON.parse(init.body as string) : null;
        return {
          ok: true, status: 200,
          json: async () => ({
            info: { id: "m1", sessionID: "tmp-sess", role: "assistant", parts: [{ type: "text", text: `from ${body?.model?.providerID}/${body?.model?.modelID}` }] },
            parts: [{ type: "text", text: `from ${body?.model?.providerID}/${body?.model?.modelID}` }],
          }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => true } as unknown as Response;
    }) as typeof fetch;

    const api = new OpenCodeAPI();
    const resp = await api.chat(
      { provider: "", model: "anthropic/claude-3" },
      [{ role: "user", content: "Hi" }],
    );
    expect(resp.model).toBe("anthropic/claude-3");
  });

  // ---- streamChat ----

  test("streamChat yields content via read() stream", async () => {
    // Mock a readable stream for SSE
    const encoder = new TextEncoder();
    const streamData = [
      "data: " + JSON.stringify({ type: "delta", content: "Hello " }) + "\n\n",
      "data: " + JSON.stringify({ type: "delta", content: "World" }) + "\n\n",
      "data: [DONE]\n\n",
    ].join("");

    let callCount = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        // createSession
        return { ok: true, status: 200, json: async () => ({ id: "stream-sess", createdAt: "", updatedAt: "" }) } as unknown as Response;
      }
      if (callCount === 2) {
        // POST with stream
        let readPointer = 0;
        const stream = new ReadableStream({
          pull(controller) {
            if (readPointer < streamData.length) {
              const chunk = streamData.slice(readPointer, readPointer + 20);
              readPointer += 20;
              controller.enqueue(encoder.encode(chunk));
            } else {
              controller.close();
            }
          },
        });
        return {
          ok: true, status: 200,
          headers: new Map(Object.entries({ "content-type": "text/event-stream" })),
          body: stream,
        } as unknown as Response;
      }
      // deleteSession (cleanup) - final call
      return { ok: true, status: 200, json: async () => true } as unknown as Response;
    }) as typeof fetch;

    const api = new OpenCodeAPI();
    const chunks: string[] = [];
    for await (const chunk of api.streamChat(
      { provider: "openai", model: "gpt-4" },
      [{ role: "user", content: "Hi" }],
    )) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(2);
    expect(chunks.join("")).toBe("Hello World");
  });

  test("streamChat falls back to chat when SSE fails", async () => {
    let callCount = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        // createSession in streamChat
        return { ok: true, status: 200, json: async () => ({ id: "fs-sess", createdAt: "", updatedAt: "" }) } as unknown as Response;
      }
      if (callCount === 2) {
        // POST message in streamChat - returns non-ok
        return { ok: false, status: 500, json: async () => ({}), text: async () => "{}", headers: new Map() } as unknown as Response;
      }
      if (callCount === 3) {
        // createSession in chat()->withTempSession fallback
        return { ok: true, status: 200, json: async () => ({ id: "fb-sess", createdAt: "", updatedAt: "" }) } as unknown as Response;
      }
      if (callCount === 4) {
        // sendMessage in chat()->withTempSession fallback
        return {
          ok: true, status: 200,
          json: async () => ({
            info: { id: "m-fb", sessionID: "fb-sess", role: "assistant", parts: [] },
            parts: [{ type: "text", text: "Fallback response" }],
          }),
        } as unknown as Response;
      }
      // deleteSession cleanup calls
      return { ok: true, status: 200, json: async () => true } as unknown as Response;
    }) as typeof fetch;

    const api = new OpenCodeAPI();
    const chunks: string[] = [];
    for await (const chunk of api.streamChat(
      { provider: "openai", model: "gpt-4" },
      [{ role: "user", content: "Hi" }],
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toContain("Fallback response");
  });

  test("streamChat falls back to chat when body has no reader", async () => {
    let callCount = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, status: 200, json: async () => ({ id: "nr-sess", createdAt: "", updatedAt: "" }) } as unknown as Response;
      }
      if (callCount === 2) {
        // body is null - will fall back to chat
        return {
          ok: true, status: 200,
          headers: new Map(Object.entries({ "content-type": "text/event-stream" })),
          body: null,
        } as unknown as Response;
      }
      if (callCount === 3) {
        return { ok: true, status: 200, json: async () => ({ id: "fb-sess", createdAt: "", updatedAt: "" }) } as unknown as Response;
      }
      if (callCount === 4) {
        return {
          ok: true, status: 200,
          json: async () => ({
            info: { id: "m-fb", sessionID: "fb-sess", role: "assistant", parts: [] },
            parts: [{ type: "text", text: "No reader fallback" }],
          }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => true } as unknown as Response;
    }) as typeof fetch;

    const api = new OpenCodeAPI();
    const chunks: string[] = [];
    for await (const chunk of api.streamChat(
      { provider: "openai", model: "gpt-4" },
      [{ role: "user", content: "Hi" }],
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toContain("No reader fallback");
  });

  test("streamChat error triggers fallback", async () => {
    let callCount = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, status: 200, json: async () => ({ id: "err-sess", createdAt: "", updatedAt: "" }) } as unknown as Response;
      }
      if (callCount === 2) {
        throw new Error("network failure");
      }
      if (callCount === 3) {
        return { ok: true, status: 200, json: async () => ({ id: "fb-sess", createdAt: "", updatedAt: "" }) } as unknown as Response;
      }
      if (callCount === 4) {
        return {
          ok: true, status: 200,
          json: async () => ({
            info: { id: "m-fb", sessionID: "fb-sess", role: "assistant", parts: [] },
            parts: [{ type: "text", text: "Error fallback" }],
          }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => true } as unknown as Response;
    }) as typeof fetch;

    const api = new OpenCodeAPI();
    const chunks: string[] = [];
    for await (const chunk of api.streamChat(
      { provider: "openai", model: "gpt-4" },
      [{ role: "user", content: "Hi" }],
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toContain("Error fallback");
  });

  test("streamChat with non-SSE content-type returns json body", async () => {
    let callCount = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, status: 200, json: async () => ({ id: "json-sess", createdAt: "", updatedAt: "" }) } as unknown as Response;
      }
      if (callCount === 2) {
        // JSON response (non-SSE content type)
        return {
          ok: true, status: 200,
          headers: new Map(Object.entries({ "content-type": "application/json" })),
          json: async () => ({
            info: { id: "m-json", sessionID: "json-sess", role: "assistant", parts: [] },
            parts: [{ type: "text", text: "JSON response from stream" }],
          }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => true } as unknown as Response;
    }) as typeof fetch;

    const api = new OpenCodeAPI();
    const chunks: string[] = [];
    for await (const chunk of api.streamChat(
      { provider: "openai", model: "gpt-4" },
      [{ role: "user", content: "Hi" }],
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toContain("JSON response from stream");
  });

  test("streamChat with SSE json text field", async () => {
    const encoder = new TextEncoder();
    const streamData = [
      "data: " + JSON.stringify({ content: "From content field" }) + "\n\n",
      "data: " + JSON.stringify({ text: "From text field" }) + "\n\n",
      "data: [DONE]\n\n",
    ].join("");

    let callCount = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, status: 200, json: async () => ({ id: "st-sess", createdAt: "", updatedAt: "" }) } as unknown as Response;
      }
      if (callCount === 2) {
        let readPtr = 0;
        const stream = new ReadableStream({
          pull(controller) {
            if (readPtr < streamData.length) {
              const chunk = streamData.slice(readPtr, readPtr + 30);
              readPtr += 30;
              controller.enqueue(encoder.encode(chunk));
            } else {
              controller.close();
            }
          },
        });
        return {
          ok: true, status: 200,
          headers: new Map(Object.entries({ "content-type": "text/event-stream" })),
          body: stream,
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => true } as unknown as Response;
    }) as typeof fetch;

    const api = new OpenCodeAPI();
    const chunks: string[] = [];
    for await (const chunk of api.streamChat(
      { provider: "openai", model: "gpt-4" },
      [{ role: "user", content: "Hi" }],
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toContain("From content field");
    expect(chunks).toContain("From text field");
  });

  // ---- Edge cases ----

  test("empty messages array throws", async () => {
    const api = new OpenCodeAPI();
    expect(
      api.chat({ provider: "openai", model: "gpt-4" }, []),
    ).rejects.toThrow("No user message");
  });

  test("very long message content in chat", async () => {
    const longMsg = "Hello " + "x".repeat(10_000);
    let sentText = "";
    let callCount = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, status: 200, json: async () => ({ id: "long-sess", createdAt: "", updatedAt: "" }) } as unknown as Response;
      }
      if (callCount === 2) {
        const body = init?.body ? JSON.parse(init.body as string) : null;
        sentText = body?.parts?.[0]?.text || "";
        return {
          ok: true, status: 200,
          json: async () => ({
            info: { id: "m1", sessionID: "long-sess", role: "assistant", parts: [{ type: "text", text: "Long response" }] },
            parts: [{ type: "text", text: "Long response" }],
          }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => true } as unknown as Response;
    }) as typeof fetch;

    const api = new OpenCodeAPI();
    await api.chat({ provider: "openai", model: "gpt-4" }, [{ role: "user", content: longMsg }]);
    expect(sentText).toContain(longMsg);
  });

  test("getSession throws on non-ok", async () => {
    mockFetch(404, {});
    const api = new OpenCodeAPI();
    expect(api.getSession("ghost")).rejects.toThrow("Failed to get session");
  });

  test("deleteSession throws on non-ok", async () => {
    mockFetch(500, {});
    const api = new OpenCodeAPI();
    expect(api.deleteSession("bad-sess")).rejects.toThrow("Failed to delete session");
  });
});
