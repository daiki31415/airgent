/**
 * Utility for safely parsing JSON from LLM responses.
 * Handles common LLM artifacts like markdown code fences.
 */

export function safeParseJSON<T>(text: string): T | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Remove markdown code fences if present
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const jsonText = fenceMatch?.[1] ?? trimmed;

  try {
    return JSON.parse(jsonText);
  } catch (e) {
    return null;
  }
}
