import { spawnSync as _spawnSync } from "node:child_process";
import { writeFileSync as _writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type CopyMethod = "osc52" | "xclip" | "wl-copy" | "pbcopy" | "xsel" | "file";

export interface CopyResult {
	success: boolean;
	method: CopyMethod;
	error?: string;
	filePath?: string;
}

/** @internal Dependency overrides for testing */
export interface CopyOverrides {
	spawnSync?: typeof _spawnSync;
	writeFileSync?: typeof _writeFileSync;
}

export function copyToClipboard(
	text: string,
	osc52Copy?: (text: string) => boolean,
	overrides?: CopyOverrides,
): CopyResult {
	const spawnSync = overrides?.spawnSync ?? _spawnSync;
	const writeFileSync = overrides?.writeFileSync ?? _writeFileSync;
	// 1. OSC52 (TUI内選択コピー)
	if (osc52Copy) {
		try {
			const ok = osc52Copy(text);
			if (ok) return { success: true, method: "osc52" };
		} catch {
			// fall through
		}
	}

	// 2. システムクリップボードCLI
	if (process.platform === "darwin") {
		try {
			const proc = spawnSync("pbcopy", [], { input: text, encoding: "utf-8" });
			if (proc.status === 0) return { success: true, method: "pbcopy" };
		} catch {
			// fall through
		}
	}

	if (process.platform === "linux") {
		// Wayland
		if (process.env.WAYLAND_DISPLAY) {
			try {
				const proc = spawnSync("wl-copy", [], {
					input: text,
					encoding: "utf-8",
				});
				if (proc.status === 0) return { success: true, method: "wl-copy" };
			} catch {
				// fall through
			}
		}
		// X11: xclip
		try {
			const proc = spawnSync("xclip", ["-selection", "clipboard"], {
				input: text,
				encoding: "utf-8",
			});
			if (proc.status === 0) return { success: true, method: "xclip" };
		} catch {
			// fall through
		}
		// X11: xsel
		try {
			const proc = spawnSync("xsel", ["-i", "-b"], {
				input: text,
				encoding: "utf-8",
			});
			if (proc.status === 0) return { success: true, method: "xsel" };
		} catch {
			// fall through
		}
	}

	// 3. 最終フォールバック: 一時ファイルに書き出し
	try {
		const tmpFile = join(tmpdir(), `airgent-copy-${Date.now()}.txt`);
		writeFileSync(tmpFile, text, "utf-8");
		return { success: true, method: "file", filePath: tmpFile };
	} catch (err) {
		return { success: false, method: "file", error: String(err) };
	}
}
