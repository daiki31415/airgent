/**
 * Token-bucket rate limiter.
 *
 * Atomicity contract:
 *   `tryConsume` is fully synchronous — it performs the read/refill/decrement
 *   critical section in a single execution slice. In single-threaded JavaScript
 *   this guarantees that two concurrent callers cannot both pass the
 *   `tokens > 0` check and exceed the limit, provided no `await` is added
 *   inside this method. Do NOT introduce `await` between the `tokens` check
 *   and the `tokens--` decrement; doing so would break the atomicity guarantee
 *   and allow callers to over-consume the bucket.
 */
export class RateLimiter {
	private tokens: number;
	private lastRefill: number;

	constructor(
		private maxTokens: number,
		private refillIntervalMs: number,
		private refillAmount: number,
	) {
		this.tokens = maxTokens;
		this.lastRefill = Date.now();
	}

	tryConsume(): boolean {
		const now = Date.now();
		const elapsed = now - this.lastRefill;
		this.tokens = Math.min(
			this.maxTokens,
			this.tokens + Math.floor(elapsed / this.refillIntervalMs) * this.refillAmount,
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
