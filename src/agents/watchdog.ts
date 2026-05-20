/**
 * Watchdog Agent
 *
 * Responsibility: Agent runaway prevention.
 * Monitors failures, tokens, retries, and context drift.
 */

import { BaseAgent } from "./base";
import type { ModelEntry, WatchdogAction } from "../types";

export class WatchdogAgent extends BaseAgent {
  private consecutiveFailures = new Map<string, number>();
  private tokenUsage: number[] = [];
  private retryCounts = new Map<string, number>();
  private contextDriftScore = 0;

  constructor(
    model: import("../types").ModelEntry,
    api: import("../api/opencode").OpenCodeAPI
  ) {
    super("watchdog", model, api);
  }

  check(context: {
    failures?: Record<string, number>;
    currentTokens?: number;
    retries?: Record<string, number>;
    currentContext?: string;
    previousContext?: string;
  }): { healthy: boolean; actions: WatchdogAction[] } {
    const actions: WatchdogAction[] = [];

    if (context?.failures) {
      for (const [key, count] of Object.entries(context.failures)) {
        this.consecutiveFailures.set(key, count);
      }
    }
    const stopAction = this.checkFailureThreshold();
    if (stopAction) actions.push(stopAction);

    if (context?.currentTokens !== undefined) {
      this.tokenUsage.push(context.currentTokens);
      if (this.tokenUsage.length > 10) this.tokenUsage.shift();
    }
    const tokenAction = this.checkTokenSurge();
    if (tokenAction) actions.push(tokenAction);

    if (context?.retries) {
      for (const [key, count] of Object.entries(context.retries)) {
        this.retryCounts.set(key, count);
      }
    }
    const retryAction = this.checkRetryThreshold();
    if (retryAction) actions.push(retryAction);

    if (context?.currentContext && context?.previousContext) {
      this.contextDriftScore = this.calculateDrift(context.currentContext, context.previousContext);
    }
    const driftAction = this.checkContextDrift();
    if (driftAction) actions.push(driftAction);

    if (actions.length > 0) {
      this.logger.info(`Watchdog: ${actions.map(a => a.type).join(", ")}`);
    }

    return { healthy: actions.length === 0, actions };
  }

  private checkFailureThreshold(): WatchdogAction | null {
    for (const [key, count] of this.consecutiveFailures) {
      if (count >= 3) return { type: "force_stop", reason: `${key} failed ${count}x` };
    }
    return null;
  }

  private checkTokenSurge(): WatchdogAction | null {
    if (this.tokenUsage.length < 4) return null;
    const recent = this.tokenUsage.slice(-3);
    const priorCount = this.tokenUsage.length - 3;
    const prior = this.tokenUsage.slice(0, -3);
    const avg = prior.reduce((a, b) => a + b, 0) / priorCount;
    const recentAvg = recent.reduce((a, b) => a + b, 0) / 3;
    if (recentAvg > avg * 1.5 && avg > 0) {
      return { type: "warning", message: `Token surge: ${Math.round(recentAvg)} vs avg ${Math.round(avg)}` };
    }
    return null;
  }

  private checkRetryThreshold(): WatchdogAction | null {
    for (const [key, count] of this.retryCounts) {
      if (count >= 5) {
        return {
          type: "model_switch",
          reason: `${key} retried ${count}x`,
          model: { provider: "opencode", model: "fallback" },
        };
      }
    }
    return null;
  }

  private checkContextDrift(): WatchdogAction | null {
    if (this.contextDriftScore > 0.7) {
      return { type: "compress_suggest", reason: `Drift: ${this.contextDriftScore.toFixed(2)}` };
    }
    return null;
  }

  private calculateDrift(current: string, previous: string): number {
    const curr = new Set(current.toLowerCase().split(/\s+/));
    const prev = new Set(previous.toLowerCase().split(/\s+/));
    if (prev.size === 0) return 0;
    const intersection = new Set([...curr].filter(w => prev.has(w)));
    const jaccard = intersection.size / (curr.size + prev.size - intersection.size);
    return 1 - jaccard;
  }

  reset(): void {
    this.consecutiveFailures.clear();
    this.tokenUsage = [];
    this.retryCounts.clear();
    this.contextDriftScore = 0;
  }
}
