/**
 * Tests for OpenCodeAPI (opencode.ts)
 *
 * Mocks globalThis.fetch at the HTTP boundary only.
 * Tests public behavior — no private field access.
 * MCP methods are covered in mcp.test.ts; not duplicated here.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { OpenCodeAPI } from "../opencode";

// ---- Mock infrastructure ----

const originalFetch = globalThis.fetch;

/**
 * Capture object for inspecting what was actually sent to fetch.
 * Reset before each test via resetCapture().
 */
interface FetchCapture {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: unknown;
}

let capture: FetchCapture = { url: "", method: "GET", headers: {}, body: null };

function resetCapture(): void {
	capture = { url: "", method: "GET", headers: {}, body: null };
}

/**
 * Install a simple static mock for all fetch calls.
 * Captures the first call's url/method/headers/body.
 */
function mockFetch(
	status: number,
	body: unknown,
	responseHeaders?: Record<string, string>,
): void {
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		if (!capture.url) {
			capture.url = url;
			capture.method = init?.method || "GET";
			capture.headers = Object.fromEntries(
				Object.entries((init?.headers as Record<string, string>) || {}),
			);
			capture.body = init?.body ? JSON.parse(init.body as string) : null;
		}
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => body,
			text: async () => JSON.stringify(body),
			headers: new Map(
				Object.entries(
					responseHeaders || { "content-type": "application/json" },
				),
			),
		} as unknown as Response;
	}) as typeof fetch;
}

/**
 * Install a stateful multi-call mock.
 * handlers[0] handles the 1st call, handlers[1] the 2nd, etc.
 * Extra calls return { ok: true, status: 200, json: () => true }.
 */
function mockFetchSequence(
	handlers: Array<{
		status: number;
		body: unknown;
		responseHeaders?: Record<string, string>;
	}>,
): void {
	let callIndex = 0;
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		const h = handlers[callIndex] ?? { status: 200, body: true };
		if (callIndex === 0) {
			capture.url = url;
			capture.method = init?.method || "GET";
			capture.headers = Object.fromEntries(
				Object.entries((init?.headers as Record<string, string>) || {}),
			);
			capture.body = init?.body ? JSON.parse(init.body as string) : null;
		}
		callIndex++;
		return {
			ok: h.status >= 200 && h.status < 300,
			status: h.status,
			json: async () => h.body,
			text: async () => JSON.stringify(h.body),
			headers: new Map(
				Object.entries(
					h.responseHeaders || { "content-type": "application/json" },
				),
			),
		} as unknown as Response;
	}) as typeof fetch;
}

/**
 * Helpers for the chat/streamChat sequence pattern:
 * 1. createSession  → sessionResponse
 * 2. sendMessage    → messageResponse
 * 3. deleteSession  → true (cleanup, fire-and-forget)
 */
function mockChatSequence(messageBody: unknown): void {
	mockFetchSequence([
		{ status: 200, body: { id: "tmp-sess", createdAt: "", updatedAt: "" } },
		{ status: 200, body: messageBody },
		{ status: 200, body: true },
	]);
}

afterAll(() => {
	globalThis.fetch = originalFetch;
});

beforeEach(() => {
	resetCapture();
	process.env.OPENCODE_BASE_URL = "http://test:4096";
	delete process.env.OPENCODE_SERVER_PASSWORD;
	delete process.env.OPENCODE_SERVER_USERNAME;
});

// ---- Constructor: tested via observable HTTP behavior ----

describe("OpenCodeAPI constructor", () => {
	test("uses default baseUrl when nothing configured", async () => {
		delete process.env.OPENCODE_BASE_URL;
		mockFetch(200, { healthy: true });
		const api = new OpenCodeAPI();
		await api.healthCheck();
		expect(capture.url).toContain("127.0.0.1:4096");
	});

	test("uses provided baseUrl option", async () => {
		mockFetch(200, { healthy: true });
		const api = new OpenCodeAPI({ baseUrl: "http://custom:5000" });
		await api.healthCheck();
		expect(capture.url).toContain("custom:5000");
	});

	test("strips trailing slash from baseUrl", async () => {
		mockFetch(200, { healthy: true });
		const api = new OpenCodeAPI({ baseUrl: "http://test:4096/" });
		await api.healthCheck();
		expect(capture.url).not.toMatch(/\/\/$/);
		expect(capture.url).toContain("test:4096");
	});

	test("sends Authorization header when password is configured", async () => {
		mockFetch(200, { healthy: true });
		const api = new OpenCodeAPI({ password: "mypass" });
		await api.healthCheck();
		expect(capture.headers.Authorization).toMatch(/^Basic /);
	});

	test("omits Authorization header when no password", async () => {
		mockFetch(200, { healthy: true });
		const api = new OpenCodeAPI();
		await api.healthCheck();
		expect(capture.headers.Authorization).toBeUndefined();
	});

	test("env OPENCODE_SERVER_PASSWORD is used as password", async () => {
		process.env.OPENCODE_SERVER_PASSWORD = "envpass";
		mockFetch(200, { healthy: true });
		const api = new OpenCodeAPI();
		await api.healthCheck();
		expect(capture.headers.Authorization).toMatch(/^Basic /);
	});
});

// ---- Health ----

describe("OpenCodeAPI.healthCheck", () => {
	test("returns healthy:true when server responds ok", async () => {
		mockFetch(200, { healthy: true, version: "1.0.0" });
		const api = new OpenCodeAPI();
		const result = await api.healthCheck();
		expect(result.healthy).toBe(true);
		expect(result.version).toBe("1.0.0");
	});

	test("returns healthy:false on non-ok status", async () => {
		mockFetch(500, {});
		const api = new OpenCodeAPI();
		const result = await api.healthCheck();
		expect(result.healthy).toBe(false);
	});

	test("returns healthy:false when fetch throws", async () => {
		globalThis.fetch = (async () => {
			throw new Error("ECONNREFUSED");
		}) as typeof fetch;
		const api = new OpenCodeAPI();
		const result = await api.healthCheck();
		expect(result.healthy).toBe(false);
	});
});

// ---- Sessions ----

describe("OpenCodeAPI sessions", () => {
	test("createSession sends POST and returns session", async () => {
		mockFetch(200, {
			id: "sess-1",
			createdAt: "2024-01-01",
			updatedAt: "2024-01-01",
		});
		const api = new OpenCodeAPI();
		const session = await api.createSession("test session");
		expect(session.id).toBe("sess-1");
		expect(capture.method).toBe("POST");
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

	test("getSession returns matching session", async () => {
		mockFetch(200, { id: "sess-42", createdAt: "", updatedAt: "" });
		const api = new OpenCodeAPI();
		const session = await api.getSession("sess-42");
		expect(session.id).toBe("sess-42");
	});

	test("getSession throws on non-ok", async () => {
		mockFetch(404, {});
		const api = new OpenCodeAPI();
		expect(api.getSession("ghost")).rejects.toThrow("Failed to get session");
	});

	test("deleteSession returns boolean", async () => {
		mockFetch(200, true);
		const api = new OpenCodeAPI();
		const result = await api.deleteSession("sess-1");
		expect(result).toBe(true);
	});

	test("deleteSession throws on non-ok", async () => {
		mockFetch(500, {});
		const api = new OpenCodeAPI();
		expect(api.deleteSession("bad-sess")).rejects.toThrow(
			"Failed to delete session",
		);
	});

	test("abortSession sends POST", async () => {
		mockFetch(200, true);
		const api = new OpenCodeAPI();
		await api.abortSession("sess-1");
		expect(capture.method).toBe("POST");
		expect(capture.url).toContain("/abort");
	});
});

// ---- Messages ----

describe("OpenCodeAPI messages", () => {
	test("sendMessage returns prompt result", async () => {
		mockFetch(200, {
			info: { id: "msg-1", sessionID: "sess-1", role: "assistant", parts: [] },
			parts: [{ type: "text", text: "Hello!" }],
		});
		const api = new OpenCodeAPI();
		const result = await api.sendMessage(
			"sess-1",
			{ providerID: "openai", modelID: "gpt-4" },
			"Hi",
		);
		expect(result.info.id).toBe("msg-1");
		expect(result.parts[0]?.text).toBe("Hello!");
	});

	test("sendMessage sends POST with text part", async () => {
		mockFetch(200, {
			info: { id: "m1", sessionID: "s1", role: "assistant", parts: [] },
			parts: [],
		});
		const api = new OpenCodeAPI();
		await api.sendMessage(
			"sess-1",
			{ providerID: "openai", modelID: "gpt-4" },
			"test prompt",
		);
		expect(capture.method).toBe("POST");
		expect(capture.body).toMatchObject({
			parts: [{ type: "text", text: "test prompt" }],
		});
	});

	test("sendMessage passes system option into body", async () => {
		mockFetch(200, {
			info: { id: "m1", sessionID: "s1", role: "assistant", parts: [] },
			parts: [],
		});
		const api = new OpenCodeAPI();
		await api.sendMessage(
			"s1",
			{ providerID: "openai", modelID: "gpt-4" },
			"Hi",
			{ system: "Be helpful" },
		);
		expect((capture.body as any).system).toBe("Be helpful");
	});

	test("sendMessage throws on non-ok", async () => {
		mockFetch(500, { error: "server error" });
		const api = new OpenCodeAPI();
		expect(
			api.sendMessage(
				"sess-1",
				{ providerID: "openai", modelID: "gpt-4" },
				"Hi",
			),
		).rejects.toThrow("Failed to send message");
	});

	test("listMessages returns array", async () => {
		mockFetch(200, [
			{
				info: { id: "m1", sessionID: "s1", role: "assistant", parts: [] },
				parts: [],
			},
		]);
		const api = new OpenCodeAPI();
		const msgs = await api.listMessages("sess-1");
		expect(msgs).toHaveLength(1);
	});

	test("listMessages appends limit query param when specified", async () => {
		mockFetch(200, []);
		const api = new OpenCodeAPI();
		await api.listMessages("sess-1", 10);
		expect(capture.url).toContain("limit=10");
	});
});

// ---- Providers ----

describe("OpenCodeAPI providers", () => {
	test("listProviders returns all/connected/defaults", async () => {
		mockFetch(200, {
			all: [{ id: "openai", name: "OpenAI" }],
			connected: ["openai"],
			defaults: { openai: "gpt-4" },
		});
		const api = new OpenCodeAPI();
		const result = await api.listProviders();
		expect(result.connected).toContain("openai");
		expect(result.all).toHaveLength(1);
	});

	test("getAuthMethods returns method map", async () => {
		mockFetch(200, { openai: [{ type: "api", label: "API Key" }] });
		const api = new OpenCodeAPI();
		const result = await api.getAuthMethods();
		expect(result.openai).toHaveLength(1);
	});

	test("setAuth sends PUT with API key in body", async () => {
		mockFetch(200, true);
		const api = new OpenCodeAPI();
		await api.setAuth("openai", "sk-xxx");
		expect(capture.method).toBe("PUT");
		expect((capture.body as any).key).toBe("sk-xxx");
	});

	test("getProviders returns flat array of provider IDs", async () => {
		mockFetch(200, {
			all: [{ id: "openai" }, { id: "anthropic" }],
			connected: [],
			defaults: {},
		});
		const api = new OpenCodeAPI();
		const ids = await api.getProviders();
		expect(ids).toEqual(["openai", "anthropic"]);
	});
});

// ---- chat() ----

describe("OpenCodeAPI.chat", () => {
	test("returns assistant content from response parts", async () => {
		mockChatSequence({
			info: {
				id: "msg-1",
				sessionID: "tmp-sess",
				role: "assistant",
				parts: [],
			},
			parts: [{ type: "text", text: "Hello back!" }],
		});
		const api = new OpenCodeAPI();
		const response = await api.chat({ provider: "openai", model: "gpt-4" }, [
			{ role: "user", content: "Hello" },
		]);
		expect(response.content).toBe("Hello back!");
	});

	test("model field in response reflects provider/model", async () => {
		mockChatSequence({
			info: { id: "m1", sessionID: "tmp-sess", role: "assistant", parts: [] },
			parts: [{ type: "text", text: "ok" }],
		});
		const api = new OpenCodeAPI();
		const response = await api.chat({ provider: "openai", model: "gpt-4" }, [
			{ role: "user", content: "Hi" },
		]);
		expect(response.model).toBe("openai/gpt-4");
	});

	test("includes system message as system prompt", async () => {
		mockFetchSequence([
			{ status: 200, body: { id: "sess", createdAt: "", updatedAt: "" } },
			{
				status: 200,
				body: {
					info: { id: "m1", sessionID: "sess", role: "assistant", parts: [] },
					parts: [{ type: "text", text: "ok" }],
				},
			},
			{ status: 200, body: true },
		]);
		let sentBody: unknown;
		const origFetch = globalThis.fetch;
		let call = 0;
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			call++;
			if (call === 2)
				sentBody = init?.body ? JSON.parse(init.body as string) : null;
			return origFetch(url, init);
		}) as typeof fetch;

		const api = new OpenCodeAPI();
		await api.chat({ provider: "openai", model: "gpt-4" }, [
			{ role: "system", content: "You are helpful" },
			{ role: "user", content: "Hi" },
		]);
		expect((sentBody as any)?.system).toContain("You are helpful");
	});

	test("multiple user messages: prompt contains all content", async () => {
		let sendMessageBody: unknown;
		let call = 0;
		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			call++;
			if (call === 1)
				return {
					ok: true,
					status: 200,
					json: async () => ({ id: "s", createdAt: "", updatedAt: "" }),
				} as unknown as Response;
			if (call === 2) {
				sendMessageBody = init?.body ? JSON.parse(init.body as string) : null;
				return {
					ok: true,
					status: 200,
					json: async () => ({
						info: { id: "m", sessionID: "s", role: "assistant", parts: [] },
						parts: [{ type: "text", text: "ok" }],
					}),
				} as unknown as Response;
			}
			return {
				ok: true,
				status: 200,
				json: async () => true,
			} as unknown as Response;
		}) as typeof fetch;

		const api = new OpenCodeAPI();
		await api.chat({ provider: "openai", model: "gpt-4" }, [
			{ role: "user", content: "First" },
			{ role: "user", content: "Second" },
		]);
		const text = (sendMessageBody as any)?.parts?.[0]?.text ?? "";
		expect(text).toContain("Second");
		expect(text).toContain("First");
	});

	test("model string with provider/model format is parsed correctly", async () => {
		let sendBody: unknown;
		let call = 0;
		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			call++;
			if (call === 1)
				return {
					ok: true,
					status: 200,
					json: async () => ({ id: "s", createdAt: "", updatedAt: "" }),
				} as unknown as Response;
			if (call === 2) {
				sendBody = init?.body ? JSON.parse(init.body as string) : null;
				return {
					ok: true,
					status: 200,
					json: async () => ({
						info: { id: "m", sessionID: "s", role: "assistant", parts: [] },
						parts: [{ type: "text", text: "ok" }],
					}),
				} as unknown as Response;
			}
			return {
				ok: true,
				status: 200,
				json: async () => true,
			} as unknown as Response;
		}) as typeof fetch;

		const api = new OpenCodeAPI();
		const resp = await api.chat({ provider: "", model: "anthropic/claude-3" }, [
			{ role: "user", content: "Hi" },
		]);
		expect((sendBody as any)?.model).toEqual({
			providerID: "anthropic",
			modelID: "claude-3",
		});
		expect(resp.model).toBe("anthropic/claude-3");
	});

	test("throws when no user message in input", async () => {
		const api = new OpenCodeAPI();
		expect(
			api.chat({ provider: "openai", model: "gpt-4" }, []),
		).rejects.toThrow("No user message");
	});

	test("throws when only system message provided", async () => {
		const api = new OpenCodeAPI();
		expect(
			api.chat({ provider: "openai", model: "gpt-4" }, [
				{ role: "system", content: "be nice" },
			]),
		).rejects.toThrow("No user message");
	});

	test("handles very long message content", async () => {
		const longContent = "x".repeat(10_000);
		let sentText = "";
		let call = 0;
		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			call++;
			if (call === 1)
				return {
					ok: true,
					status: 200,
					json: async () => ({ id: "s", createdAt: "", updatedAt: "" }),
				} as unknown as Response;
			if (call === 2) {
				const b = init?.body ? JSON.parse(init.body as string) : null;
				sentText = b?.parts?.[0]?.text ?? "";
				return {
					ok: true,
					status: 200,
					json: async () => ({
						info: { id: "m", sessionID: "s", role: "assistant", parts: [] },
						parts: [{ type: "text", text: "ok" }],
					}),
				} as unknown as Response;
			}
			return {
				ok: true,
				status: 200,
				json: async () => true,
			} as unknown as Response;
		}) as typeof fetch;

		const api = new OpenCodeAPI();
		await api.chat({ provider: "openai", model: "gpt-4" }, [
			{ role: "user", content: longContent },
		]);
		expect(sentText).toContain(longContent);
	});
});

// ---- streamChat() ----

describe("OpenCodeAPI.streamChat", () => {
	function makeSSEStream(events: string[]): ReadableStream {
		const encoder = new TextEncoder();
		const data = events.join("");
		let ptr = 0;
		return new ReadableStream({
			pull(controller) {
				if (ptr < data.length) {
					controller.enqueue(encoder.encode(data.slice(ptr, ptr + 20)));
					ptr += 20;
				} else {
					controller.close();
				}
			},
		});
	}

	test("yields SSE delta chunks in order", async () => {
		const stream = makeSSEStream([
			`data: ${JSON.stringify({ type: "delta", content: "Hello " })}\n\n`,
			`data: ${JSON.stringify({ type: "delta", content: "World" })}\n\n`,
			"data: [DONE]\n\n",
		]);

		let call = 0;
		globalThis.fetch = (async (_url: string) => {
			call++;
			if (call === 1)
				return {
					ok: true,
					status: 200,
					json: async () => ({ id: "s", createdAt: "", updatedAt: "" }),
				} as unknown as Response;
			if (call === 2)
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "text/event-stream"]]),
					body: stream,
				} as unknown as Response;
			return {
				ok: true,
				status: 200,
				json: async () => true,
			} as unknown as Response;
		}) as typeof fetch;

		const api = new OpenCodeAPI();
		const chunks: string[] = [];
		for await (const c of api.streamChat(
			{ provider: "openai", model: "gpt-4" },
			[{ role: "user", content: "Hi" }],
		)) {
			chunks.push(c);
		}
		expect(chunks.join("")).toBe("Hello World");
	});

	test("yields content and text SSE fields", async () => {
		const stream = makeSSEStream([
			`data: ${JSON.stringify({ content: "from content" })}\n\n`,
			`data: ${JSON.stringify({ text: "from text" })}\n\n`,
		]);

		let call = 0;
		globalThis.fetch = (async () => {
			call++;
			if (call === 1)
				return {
					ok: true,
					status: 200,
					json: async () => ({ id: "s", createdAt: "", updatedAt: "" }),
				} as unknown as Response;
			if (call === 2)
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "text/event-stream"]]),
					body: stream,
				} as unknown as Response;
			return {
				ok: true,
				status: 200,
				json: async () => true,
			} as unknown as Response;
		}) as typeof fetch;

		const api = new OpenCodeAPI();
		const chunks: string[] = [];
		for await (const c of api.streamChat(
			{ provider: "openai", model: "gpt-4" },
			[{ role: "user", content: "Hi" }],
		)) {
			chunks.push(c);
		}
		expect(chunks).toContain("from content");
		expect(chunks).toContain("from text");
	});

	test("falls back to chat() when SSE POST returns non-ok", async () => {
		let call = 0;
		globalThis.fetch = (async (_url: string, _init?: RequestInit) => {
			call++;
			// streamChat: createSession
			if (call === 1)
				return {
					ok: true,
					status: 200,
					json: async () => ({ id: "ss", createdAt: "", updatedAt: "" }),
				} as unknown as Response;
			// streamChat: POST message → fails
			if (call === 2)
				return {
					ok: false,
					status: 500,
					json: async () => ({}),
					text: async () => "{}",
					headers: new Map(),
				} as unknown as Response;
			// chat() fallback: createSession
			if (call === 3)
				return {
					ok: true,
					status: 200,
					json: async () => ({ id: "fb", createdAt: "", updatedAt: "" }),
				} as unknown as Response;
			// chat() fallback: sendMessage
			if (call === 4)
				return {
					ok: true,
					status: 200,
					json: async () => ({
						info: { id: "m", sessionID: "fb", role: "assistant", parts: [] },
						parts: [{ type: "text", text: "Fallback response" }],
					}),
				} as unknown as Response;
			return {
				ok: true,
				status: 200,
				json: async () => true,
			} as unknown as Response;
		}) as typeof fetch;

		const api = new OpenCodeAPI();
		const chunks: string[] = [];
		for await (const c of api.streamChat(
			{ provider: "openai", model: "gpt-4" },
			[{ role: "user", content: "Hi" }],
		)) {
			chunks.push(c);
		}
		expect(chunks).toContain("Fallback response");
	});

	test("falls back to chat() when response body has no readable stream", async () => {
		let call = 0;
		globalThis.fetch = (async (_url: string) => {
			call++;
			if (call === 1)
				return {
					ok: true,
					status: 200,
					json: async () => ({ id: "nr", createdAt: "", updatedAt: "" }),
				} as unknown as Response;
			if (call === 2)
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "text/event-stream"]]),
					body: null,
				} as unknown as Response;
			if (call === 3)
				return {
					ok: true,
					status: 200,
					json: async () => ({ id: "fb", createdAt: "", updatedAt: "" }),
				} as unknown as Response;
			if (call === 4)
				return {
					ok: true,
					status: 200,
					json: async () => ({
						info: { id: "m", sessionID: "fb", role: "assistant", parts: [] },
						parts: [{ type: "text", text: "No reader fallback" }],
					}),
				} as unknown as Response;
			return {
				ok: true,
				status: 200,
				json: async () => true,
			} as unknown as Response;
		}) as typeof fetch;

		const api = new OpenCodeAPI();
		const chunks: string[] = [];
		for await (const c of api.streamChat(
			{ provider: "openai", model: "gpt-4" },
			[{ role: "user", content: "Hi" }],
		)) {
			chunks.push(c);
		}
		expect(chunks).toContain("No reader fallback");
	});

	test("falls back to chat() on fetch error during streaming", async () => {
		let call = 0;
		globalThis.fetch = (async (_url: string) => {
			call++;
			if (call === 1)
				return {
					ok: true,
					status: 200,
					json: async () => ({ id: "e", createdAt: "", updatedAt: "" }),
				} as unknown as Response;
			if (call === 2) throw new Error("network failure");
			if (call === 3)
				return {
					ok: true,
					status: 200,
					json: async () => ({ id: "fb", createdAt: "", updatedAt: "" }),
				} as unknown as Response;
			if (call === 4)
				return {
					ok: true,
					status: 200,
					json: async () => ({
						info: { id: "m", sessionID: "fb", role: "assistant", parts: [] },
						parts: [{ type: "text", text: "Error fallback" }],
					}),
				} as unknown as Response;
			return {
				ok: true,
				status: 200,
				json: async () => true,
			} as unknown as Response;
		}) as typeof fetch;

		const api = new OpenCodeAPI();
		const chunks: string[] = [];
		for await (const c of api.streamChat(
			{ provider: "openai", model: "gpt-4" },
			[{ role: "user", content: "Hi" }],
		)) {
			chunks.push(c);
		}
		expect(chunks).toContain("Error fallback");
	});

	test("returns JSON body when response is not SSE content-type", async () => {
		let call = 0;
		globalThis.fetch = (async () => {
			call++;
			if (call === 1)
				return {
					ok: true,
					status: 200,
					json: async () => ({ id: "j", createdAt: "", updatedAt: "" }),
				} as unknown as Response;
			if (call === 2)
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => ({
						info: { id: "m", sessionID: "j", role: "assistant", parts: [] },
						parts: [{ type: "text", text: "JSON response from stream" }],
					}),
				} as unknown as Response;
			return {
				ok: true,
				status: 200,
				json: async () => true,
			} as unknown as Response;
		}) as typeof fetch;

		const api = new OpenCodeAPI();
		const chunks: string[] = [];
		for await (const c of api.streamChat(
			{ provider: "openai", model: "gpt-4" },
			[{ role: "user", content: "Hi" }],
		)) {
			chunks.push(c);
		}
		expect(chunks).toContain("JSON response from stream");
	});
});
