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

  test("handles negative maxTokens", () => {
    const rl = new RateLimiter(-1, 1000, 5);
    expect(rl.tryConsume()).toBe(false); // tokens starts at -1, always <= 0
  });

  test("does not overflow beyond maxTokens on rapid refill cycles", async () => {
    const rl = new RateLimiter(3, 10, 10);
    for (let i = 0; i < 3; i++) rl.tryConsume();
    expect(rl.tryConsume()).toBe(false);
    await new Promise(r => setTimeout(r, 30));
    expect(rl.currentTokens).toBeLessThanOrEqual(3);
  });

  test("lazy refill on first consume after long idle", async () => {
    const rl = new RateLimiter(5, 50, 2);
    rl.tryConsume();
    rl.tryConsume();
    expect(rl.currentTokens).toBe(3);
    await new Promise(r => setTimeout(r, 200));
    rl.tryConsume(); // triggers lazy refill
    // Should have 1 consumed, rest refilled and capped
    expect(rl.currentTokens).toBeLessThanOrEqual(4);
    expect(rl.currentTokens).toBeGreaterThanOrEqual(0);
  });

  test("currentTokens never exceeds maxTokens", async () => {
    const rl = new RateLimiter(2, 20, 5);
    await new Promise(r => setTimeout(r, 100));
    // After idle, lazy refill would happen on consume, but currentTokens just tracks
    expect(rl.currentTokens).toBeLessThanOrEqual(2);
  });

  test("constructor validates positive maxTokens", () => {
    const rl = new RateLimiter(10, 1000, 5);
    expect(rl.currentTokens).toBe(10);
  });

  test("constructor handles very large maxTokens", () => {
    const rl = new RateLimiter(1_000_000, 1000, 100_000);
    expect(rl.currentTokens).toBe(1_000_000);
  });

  test("constructor handles zero refillAmount", () => {
    const rl = new RateLimiter(5, 1000, 0);
    expect(rl.currentTokens).toBe(5);
    rl.tryConsume();
    expect(rl.currentTokens).toBe(4);
  });

  test("rapid sequential consumption drains tokens", () => {
    const rl = new RateLimiter(3, 10000, 1);
    expect(rl.tryConsume()).toBe(true);  // 2 left
    expect(rl.tryConsume()).toBe(true);  // 1 left
    expect(rl.tryConsume()).toBe(true);  // 0 left
    expect(rl.tryConsume()).toBe(false); // blocked
    expect(rl.currentTokens).toBe(0);
  });

  test("exact time boundary for refill", async () => {
    const rl = new RateLimiter(1, 100, 1);
    rl.tryConsume(); // use the only token
    expect(rl.tryConsume()).toBe(false);

    // Wait exactly the refill interval
    await new Promise(r => setTimeout(r, 100));
    // Lazy refill: next consume should succeed
    expect(rl.tryConsume()).toBe(true);
  });

  test("multiple refill intervals accumulate partial refills", async () => {
    const rl = new RateLimiter(10, 50, 2);
    // Drain all tokens
    for (let i = 0; i < 10; i++) rl.tryConsume();
    expect(rl.tryConsume()).toBe(false);

    // Wait enough for several refills
    await new Promise(r => setTimeout(r, 160));
    // Should refill ~3 intervals = 6 tokens, but only consume 1 on this call
    const before = rl.currentTokens;
    const ok = rl.tryConsume();
    // after consume: should have consumed 1, so total should be refilled - 1
    expect(ok).toBe(true);
    expect(rl.currentTokens).toBeGreaterThanOrEqual(0);
    expect(rl.currentTokens).toBeLessThanOrEqual(10);
  });

  test("tryConsume with no time elapsed does not refill", () => {
    const rl = new RateLimiter(3, 1000, 10);
    rl.tryConsume(); // tokens: 2, lastRefill updated
    rl.tryConsume(); // tokens: 1
    rl.tryConsume(); // tokens: 0
    expect(rl.tryConsume()).toBe(false); // no refill, no tokens
  });

  test("large refillAmount capped by maxTokens", async () => {
    const rl = new RateLimiter(5, 50, 100);
    rl.tryConsume(); // tokens: 4
    await new Promise(r => setTimeout(r, 60));
    // Refill would add 100 but capped at 5
    const before = rl.currentTokens;
    rl.tryConsume(); // lazy refill + consume
    // After refill capped at 5, then consume 1 => should be 4
    expect(rl.currentTokens).toBeLessThanOrEqual(4);
  });

  test("non-integer refill intervals handled via floor", async () => {
    const rl = new RateLimiter(3, 100, 1);
    rl.tryConsume(); rl.tryConsume(); rl.tryConsume();
    expect(rl.tryConsume()).toBe(false);

    // Wait 150ms — 1 full interval (100ms) + 50ms partial (floor = 1 refill)
    await new Promise(r => setTimeout(r, 150));
    expect(rl.tryConsume()).toBe(true); // refilled 1, consumed 1
  });

  test("edge: maxTokens set to 1", () => {
    const rl = new RateLimiter(1, 1000, 1);
    expect(rl.tryConsume()).toBe(true);
    expect(rl.tryConsume()).toBe(false);
  });

  test("edge: refillAmount greater than maxTokens", () => {
    const rl = new RateLimiter(3, 500, 10);
    expect(rl.currentTokens).toBe(3);
    rl.tryConsume();
    expect(rl.currentTokens).toBe(2);
  });

  test("atomicity: interleaved calls never exceed maxTokens", async () => {
    const rl = new RateLimiter(10, 1_000_000, 0);
    let consumed = 0;
    const tasks = Array.from({ length: 100 }, () =>
      Promise.resolve().then(() => {
        if (rl.tryConsume()) consumed++;
      })
    );
    await Promise.all(tasks);
    expect(consumed).toBe(10);
    expect(rl.currentTokens).toBe(0);
  });
});
