export type Result<T, E = string> =
	| { ok: true; value: T }
	| { ok: false; error: E };

export function ok<T, E = string>(value: T): Result<T, E> {
	return { ok: true, value };
}

export function err<T, E = string>(error: E): Result<T, E> {
	return { ok: false, error };
}
