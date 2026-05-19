/**
 * Airgent - Core Type Definitions
 */

// ============================================================
// Configuration Types
// ============================================================

export interface AirgentConfig {
  constitution: Constitution;
  persona: Persona;
  models: ModelConfig;
  settings: Settings;
}

export interface Constitution {
  name: string;
  version: string;
  principles: string[];
  constraints: string[];
  ethical_guidelines: string[];
}

export interface Persona {
  name: string;
  role: string;
  tone: string;
  rules: string[];
}

export interface ModelConfig {
  planner: ModelEntry;
  generate: ModelEntry;
  compression: ModelEntry;
  validation: ModelEntry;
  watchdog: ModelEntry;
  fallback: ModelEntry[];
}

export interface ModelEntry {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  reasoning?: boolean;
}

export interface MCPServerConfig {
  name: string;
  type: "local" | "remote";
  command?: string[];
  url?: string;
  enabled: boolean;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface Settings {
  maxSystemPromptTokens: number;
  maxContextTokens: number;
  uiRefreshIntervalMs: number;
  autoCompressThreshold: number;
  watchdogIntervalMs: number;
  maxRetriesPerNode: number;
  memoryAutoLink: boolean;
  showPipelineProgress: boolean;
  debug: boolean;
}

// ============================================================
// Agent Types
// ============================================================

export type AgentRole =
  | "worker"
  | "planner"
  | "memory_organizer"
  | "compression"
  | "validation"
  | "watchdog"
  | "context_inspector";

export interface AgentMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AgentContext {
  sessionId: string;
  messages: AgentMessage[];
  systemPrompt: string;
  skillIndex: SkillIndex;
  activeSkills: string[];
  memory: MemoryContext;
  state: Record<string, unknown>;
  tokenCount: number;
}

export interface MemoryContext {
  relevantMemories: StructuredMemory[];
  recentRawLogs: RawLog[];
  compressedEntries: CompressedEntry[];
}

// ============================================================
// Pipeline Types
// ============================================================

export type RetryStrategy =
  | "rollback"
  | "retry"
  | "model_switch"
  | "alternate_strategy";



export interface RetryContext {
  attempt: number;
  strategy: RetryStrategy;
}

export type PipelineNode =
  | "clarify"
  | "plan"
  | "generate"
  | "test"
  | "validate"
  | "report";

export interface DAGNode {
  id: PipelineNode;
  dependsOn: PipelineNode[];
  handler: string;
  maxRetries: number;
  timeout: number;
}

export interface DAGDefinition {
  nodes: DAGNode[];
}

export interface PipelineState {
  sessionId: string;
  currentNode: PipelineNode | null;
  completedNodes: string[];
  failedNodes: Array<{ node: PipelineNode; error: string }>;
  retryCounts: Record<string, number>;
  startTime: number;
}

export interface RetryDecision {
  strategy: RetryStrategy;
  reason: string;
  nextModel?: ModelEntry;
}

// ============================================================
// Memory Types
// ============================================================

export interface RawLog {
  id: string;
  sessionId: string;
  agentRole: AgentRole;
  content: string;
  timestamp: number;
  tokenCount: number;
}

export interface StructuredMemory {
  id: string;
  sessionId: string;
  bug: string;
  investigation: string;
  root_cause: string;
  fix: string;
  reason: string;
  evidence: EvidenceEntry[];
  confidence: number;
  tags: string[];
  files: string[];
  commands: string[];
  created: number;
  updated: number;
  links: MemoryLink[];
}

export type EvidenceType = "observed" | "inferred" | "generated" | "verified";

export interface EvidenceEntry {
  type: EvidenceType;
  content: string;
  source: string;
  timestamp: number;
}

export type LinkType =
  | "same_cause"
  | "derived"
  | "similar_pattern"
  | "related_component";

export interface MemoryLink {
  type: LinkType;
  target: string;
  confidence: number;
}

export interface CompressedEntry {
  id: string;
  originalId: string;
  title: string;
  topics: string[];
  timestamp: number;
  entities: string[];
  files: string[];
  commands: string[];
  errorKeywords: string[];
  importanceScore: number;
  tokenCount: number;
  compressedContent: string;
}

// ============================================================
// Skill Types
// ============================================================

export interface SkillIndex {
  skills: SkillSummary[];
}

export interface SkillSummary {
  name: string;
  description: string;
  tags: string[];
  filePath: string;
}

export interface SkillDef {
  name: string;
  description: string;
  content: string;
  tags: string[];
  version: string;
}

// ============================================================
// Watchdog Types
// ============================================================

export interface WatchdogState {
  consecutiveFailures: Map<string, number>;
  tokenUsage: number[];
  retryCounts: Map<string, number>;
  contextDriftScore: number;
  lastCheck: number;
}

export type WatchdogAction =
  | { type: "force_stop"; reason: string }
  | { type: "warning"; message: string }
  | { type: "model_switch"; reason: string; model: ModelEntry }
  | { type: "compress_suggest"; reason: string };

// ============================================================
// Context Inspector Types
// ============================================================

export interface InspectionResult {
  sameErrorRepeated: boolean;
  purposeForgotten: boolean;
  todoStuck: boolean;
  assumptionFixed: boolean;
  errorChangeUnrecognized: boolean;
  details: string[];
  score: number;
}

// ============================================================
// API Types
// ============================================================

export interface OpenCodeResponse {
  id: string;
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

