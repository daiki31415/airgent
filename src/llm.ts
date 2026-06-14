import type { ModelEntry, Question } from "./types";
import type { OpenCodeAPI } from "./api/opencode";
import { rootLogger } from "./utils/logger";
import { extractQuestion } from "./utils/question";

const logger = rootLogger.child("llm");

export interface LLMCallOptions {
  model: ModelEntry;
  messages: Array<{ role: string; content: string }>;
  api: OpenCodeAPI;
  onChunk?: (chunk: string) => void;
  onQuestion?: (question: Question) => Promise<string>;
  maxQuestionRounds?: number;
}

export async function callLLM(options: LLMCallOptions): Promise<string> {
  const {
    model,
    messages,
    api,
    onChunk,
    onQuestion,
    maxQuestionRounds = 5,
  } = options;

  if (onChunk) {
    let content = "";
    let buffer = "";
    let msgs = messages.map(m => ({ ...m }));
    try {
      for await (const chunk of api.streamChat(model, msgs)) {
        content += chunk;
        buffer += chunk;
        if (buffer.includes("\n")) {
          const lines = buffer.split("\n");
          for (let i = 0; i < lines.length - 1; i++) {
            const l = lines[i]!.trim();
            if (l) onChunk(l);
          }
          buffer = lines[lines.length - 1]!;
        }
      }
      if (buffer.trim()) onChunk(buffer.trim());
    } catch (err) {
      logger.warn(
        {
          accumulatedChars: content.length,
          error: err instanceof Error ? err.message : String(err),
        },
        "streaming failed; falling back to non-streaming with partial context. UI may show stream content that diverges from final content — callers should reconcile.",
      );
      if (content) {
        msgs = [...msgs, { role: "assistant", content }];
      }
      const res = await api.chat(model, msgs);
      content = res.content;
    }
    return content;
  }

  const msgs = messages.map(m => ({ ...m }));
  for (let i = 0; i < maxQuestionRounds; i++) {
    const response = await api.chat(model, msgs);
    const q = extractQuestion(response.content);
    if (!q) return response.content;

    const clean = response.content.replace(/\[QUESTION\][\s\S]*?\[\/QUESTION\]/, "").trim();
    if (clean) {
      msgs.push({ role: "assistant", content: clean });
    }

    if (onQuestion) {
      const answer = await onQuestion(q);
      msgs.push({ role: "user", content: `[Your answer: ${answer}]` });
    } else {
      msgs.push({ role: "user", content: `[Your answer: N/A]` });
    }
  }
  throw new Error("callLLM: too many question rounds");
}
