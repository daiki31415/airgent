import { existsSync, readFileSync } from "node:fs";
import { normalize, resolve } from "node:path";
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
	].map((d) => normalize(resolve(d)));
}

const ARCHIVE_EXTS = [".zip", ".7z", ".rar", ".tar", ".tgz"];

const UNSUPPORTED_COMPRESSION_EXTS = [".xz", ".bz2", ".lzma"];

function archiveExtension(file: string): boolean {
	const lower = file.toLowerCase();
	return (
		ARCHIVE_EXTS.some((ext) => lower.endsWith(ext)) ||
		/\.(tar\.gz|tar\.xz|tar\.bz2)$/.test(lower)
	);
}

function unsupportedCompressionExtension(file: string): string | null {
	const lower = file.toLowerCase();
	for (const ext of UNSUPPORTED_COMPRESSION_EXTS) {
		if (lower.endsWith(ext)) return ext;
	}
	return null;
}

export function resolveSafePath(file: string): string {
	const resolved = normalize(resolve(file));

	if (!existsSync(resolved)) {
		throw new Error(`File not found: ${file}`);
	}

	const allowed = getAllowedDirs().some(
		(dir) => resolved.startsWith(`${dir}/`) || resolved === dir,
	);
	if (!allowed) {
		throw new Error(`Access denied: ${file} is outside allowed directories`);
	}

	return resolved;
}

export function smartCat(
	file: string,
	options?: { maxLines?: number; lineNumbers?: boolean },
): string {
	if (archiveExtension(file)) {
		throw new Error(`Refusing to read archive: ${file}`);
	}

	const unsupportedExt = unsupportedCompressionExtension(file);
	if (unsupportedExt) {
		throw new Error(
			`Unsupported compression format: ${unsupportedExt}. ` +
				`This format requires external tools (e.g., xzcat, bzcat, lzcat) which are not available cross-platform. ` +
				`Please decompress the file first or use a supported format (.gz).`,
		);
	}

	const safePath = resolveSafePath(file);

	const ext = `.${safePath.split(".").pop()?.toLowerCase()}`;

	const raw = readFileSync(safePath);

	let output: string;
	if (ext === ".gz") {
		output = gunzipSync(raw).toString("utf-8");
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
		output = lines
			.map((line, i) => `${String(i + 1).padStart(width)}: ${line}`)
			.join("\n");
	}

	return output;
}
