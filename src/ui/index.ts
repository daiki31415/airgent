import * as readline from "readline";
import { rootLogger } from "../utils/logger";
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
}

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
  private _copyInProgress = false;
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
        const renderer = await createCliRenderer({
          exitOnCtrlC: false,
          backgroundColor: "#1a1b26",
        });
        this.renderer = renderer;
        renderer.root.flexDirection = "column";

        const scrollboxVNode = ScrollBox({
          id: "log-area",
          flexGrow: 1,
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

        renderer.on("selection", (sel: Selection) => this.handleSelection(sel, renderer));

        // Ctrl+C handling: first press warns, second press shuts down
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
        renderer.copyToClipboardOSC52(text);
      }
    } catch {
      // ignore selection API errors
    } finally {
      this._copyInProgress = false;
    }
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
    if (this._sigintTimer) clearTimeout(this._sigintTimer);
    if (this.renderer) {
      this.renderer.destroy();
    }
    this.renderer = null;
    this.scrollbox = null;
    this.input = null;
    logger.info("UI stopped");
  }

  private addLine(line: string, fg?: string): void {
    if (this.scrollbox) {
      this.scrollbox.add(Text({ content: line, width: "100%", fg: fg || "#c0caf5" }));
    } else if (!this.isTTY) {
      console.log(line);
    }
  }

  log(level: string, source: string, message: string): void {
    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    this.addLine(`${ts} ${level.padEnd(5)} ${source} ${message}`);
  }

  stream(line: string, fg?: string): void {
    this.addLine(line, fg);
  }

  notice(message: string): void {
    this.addLine(message, "#00ff00");
  }

  updateStatus(info: Partial<StatusInfo>): void {
    Object.assign(this.statusInfo, info);
  }

  async prompt(question: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(question, (answer) => { rl.close(); resolve(answer); });
    });
  }

  async selectModel(
    title: string,
    options: Array<{ name: string; description: string; value: any }>
  ): Promise<any> {
    if (!this.renderer || !this.scrollbox) {
      return this.selectModelFallback(title, options);
    }

    return new Promise((resolve) => {
      const root = this.renderer!.root;

      const overlayVNode = Box({
        id: "select-overlay",
        position: "absolute",
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 999,
        backgroundColor: "#1a1b26",
        flexDirection: "column",
        paddingX: 2,
        paddingY: 2,
      });
      root.add(overlayVNode);
      const overlay = root.findDescendantById("select-overlay")!;

      overlay.add(Text({
        content: `  ${title}  (↑↓ Enter)`,
        width: "100%", fg: "#7aa2f7",
      }));

      const selectVNode = Select({
        id: "model-select",
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
        const option = (root.findDescendantById("model-select") as SelectRenderable | null)?.getSelectedOption();
        setTimeout(() => {
          root.remove("select-overlay");
          this.renderer!.requestRender();
          if (this.input) this.renderer!.focusRenderable(this.input);
          resolve(option?.value ?? null);
        }, 0);
      });

      overlay.add(selectVNode);
      this.renderer!.requestRender();

      setTimeout(() => {
        const s = root.findDescendantById("model-select") as SelectRenderable | null;
        if (s) {
          s.focusable = true;
          s.focus();
        }
      }, 0);
    });
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
