import { resolve, normalize } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

/**
 * Returns the directories from which file access is permitted.
 *
 * Resolved lazily on every call so that runtime changes to `process.cwd()`
 * (e.g. via `process.chdir`) or to `HOME` are reflected immediately, rather
 * than captured at module load time.
 */
export function getAllowedDirs(): string[] {
  return [
    resolve(process.cwd()),
    ...(process.env.HOME ? [process.env.HOME] : []),
  ].map(d => normalize(resolve(d)));
}

const CAT_MAP: Record<string, string> = {
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

  const allowed = getAllowedDirs().some(dir => resolved.startsWith(dir + "/") || resolved === dir);
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

  const raw = readFileSync(safePath);

  let output: string;
  if (ext === ".gz") {
    output = gunzipSync(raw).toString("utf-8");
  } else if (CAT_MAP[ext]) {
    const proc = Bun.spawnSync([CAT_MAP[ext], safePath]);
    if (!proc.success) {
      throw new Error(
        `smartCat failed for ${file}: ${proc.stderr.toString().trim() || `exit code ${proc.exitCode}`}`
      );
    }
    output = proc.stdout.toString("utf-8");
  } else {
    output = raw.toString("utf-8");
  }

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
