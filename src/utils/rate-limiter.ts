export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number,
    private refillIntervalMs: number,
    private refillAmount: number
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  tryConsume(): boolean {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + Math.floor(elapsed / this.refillIntervalMs) * this.refillAmount
    );
    this.lastRefill = now;
    if (this.tokens <= 0) return false;
    this.tokens--;
    return true;
  }

  get currentTokens(): number {
    return this.tokens;
  }
}
