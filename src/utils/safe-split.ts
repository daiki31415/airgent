export function safeSplit(text: string, separator: string): [string, string] {
	const idx = text.indexOf(separator);
	if (idx === -1) return [text, ""];
	return [text.slice(0, idx), text.slice(idx + separator.length)];
}
