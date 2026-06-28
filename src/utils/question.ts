import type { Question } from "../types";

export const QUESTION_TAG = "QUESTION";

export function extractQuestion(text: string): Question | null {
	const m = text.match(/\[QUESTION\]([\s\S]*?)\[\/QUESTION\]/);
	if (!m?.[1]) return null;
	try {
		return JSON.parse(m[1].trim());
	} catch {
		return null;
	}
}
