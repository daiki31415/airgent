import { describe, expect, test } from "bun:test";
import { RateLimiter } from "../rate-limiter";

describe("RateLimiter", () => {
  test("allows initial consumption", () => {
    const rl = new RateLimiter(5, 1000, 5);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.currentTokens).toBe(4);
  });

  test("blocks when tokens run out", () => {
    const rl = new RateLimiter(2, 10000, 0);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(false);
  });

  test("refills tokens over time", async () => {
    const rl = new RateLimiter(2, 50, 2);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(false);

    await new Promise(r => setTimeout(r, 60));
    expect(rl.tryConsume()).toBe(true);
  });

  test("does not exceed maxTokens on refill", async () => {
    const rl = new RateLimiter(5, 50, 10);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.currentTokens).toBe(4);

    await new Promise(r => setTimeout(r, 60));
    expect(rl.currentTokens).toBeLessThanOrEqual(5);
    expect(rl.tryConsume()).toBe(true);
  });

  test("handles zero refill amount", () => {
    const rl = new RateLimiter(1, 1000, 0);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(false);
    expect(rl.tryConsume()).toBe(false);
  });
});
