/**
 * Airgent - Entry Point
 *
 * AI Agent Framework with TUI dashboard.
 * Philosophy: "robustness over smartness"
 *
 * Usage:
 *   bun run index.ts
 *   bun run index.ts --debug     # Debug mode
 *   bun run index.ts --no-tui    # Log mode only
 */

import { Airgent } from "./src/Airgent";
import { rootLogger } from "./src/utils/logger";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--debug") || args.includes("-d")) {
    rootLogger.setDebug(true);
  }

  const agent = new Airgent();

  // Handle shutdown (SIGINT: backup for when terminal is in cooked mode)
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await agent.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await agent.stop();
    process.exit(0);
  });

  // Start the agent
  await agent.start();

  // If --no-tui, just log and wait
  if (args.includes("--no-tui")) {
    rootLogger.info("Airgent running in log mode. Press Ctrl+C to stop.");
    await new Promise(() => {}); // Hang
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
