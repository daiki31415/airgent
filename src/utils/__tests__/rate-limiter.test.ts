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

  test("consumes all burst tokens then blocks", () => {
    const rl = new RateLimiter(3, 10000, 10);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(false);
    expect(rl.currentTokens).toBe(0);
  });

  test("partial refill restores some tokens", async () => {
    const rl = new RateLimiter(5, 100, 3);
    for (let i = 0; i < 5; i++) rl.tryConsume();
    expect(rl.tryConsume()).toBe(false);

    await new Promise(r => setTimeout(r, 110));
    expect(rl.currentTokens).toBe(0); // refill is lazy — happens on tryConsume call
    expect(rl.tryConsume()).toBe(true); // refill + consume
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(false); // 3 refilled tokens consumed
  });

  test("multiple refill cycles accumulate up to maxTokens", async () => {
    const rl = new RateLimiter(5, 50, 2);
    for (let i = 0; i < 5; i++) rl.tryConsume();
    expect(rl.tryConsume()).toBe(false);

    await new Promise(r => setTimeout(r, 210));
    // tryConsume triggers lazy refill — ~4 refill cycles * 2 = 8, capped at 5
    expect(rl.tryConsume()).toBe(true); // refill + consume
    expect(rl.currentTokens).toBeLessThanOrEqual(5);
  });

  test("does not refill before interval elapses", async () => {
    const rl = new RateLimiter(1, 200, 1);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(false);

    await new Promise(r => setTimeout(r, 100));
    expect(rl.currentTokens).toBe(0);
  });

  test("handles zero maxTokens", () => {
    const rl = new RateLimiter(0, 1000, 5);
    expect(rl.tryConsume()).toBe(false);
    expect(rl.currentTokens).toBe(0);
  });
});
