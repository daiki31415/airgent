/**
 * Hand-rolled spy/matcher utilities for tests.
 *
 * Extracted from airgent.test.ts (Phase2) so any test file needing
 * call-verification can avoid bun:test's `mock()`, whose tracking behavior
 * has proven version-dependent across Bun releases. Plain closures with a
 * `.calls` array — no reliance on Bun internals.
 */

interface Spy {
	calls: unknown[][];
	(...args: unknown[]): unknown;
}

export function spy(impl?: (...args: any[]) => any): Spy & ((...args: any[]) => any) {
	const calls: unknown[][] = [];
	const fn = ((...args: any[]) => {
		calls.push(args);
		if (impl) return impl(...args);
		return undefined;
	}) as Spy & ((...args: any[]) => any);
	fn.calls = calls;
	return fn;
}

// ============================================================
// Minimal matcher engine (hand-rolled, asymmetric-matcher friendly)
// ============================================================

function matcher(test: (v: any) => boolean): any {
	return { __: test };
}
function isMatcher(x: any): x is { __: (v: any) => boolean } {
	return typeof x === "object" && x !== null && typeof x.__ === "function";
}

export const strContaining = (s: string) =>
	matcher((v) => typeof v === "string" && v.includes(s));
export const anyStr = () => matcher((v) => typeof v === "string");
export const anyNum = () => matcher((v) => typeof v === "number");
export const anyArr = () => matcher((v) => Array.isArray(v));
export const objContaining = (o: Record<string, any>) =>
	matcher(
		(v) =>
			typeof v === "object" &&
			v !== null &&
			Object.keys(o).every(
				(k) => Object.prototype.hasOwnProperty.call(v, k) && deepEq(o[k], v[k]),
			),
	);

export function deepEq(a: any, b: any): boolean {
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
			(k) => Object.prototype.hasOwnProperty.call(b, k) && deepEq(a[k], b[k]),
		);
	}
	return false;
}

export function wasCalled(fn: any): boolean {
	return Array.isArray(fn?.calls) && fn.calls.length > 0;
}

export function callCount(fn: any): number {
	return Array.isArray(fn?.calls) ? fn.calls.length : 0;
}

export function calledWith(fn: any, ...expected: any[]): boolean {
	return (fn?.calls ?? []).some((c: unknown[]) => {
		if (c.length !== expected.length) return false;
		return expected.every((e, i) => deepEq(e, c[i]));
	});
}
