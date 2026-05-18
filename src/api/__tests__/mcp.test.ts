import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { OpenCodeAPI } from "../opencode";

const originalFetch = globalThis.fetch;

function mockFetch(status: number, body: unknown, headers?: Record<string, string>): void {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
      headers: new Map(Object.entries(headers || { "content-type": "application/json" })),
    } as unknown as Response;
  }) as typeof fetch;
}

describe("OpenCodeAPI MCP", () => {
  let api: OpenCodeAPI;

  beforeAll(() => {
    process.env.OPENCODE_BASE_URL = "http://test:4096";
    api = new OpenCodeAPI();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    delete process.env.OPENCODE_BASE_URL;
  });

  test("listMCP returns server status map", async () => {
    mockFetch(200, { "playwright": { status: "connected" }, "server-a": { status: "added" } });
    const result = await api.listMCP();
    expect(result["playwright"]!.status).toBe("connected");
    expect(result["server-a"]!.status).toBe("added");
  });

  test("listMCP throws on non-ok response", async () => {
    mockFetch(500, {});
    expect(api.listMCP()).rejects.toThrow("Failed to list MCP servers");
  });

  test("addMCP sends local server config", async () => {
    let sentBody: unknown;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      sentBody = init?.body ? JSON.parse(init.body as string) : null;
      return { ok: true, status: 200, json: async () => ({ "my-server": { status: "added" } }) } as unknown as Response;
    }) as typeof fetch;

    const result = await api.addMCP("my-server", { type: "local", command: ["npx", "serve"], enabled: true });
    expect(sentBody).toEqual({ name: "my-server", config: { type: "local", command: ["npx", "serve"], enabled: true } });
    expect(result["my-server"]!.status).toBe("added");
  });

  test("addMCP throws on non-ok", async () => {
    mockFetch(400, { error: "bad request" });
    expect(api.addMCP("bad", { type: "local", command: ["bad"], enabled: true })).rejects.toThrow("Failed to add MCP server");
  });

  test("addMCP sends remote server config", async () => {
    let sentBody: unknown;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      sentBody = init?.body ? JSON.parse(init.body as string) : null;
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;

    await api.addMCP("remote-srv", { type: "remote", url: "https://mcp.example.com", enabled: true });
    expect((sentBody as any).config.url).toBe("https://mcp.example.com");
  });

  test("connectMCP sends POST and returns void on success", async () => {
    let calledUrl = "";
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calledUrl = url;
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;

    await api.connectMCP("playwright");
    expect(calledUrl).toContain("/mcp/playwright/connect");
  });

  test("connectMCP throws on non-ok", async () => {
    mockFetch(404, {});
    expect(api.connectMCP("nonexistent")).rejects.toThrow("Failed to connect MCP server");
  });

  test("disconnectMCP sends POST and returns void on success", async () => {
    let calledUrl = "";
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calledUrl = url;
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;

    await api.disconnectMCP("playwright");
    expect(calledUrl).toContain("/mcp/playwright/disconnect");
  });

  test("disconnectMCP throws on non-ok", async () => {
    mockFetch(500, {});
    expect(api.disconnectMCP("broken")).rejects.toThrow("Failed to disconnect MCP server");
  });

  test("listMCP returns empty object for no servers", async () => {
    mockFetch(200, {});
    const result = await api.listMCP();
    expect(Object.keys(result)).toHaveLength(0);
  });

  test("URL-encodes MCP server name in connect/disconnect", async () => {
    let calledUrl = "";
    globalThis.fetch = (async (url: string) => {
      calledUrl = url;
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;

    await api.connectMCP("my server");
    expect(calledUrl).toContain("/mcp/my%20server/connect");
  });
});
