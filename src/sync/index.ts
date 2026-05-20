import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { CompressedEntry } from "../types";
import { Storage } from "../storage";
import { rootLogger } from "../utils/logger";

const DEFAULT_SYNC_DIR = join(homedir(), ".config", "Airgent", "sync");
const GITIGNORE = ["*.db", "raw/", "*.log"].join("\n") + "\n";

export class DeviceSync {
  private storage: Storage;
  private syncDir: string;
  private remoteUrl: string | null = null;
  private logger = rootLogger.child("sync");
  private get exportFile(): string {
    return join(this.syncDir, "export.json");
  }

  constructor(storage: Storage, syncDir?: string) {
    this.storage = storage;
    this.syncDir = syncDir ?? DEFAULT_SYNC_DIR;
    if (!existsSync(this.syncDir)) mkdirSync(this.syncDir, { recursive: true });
  }

  initGit(remoteUrl: string): void {
    this.remoteUrl = remoteUrl;
    this.logger.info(`Initializing git in ${this.syncDir}`);

    const gitignorePath = join(this.syncDir, ".gitignore");
    if (!existsSync(gitignorePath)) writeFileSync(gitignorePath, GITIGNORE);

    if (!existsSync(join(this.syncDir, ".git"))) {
      this.git(["init"]);
      this.git(["remote", "add", "origin", remoteUrl]);
    } else {
      this.git(["remote", "set-url", "origin", remoteUrl]);
    }

    this.logger.info("Git sync initialized");
  }

  push(): void {
    this.exportData();
    this.git(["add", "."]);
    this.git(["commit", "-m", `Sync ${new Date().toISOString()}`]);
    this.git(["push", "origin", "main"]);
    this.logger.info("Push complete");
  }

  pull(): void {
    this.git(["pull", "origin", "main"]);
    this.importData();
    this.logger.info("Pull complete");
  }

  private exportData(): void {
    const compressed = this.storage.getAllCompressed();
    const metadata = this.storage.getAllMetadata();
    const sessions = this.storage.getRecentSessions(50);

    const data = { compressed, metadata, sessions, exportedAt: new Date().toISOString() };
    writeFileSync(this.exportFile, JSON.stringify(data, null, 2), { mode: 0o600 });
    this.logger.info(`Exported ${compressed.length} compressed, ${Object.keys(metadata).length} metadata, ${sessions.length} sessions`);
  }

  private importData(): void {
    if (!existsSync(this.exportFile)) {
      this.logger.warn("No export file found");
      return;
    }

    const raw = readFileSync(this.exportFile, "utf-8");
    const data = JSON.parse(raw) as {
      compressed: CompressedEntry[];
      metadata: Record<string, string>;
      sessions: Array<{ id: string; summary: string }>;
    };

    if (data.compressed) {
      for (const entry of data.compressed) {
        this.storage.saveCompressedEntry(entry);
      }
    }
    if (data.metadata) {
      for (const [key, value] of Object.entries(data.metadata)) {
        this.storage.setMetadata(key, value);
      }
    }

    this.logger.info(`Imported ${data.compressed?.length || 0} compressed, ${Object.keys(data.metadata || {}).length} metadata keys`);
  }

  private git(args: string[]): { stdout: string; stderr: string } {
    const result = Bun.spawnSync(["git", ...args], {
      cwd: this.syncDir,
    });

    if (result.exitCode !== 0) {
      const msg = result.stderr?.toString().trim() || `exit code ${result.exitCode}`;
      throw new Error(`git ${args[0]} failed: ${msg}`);
    }

    return {
      stdout: result.stdout?.toString() || "",
      stderr: result.stderr?.toString() || "",
    };
  }
}
