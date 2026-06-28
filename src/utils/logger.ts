/**
 * Airgent Logger
 *
 * Structured logging with levels and output control.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	fatal: 4,
};

export class Logger {
	private level: LogLevel;
	private name: string;
	private debugMode: boolean;

	constructor(name: string, level: LogLevel = "info", debugMode = false) {
		this.name = name;
		this.level = level;
		this.debugMode = debugMode;
	}

	private log(level: LogLevel, message: string, ...args: unknown[]): void {
		if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) return;

		const timestamp = new Date().toISOString();
		const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.name}]`;

		if (this.debugMode && level === "debug") {
			console.debug(prefix, message, ...args);
		} else if (level === "error" || level === "fatal") {
			console.error(prefix, message, ...args);
		} else {
			console.log(prefix, message, ...args);
		}
	}

	setDebug(enabled: boolean): void {
		this.debugMode = enabled;
	}

	debug(message: string, ...args: unknown[]): void {
		this.log("debug", message, ...args);
	}

	info(message: string, ...args: unknown[]): void {
		this.log("info", message, ...args);
	}

	warn(message: string, ...args: unknown[]): void {
		this.log("warn", message, ...args);
	}

	error(message: string, ...args: unknown[]): void {
		this.log("error", message, ...args);
	}

	fatal(message: string, ...args: unknown[]): void {
		this.log("fatal", message, ...args);
	}

	child(name: string): Logger {
		return new Logger(`${this.name}:${name}`, this.level, this.debugMode);
	}
}

export const rootLogger = new Logger("airgent", "info", false);

const HOME_DIR = typeof process !== "undefined" && process.env?.HOME ? process.env.HOME : "";

export function sanitizeError(err: unknown): string {
	let msg: string;
	if (err instanceof Error) {
		msg = err.message;
	} else {
		msg = String(err);
	}

	// Strip stack traces (keep only first line)
	const newlineIdx = msg.indexOf("\n");
	if (newlineIdx !== -1) msg = msg.substring(0, newlineIdx);

	// Redact home directory paths
	if (HOME_DIR) {
		const escaped = HOME_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		msg = msg.replace(new RegExp(escaped, "g"), "~");
	}

	// Cap length to prevent log flooding
	if (msg.length > 500) msg = `${msg.substring(0, 500)}...`;

	return msg;
}
