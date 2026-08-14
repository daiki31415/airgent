/**
 * Hand-rolled spy/matcher utilities for tests.
 *
 * Extracted from airgent.test.ts (Phase2) so any test file needing
 * call-verification can avoid bun:test's `mock()`, whose tracking behavior
 * has proven version-dependent across Bun releases. Plain closures with a
 * `.calls` array — no reliance on Bun internals.
 */

interface Spy<Args extends unknown[] = unknown[], Ret = unknown> {
	calls: Args[];
	(...args: Args): Ret;
}

export function spy<Args extends unknown[] = unknown[], Ret = unknown>(
	impl?: (...args: Args) => Ret,
): Spy<Args, Ret> {
	const calls: Args[] = [];
	const fn = ((...args: Args) => {
		calls.push(args);
		if (impl) return impl(...args);
		return undefined as Ret;
	}) as Spy<Args, Ret>;
	fn.calls = calls;
	return fn;
}

// ============================================================
// Minimal matcher engine (hand-rolled, asymmetric-matcher friendly)
// ============================================================

interface Matcher {
	__: (v: unknown) => boolean;
}

function matcher(test: (v: unknown) => boolean): Matcher {
	return { __: test };
}
function isMatcher(x: unknown): x is Matcher {
	return typeof x === "object" && x !== null && typeof (x as Matcher).__ === "function";
}

export const strContaining = (s: string) => matcher((v) => typeof v === "string" && v.includes(s));
export const anyStr = () => matcher((v) => typeof v === "string");
export const anyNum = () => matcher((v) => typeof v === "number");
export const anyArr = () => matcher((v) => Array.isArray(v));
export const objContaining = (o: Record<string, unknown>) =>
	matcher(
		(v) =>
			typeof v === "object" &&
			v !== null &&
			Object.keys(o).every(
				(k) => Object.hasOwn(v, k) && deepEq(o[k], (v as Record<string, unknown>)[k]),
			),
	);

export function deepEq(a: unknown, b: unknown): boolean {
	if (isMatcher(a)) return a.__(b);
	if (a === b) return true;
	if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		return a.every((x, i) => deepEq(x, b[i]));
	}
	if (a && b && typeof a === "object" && typeof b === "object") {
		const keys = Object.keys(a);
		return keys.every(
			(k) =>
				Object.hasOwn(b, k) &&
				deepEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
		);
	}
	return false;
}

export function wasCalled(fn: unknown): boolean {
	const calls = (fn as { calls?: unknown[] })?.calls;
	return Array.isArray(calls) && calls.length > 0;
}

export function callCount(fn: unknown): number {
	const calls = (fn as { calls?: unknown[] })?.calls;
	return Array.isArray(calls) ? calls.length : 0;
}

export function calledWith(fn: unknown, ...expected: unknown[]): boolean {
	const calls = (fn as { calls?: unknown[][] })?.calls ?? [];
	return calls.some((c) => {
		if (c.length !== expected.length) return false;
		return expected.every((e, i) => deepEq(e, c[i]));
	});
}
