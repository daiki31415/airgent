import type { MemoryOrganizerAgent } from "../agents/memory-organizer";
import type { ValidationAgent } from "../agents/validation";
import type { WorkerAgent } from "../agents/worker";
import type { OpenCodeAPI } from "../api/opencode";
import type { CompressionManager } from "../compression/index";
import { callLLM } from "../llm";
import type { MemorySystem } from "../memory/index";
import type { PromptManager } from "../prompt/index";
import type { SkillsManager } from "../skills/index";
import type { ModelConfig, Settings } from "../types";
import type { UIManager } from "../ui/index";
import { safeParseJSON } from "../utils/json";
import type { PipelineEngine } from "./index";

export interface PipelineHandle {
	sessionId: string | null;
	currentTask: string;
	pipelineData: Record<string, string | undefined>;
	config: { models: ModelConfig; settings: Settings };
	api: OpenCodeAPI;
	ui: UIManager;
	pipeline: PipelineEngine;
	promptManager: PromptManager;
	skills: SkillsManager;
	memory: MemorySystem;
	compressionManager: CompressionManager;
	worker: WorkerAgent;
	validation: ValidationAgent;
	memoryOrganizer: MemoryOrganizerAgent;
}

export function registerPipelineHandlers(agent: PipelineHandle): void {
	agent.pipeline.registerHandler("clarify", async () => {
		const messages = [
			{
				role: "system" as const,
				content: agent.promptManager.buildNodePrompt("clarify"),
			},
			{
				role: "user" as const,
				content: `Analyze this task:\n${agent.currentTask}`,
			},
		];
		const content = await callLLM({
			model: agent.config.models.planner,
			messages,
			api: agent.api,
			onChunk: agent.config.settings.showPipelineProgress
				? (chunk: string) => agent.ui.stream(`    ${chunk}`)
				: undefined,
		});

		const parsed = safeParseJSON<{ goal?: string }>(content);
		if (!parsed?.goal) {
			agent.ui.log(
				"warn",
				"clarify",
				"LLM returned invalid JSON for clarification",
			);
		}

		agent.pipelineData.clarifiedTask = content;
		if (!agent.config.settings.showPipelineProgress) {
			agent.ui.log("info", "clarify", "Analyzed task");
		}
		return { content };
	});

	agent.pipeline.registerHandler("plan", async () => {
		const source = agent.pipelineData.clarifiedTask || agent.currentTask;
		const messages = [
			{
				role: "system" as const,
				content: agent.promptManager.buildNodePrompt("plan"),
			},
			{
				role: "user" as const,
				content: `Create a plan based on the requirements:\n\n${source}`,
			},
		];
		const content = await callLLM({
			model: agent.config.models.planner,
			messages,
			api: agent.api,
			onChunk: agent.config.settings.showPipelineProgress
				? (chunk: string) => agent.ui.stream(`    ${chunk}`)
				: undefined,
		});

		const parsed = safeParseJSON<{ steps?: string }>(content);
		if (!parsed?.steps) {
			agent.ui.log("warn", "plan", "LLM returned invalid JSON for planning");
		}

		agent.pipelineData.plan = content;
		if (!agent.config.settings.showPipelineProgress) {
			agent.ui.log("info", "plan", "Created plan");
		}
		return { content };
	});

	agent.pipeline.registerHandler("generate", async () => {
		const memories = agent.memory.findRelevant([agent.currentTask]).slice(0, 3);
		const memoryStr = memories.map((m) => `- ${m.bug}: ${m.fix}`).join("\n");
		const parts = [
			memoryStr ? `Relevant context:\n${memoryStr}` : "",
			agent.pipelineData.plan ? `Approach:\n${agent.pipelineData.plan}` : "",
			agent.pipelineData.clarifiedTask
				? `Requirements:\n${agent.pipelineData.clarifiedTask}`
				: "",
			`Task: ${agent.currentTask}`,
		].filter(Boolean);
		const generationPrompt = parts.join("\n\n");

		const result = await agent.worker.execute(
			generationPrompt,
			agent.config.settings.showPipelineProgress
				? (chunk: string) => {
						const lines = chunk.split("\n");
						for (const l of lines) {
							const trimmed = l.trim();
							if (trimmed) agent.ui.stream(`    ${trimmed}`);
						}
					}
				: undefined,
		);
		agent.pipelineData.generatedOutput = result.content;
		if (!agent.config.settings.showPipelineProgress) {
			agent.ui.log(
				"info",
				"generate",
				`Generated: ${result.content.length} chars`,
			);
		}
		return result;
	});

	agent.pipeline.registerHandler("test", async () => {
		if (!agent.pipelineData.generatedOutput)
			return { status: "skipped", reason: "no output" };
		const messages = [
			{
				role: "system" as const,
				content: agent.promptManager.buildNodePrompt("test"),
			},
			{
				role: "user" as const,
				content: `Task: ${agent.currentTask}\n\nOutput:\n${agent.pipelineData.generatedOutput.slice(0, 4000)}`,
			},
		];
		const content = await callLLM({
			model: agent.config.models.validation,
			messages,
			api: agent.api,
			onChunk: agent.config.settings.showPipelineProgress
				? (chunk: string) => agent.ui.stream(`    ${chunk}`)
				: undefined,
		});
		agent.pipelineData.testResult = content;

		const parsed = safeParseJSON<{ passed?: boolean }>(content);
		let passed = parsed?.passed;

		if (passed === undefined) {
			agent.ui.log(
				"warn",
				"test",
				"Could not parse JSON test result, falling back to keyword heuristic",
			);
			passed = !/(?:bug|error|issue|incorrect|wrong|missing)/i.test(content);
		}

		if (!agent.config.settings.showPipelineProgress) {
			agent.ui.log(
				"info",
				"test",
				passed ? "No issues detected" : "Issues found",
			);
		}
		return { content, passed };
	});

	agent.pipeline.registerHandler("validate", async () => {
		const report = await agent.validation.validate();
		if (report.overallHealth !== "healthy") {
			agent.ui.log(
				"warn",
				"validation",
				`Health: ${report.overallHealth} (${report.issues.length} issues)`,
			);
		}
		return report;
	});

	agent.pipeline.registerHandler("report", async () => {
		if (agent.sessionId) {
			await agent.memoryOrganizer.organize(agent.sessionId);
			await agent.compressionManager.compressSession(agent.sessionId);
		}
		return { status: "completed" };
	});
}
