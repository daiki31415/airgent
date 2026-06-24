import * as readline from "readline";
import { rootLogger } from "../utils/logger";
import { copyToClipboard } from "../utils/clipboard";
import type { CopyResult } from "../utils/clipboard";
import type { Question } from "../types";
import {
  createCliRenderer,
  InputRenderableEvents,
  Text,
  ScrollBox,
  Input,
  Box,
  Select,
  SelectRenderableEvents,
} from "@opentui/core";
import type {
  CliRenderer,
  ScrollBoxRenderable,
  InputRenderable,
  SelectRenderable,
  Selection,
} from "@opentui/core";

const logger = rootLogger.child("ui");

const SOURCE_COLORS: Record<string, string> = {
  user: "#7dcfff",
  ai: "#9ece6a",
  airgent: "#e0af68",
  error: "#f7768e",
  warn: "#ff9e64",
  info: "#c0caf5",
  debug: "#565f89",
};
function sourceColor(source: string): string {
  return SOURCE_COLORS[source] || "#c0caf5";
}

export interface StatusInfo {
  sessionId: string;
  status: string;
  pipelineNode: string;
  tokenUsage: number;
  memoryCount: number;
  errorCount: number;
  uptime: number;
}

export interface UIOptions {
  refreshIntervalMs: number;
  onInput?: (line: string) => void;
  onShutdown?: () => void;
  renderer?: any;
}

const GOLDEN = 1.618;

export class UIManager {
  private options: UIOptions;
  ready = false;
  private statusInfo: StatusInfo = {
    sessionId: "", status: "idle", pipelineNode: "",
    tokenUsage: 0, memoryCount: 0, errorCount: 0, uptime: 0,
  };
  startTime = Date.now();
  private running = false;
  private isTTY: boolean;

  private renderer: CliRenderer | null = null;
  private scrollbox: ScrollBoxRenderable | null = null;
  private input: InputRenderable | null = null;
  private headerBox: any = null;
  private statusBar: any = null;
  private _copyInProgress = false;
  private _copyToastTimer: ReturnType<typeof setTimeout> | null = null;
  private _sigintCount = 0;
  private _sigintTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: UIOptions) {
    this.options = options;
    this.isTTY = process.stdout.isTTY && process.stdin.isTTY;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startTime = Date.now();

    if (this.isTTY) {
      try {
        const renderer = this.options.renderer || await createCliRenderer({
          exitOnCtrlC: false,
          backgroundColor: "#1a1b26",
        });
        this.renderer = renderer;
        renderer.root.flexDirection = "column";

        const headerVNode = Box({
          id: "header",
          width: "100%",
          height: 3,
          borderStyle: "rounded",
          borderColor: "#3b4261",
          backgroundColor: "#1f2335",
          flexDirection: "row",
          alignItems: "center",
        });
        renderer.root.add(headerVNode);
        this.headerBox = renderer.root.findDescendantById("header");

        const titleText = Text({
          id: "header-title",
          content: " Airgent ",
          fg: "#7aa2f7",
        });
        this.headerBox.add(titleText);

        const statusText = Text({
          id: "header-status",
          content: "● idle",
          fg: "#565f89",
        });
        this.headerBox.add(statusText);

        const scrollboxVNode = ScrollBox({
          id: "log-area",
          flexGrow: GOLDEN,
          width: "100%",
          stickyScroll: true,
          stickyStart: "bottom",
          viewportCulling: false,
          rootOptions: { backgroundColor: "#1a1b26" },
          viewportOptions: { backgroundColor: "#1a1b26" },
          contentOptions: { backgroundColor: "#1a1b26" },
        });
        renderer.root.add(scrollboxVNode);
        this.scrollbox = renderer.root.findDescendantById("log-area") as ScrollBoxRenderable | null;

        const inputVNode = Input({
          id: "input-line",
          width: "100%",
          backgroundColor: "#24283b",
          focusedBackgroundColor: "#2f3449",
          textColor: "#c0caf5",
          cursorColor: "#7aa2f7",
          placeholder: "›  ",
        });
        inputVNode.on(InputRenderableEvents.ENTER, (value: string) => {
          if (!this.ready) {
            this.log("info", "airgent", "Waiting for opencode server...");
            if (this.input) this.input.value = "";
            return;
          }
          if (value.trim() && this.options.onInput) {
            this.options.onInput(value.trim());
          }
          if (this.input) {
            this.input.value = "";
            renderer.focusRenderable(this.input);
          }
        });
        inputVNode.focus();
        renderer.root.add(inputVNode);
        this.input = renderer.root.findDescendantById("input-line") as InputRenderable | null;

        const footerVNode = Box({
          id: "footer",
          width: "100%",
          height: 3,
          borderStyle: "rounded",
          borderColor: "#3b4261",
          backgroundColor: "#1f2335",
          flexDirection: "row",
          alignItems: "center",
        });
        renderer.root.add(footerVNode);
        this.statusBar = renderer.root.findDescendantById("footer");

        const footerText = Text({
          id: "footer-text",
          content: " ready",
          fg: "#565f89",
        });
        this.statusBar.add(footerText);

        renderer.on("selection", (sel: Selection) => this.handleSelection(sel, renderer));

        renderer.keyInput.on("keypress", (event: any) => {
          if (event.ctrl && event.name === "c") {
            event.preventDefault();
            this.handleCtrlC();
          }
        });

        renderer.start();

        if (this.input) renderer.focusRenderable(this.input);
      } catch (err) {
        logger.warn("opentui init failed", err);
      }
    }

    logger.info("UI started");
  }

  private handleSelection(sel: Selection, renderer: CliRenderer): void {
    if (this._copyInProgress) return;
    try {
      this._copyInProgress = true;
      const text = sel.getSelectedText();
      if (text && /\S/.test(text)) {
        const result = copyToClipboard(text, (t) => renderer.copyToClipboardOSC52(t));
        this.showCopyToast(result);
      }
    } catch {
      // ignore selection API errors
    } finally {
      this._copyInProgress = false;
    }
  }

  copy(text: string): CopyResult {
    const result = copyToClipboard(
      text,
      this.renderer ? (t) => this.renderer!.copyToClipboardOSC52(t) : undefined,
    );
    this.showCopyToast(result);
    return result;
  }

  private showCopyToast(result: CopyResult): void {
    if (!this.renderer) return;

    if (this._copyToastTimer) clearTimeout(this._copyToastTimer);

    const existing = this.renderer.root.findDescendantById("toast-copy");
    if (existing) this.renderer.root.remove("toast-copy");

    const toastVNode = Box({
      id: "toast-copy",
      focusable: false,
      position: "absolute",
      top: 1,
      right: 2,
      zIndex: 999,
      backgroundColor: "#1a1b26",
      borderStyle: "rounded",
      borderColor: result.success ? "#9ece6a" : "#f7768e",
      paddingX: 2,
      paddingY: 1,
    });
    this.renderer.root.add(toastVNode);
    const toast = this.renderer.root.findDescendantById("toast-copy");
    if (toast) {
      const msg = result.success
        ? result.method === "file"
          ? `Copied to ${result.filePath}`
          : "Copied!"
        : "Copy failed";
      toast.add(Text({ content: msg, fg: result.success ? "#9ece6a" : "#f7768e" }));
    }
    this.renderer.requestRender();
    if (this.input) this.renderer.focusRenderable(this.input);

    this._copyToastTimer = setTimeout(() => {
      this.renderer?.root.remove("toast-copy");
      this.renderer?.requestRender();
      if (this.input) this.renderer?.focusRenderable(this.input);
      this._copyToastTimer = null;
    }, 3000);
  }

  private handleCtrlC(): void {
    this._sigintCount++;
    if (this._sigintCount === 1) {
      this.log("warn", "airgent", "Press Ctrl+C again to shut down");
      this._sigintTimer = setTimeout(() => { this._sigintCount = 0; }, 3000);
    } else {
      if (this._sigintTimer) clearTimeout(this._sigintTimer);
      this.log("info", "airgent", "Shutting down...");
      process.nextTick(() => this.options.onShutdown?.());
    }
  }

  stop(): void {
    this.running = false;
    if (this._sigintTimer) { clearTimeout(this._sigintTimer); this._sigintTimer = null; }
    if (this._copyToastTimer) { clearTimeout(this._copyToastTimer); this._copyToastTimer = null; }
    if (this.renderer) {
      this.renderer.destroy();
    }
    this.renderer = null;
    this.scrollbox = null;
    this.input = null;
    logger.info("UI stopped");
  }

  private addLine(line: string, source = "info"): void {
    if (this.scrollbox) {
      const fg = sourceColor(source);
      this.scrollbox.add(Text({ content: line, width: "100%", fg }));
    } else if (!this.isTTY) {
      console.log(line);
    }
  }

  log(level: string, source: string, message: string): void {
    const fg = sourceColor(source);
    if (level === "info") {
      this.addLine(`${source} ${message}`, source);
    } else {
      this.addLine(`${level.toUpperCase()} ${source} ${message}`, level);
    }
  }

  stream(line: string, source?: string): void {
    this.addLine(line, source || "info");
  }

  notice(message: string): void {
    this.addLine(message, "ai");
  }

  updateStatus(info: Partial<StatusInfo>): void {
    Object.assign(this.statusInfo, info);
    this.refreshHeaderAndFooter();
  }

  private refreshHeaderAndFooter(): void {
    if (!this.headerBox || !this.statusBar) return;
    try {
      const si = this.statusInfo;
      const uptime = Math.floor((Date.now() - this.startTime) / 1000);
      const statusDot = si.status === "running" ? "●" : si.status === "error" ? "●" : "●";
      const statusFg = si.status === "error" ? "#f7768e" : "#9ece6a";

      const hTitle = this.headerBox.findDescendantById("header-title");
      if (hTitle) hTitle.content = ` Airgent `;

      const hStatus = this.headerBox.findDescendantById("header-status");
      if (hStatus) {
        hStatus.content = `  ${statusDot} ${si.status}  `;
        hStatus.fg = statusFg;
      }

      const fText = this.statusBar.findDescendantById("footer-text");
      if (fText) {
        fText.content = ` ${uptime}s  |  sess: ${si.sessionId.slice(0, 8) || "-"}  |  tok: ${si.tokenUsage}  |  mem: ${si.memoryCount}  |  err: ${si.errorCount}  |  node: ${si.pipelineNode || "-"}`;
      }
    } catch {
      // ignore render errors during update
    }
  }

  async prompt(question: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(question, (answer) => { rl.close(); resolve(answer); });
    });
  }

  async askQuestion(q: Question): Promise<string> {
    const items = q.options.map(o => ({ name: o.label, description: "", value: o.value }));
    if (q.allowCustom !== false) {
      items.push({ name: "Custom...", description: "Type your own answer", value: "__custom__" });
    }
    const selected = await this.showSelectMenu(q.query, items);
    if (selected === "__custom__") {
      return this.prompt("  Your answer: ");
    }
    return selected;
  }

  async selectModel(
    title: string,
    options: Array<{ name: string; description: string; value: any }>
  ): Promise<any> {
    return this.showSelectMenu(title, options);
  }

  async showSelectMenu(
    title: string,
    options: Array<{ name: string; description: string; value: any }>
  ): Promise<any> {
    if (!this.renderer || !this.scrollbox) {
      return this.selectModelFallback(title, options);
    }

    const id = `overlay-${Date.now()}`;
    const selectId = `${id}-select`;

    return new Promise((resolve) => {
      const root = this.renderer!.root;

      const overlayVNode = Box({
        id,
        position: "absolute",
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 999,
        backgroundColor: "#1a1b26",
        flexDirection: "column",
        paddingX: 2,
        paddingY: 2,
      });
      root.add(overlayVNode);
      const overlay = root.findDescendantById(id)!;

      overlay.add(Text({
        content: `  ${title}  (↑↓ Enter)`,
        width: "100%", fg: "#7aa2f7",
      }));

      const selectVNode = Select({
        id: selectId,
        width: "100%",
        flexGrow: 1,
        options,
        backgroundColor: "#1a1b26",
        textColor: "#c0caf5",
        focusedBackgroundColor: "#2f3449",
        focusedTextColor: "#c0caf5",
        selectedBackgroundColor: "#414868",
        selectedTextColor: "#7dcfff",
        descriptionColor: "#565f89",
      });
      selectVNode.on(SelectRenderableEvents.ITEM_SELECTED, () => {
        const option = (root.findDescendantById(selectId) as SelectRenderable | null)?.getSelectedOption();
        setTimeout(() => {
          root.remove(id);
          this.renderer!.requestRender();
          if (this.input) this.renderer!.focusRenderable(this.input);
          resolve(option?.value ?? null);
        }, 0);
      });

      overlay.add(selectVNode);
      this.renderer!.requestRender();

      setTimeout(() => {
        const s = root.findDescendantById(selectId) as SelectRenderable | null;
        if (s) {
          s.focusable = true;
          s.focus();
        }
      }, 0);
    });
  }

  private async selectModelFallback(
    title: string,
    options: Array<{ name: string; description: string; value: unknown }>
  ): Promise<unknown> {
    console.log(`\n  ${title}`);
    options.forEach((o, i) => console.log(`  ${i + 1}) ${o.name}  ${o.description}`));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(`  Choose (1-${options.length}): `, (answer) => {
        rl.close();
        const idx = parseInt(answer) - 1;
        resolve(options[idx]?.value ?? null);
      });
    });
  }


}
