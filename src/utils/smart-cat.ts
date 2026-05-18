import { spawnSync } from "node:child_process";
import { resolve, normalize } from "node:path";
import { existsSync } from "node:fs";

export const ALLOWED_DIRS = [
  resolve(process.cwd()),
  ...(process.env.HOME ? [process.env.HOME] : []),
].map(d => normalize(resolve(d)));

const CAT_MAP: Record<string, string> = {
  ".gz": "zcat",
  ".xz": "xzcat",
  ".bz2": "bzcat",
  ".lzma": "lzcat",
};

const ARCHIVE_EXTS = [".zip", ".7z", ".rar", ".tar", ".tgz"];

function archiveExtension(file: string): boolean {
  const lower = file.toLowerCase();
  return ARCHIVE_EXTS.some(ext => lower.endsWith(ext)) || /\.(tar\.gz|tar\.xz|tar\.bz2)$/.test(lower);
}

export function resolveSafePath(file: string): string {
  const resolved = normalize(resolve(file));

  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${file}`);
  }

  const allowed = ALLOWED_DIRS.some(dir => resolved.startsWith(dir + "/") || resolved === dir);
  if (!allowed) {
    throw new Error(`Access denied: ${file} is outside allowed directories`);
  }

  return resolved;
}

export function smartCat(
  file: string,
  options?: { maxLines?: number; lineNumbers?: boolean }
): string {
  if (archiveExtension(file)) {
    throw new Error(`Refusing to read archive: ${file}`);
  }

  const safePath = resolveSafePath(file);

  const ext = "." + safePath.split(".").pop()?.toLowerCase();
  const cmd = CAT_MAP[ext] || "cat";

  const result = spawnSync(cmd, [safePath], { encoding: "utf-8" });

  if (result.error) {
    throw new Error(`smartCat failed for ${file}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`smartCat failed for ${file}: ${result.stderr?.trim() || result.stdout?.trim() || `exit code ${result.status}`}`);
  }

  let output = result.stdout || "";

  if (options?.maxLines && options.maxLines > 0) {
    const lines = output.split("\n");
    output = lines.slice(0, options.maxLines).join("\n");
    if (lines.length > options.maxLines) {
      output += `\n... (${lines.length - options.maxLines} more lines)`;
    }
  }

  if (options?.lineNumbers) {
    const lines = output.split("\n");
    const width = String(lines.length).length;
    output = lines.map((line, i) => String(i + 1).padStart(width) + ": " + line).join("\n");
  }

  return output;
}
