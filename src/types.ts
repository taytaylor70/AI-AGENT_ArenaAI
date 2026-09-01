/**
 * TAYLOR DYNASTY — AI Agent Harness
 * Core shared types.
 *
 * The application never depends directly on OpenAI, Anthropic, Gemini,
 * Mistral, Groq, xAI, OpenRouter or Arena. It depends only on the
 * `ModelAdapter` interface below.
 *
 *   Agent  ->  ModelAdapter  ->  Provider  ->  Model
 */

/* ------------------------------------------------------------------ */
/* Capabilities & pricing                                              */
/* ------------------------------------------------------------------ */

export interface ModelCapabilities {
  contextLength: number;
  vision: boolean;
  tools: boolean;
  structuredOutput: boolean;
  streaming: boolean;
}

export interface ModelPricing {
  /** USD per 1M input tokens */
  inputPerM: number;
  /** USD per 1M output tokens */
  outputPerM: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CostEstimate {
  input: number;
  output: number;
  total: number;
  currency: 'USD';
}

/* ------------------------------------------------------------------ */
/* Model request / response                                            */
/* ------------------------------------------------------------------ */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Tool call id (role === 'tool') or tool name (role === 'assistant' w/ tool calls) */
  name?: string;
  toolCallId?: string;
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  enum?: string[];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelRequest {
  /** Provider-native model id, e.g. "gpt-5.6" (not the harness catalog id). */
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type ModelEventType = 'delta' | 'tool_call' | 'usage' | 'done' | 'error';

export interface ModelEvent {
  type: ModelEventType;
  text?: string;
  toolCall?: ToolCall;
  usage?: TokenUsage;
  error?: string;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'error';

export interface ModelResponse {
  id: string;
  model: string;
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  finishReason: FinishReason;
  latencyMs: number;
  raw?: unknown;
}

/* ------------------------------------------------------------------ */
/* THE model abstraction                                               */
/* ------------------------------------------------------------------ */

export interface ModelAdapter {
  /** Harness-level adapter id, e.g. "arena", "openai", "sim". */
  readonly id: string;
  /** Provider identifier, e.g. "openai". */
  readonly provider: string;
  capabilities: ModelCapabilities;
  /** Native model ids this adapter can serve. */
  readonly models: string[];

  generate(request: ModelRequest): Promise<ModelResponse>;

  stream(request: ModelRequest): AsyncIterable<ModelEvent>;

  estimateCost(usage: TokenUsage): CostEstimate;
}

/* ------------------------------------------------------------------ */
/* Arena leaderboard signals -> Model Intelligence                     */
/* ------------------------------------------------------------------ */

export interface LeaderboardSignals {
  /** 1-based arena rank; 0 = not ranked. */
  arenaRank: number;
  /** Confirmed agent success, 0-100 */
  agentSuccess: number;
  /** Tool reliability, 0-100 */
  toolReliability: number;
  /** Steerability, 0-100 */
  steerability: number;
  /** Coding, 0-100 */
  coding: number;
  /** Reasoning, 0-100 */
  reasoning: number;
  /** Bash / command recovery, 0-100 */
  bashRecovery: number;
  /** Tool hallucination rate, 0-100 (lower is better) */
  toolHallucination: number;
  /** p50 response latency in seconds */
  speedSeconds: number;
  /** Estimated USD per task */
  costPerTask: number;
  /** Average output tokens per task */
  outputTokensPerTask: number;
}

export type ModelKind = 'proprietary' | 'open-source' | 'hybrid' | 'simulated';

export interface HarnessModel {
  /** Namespaced catalog id, e.g. "arena:gpt-5.6", "openai:gpt-5.6", "sim:atlas". */
  catalogId: string;
  /** Which adapter/provider serves it. */
  provider: string;
  /** Provider-native model id. */
  model: string;
  displayName: string;
  kind: ModelKind;
  capabilities: ModelCapabilities;
  pricing: ModelPricing;
  signals: LeaderboardSignals;
  /** Present on the Arena leaderboard. */
  ranked: boolean;
  /** Can actually be executed right now (adapter configured + reachable). */
  available: boolean;
  notes?: string;
}

/* ------------------------------------------------------------------ */
/* Tasks & routing                                                     */
/* ------------------------------------------------------------------ */

export interface Task {
  id: string;
  text: string;
  requirements: TaskRequirements;
  riskFlags: string[];
  hasImages: boolean;
  estimatedTokens: number;
  createdAt: number;
}

export interface TaskRequirements {
  coding: boolean;
  architecture: boolean;
  ui: boolean;
  database: boolean;
  research: boolean;
  writing: boolean;
  data: boolean;
  security: boolean;
}

export type RoutingStrategy =
  | 'best'
  | 'fast'
  | 'cheap'
  | 'balanced'
  | 'arena-champion'
  | 'auto';

export const ROUTING_STRATEGIES: RoutingStrategy[] = [
  'best',
  'fast',
  'cheap',
  'balanced',
  'arena-champion',
  'auto',
];

export interface ScoredCandidate {
  catalogId: string;
  score: number;
  quality: number;
  speed: number;
  cost: number;
  arenaRank: number;
  reasons: string[];
}

export interface ModelSelection {
  catalogId: string;
  provider: string;
  model: string;
  strategy: RoutingStrategy;
  effectiveStrategy: RoutingStrategy;
  score: number;
  candidates: ScoredCandidate[];
  rationale: string;
}

/* ------------------------------------------------------------------ */
/* Agent results                                                       */
/* ------------------------------------------------------------------ */

export interface AgentObservation {
  catalogId: string;
  latencyMs: number;
  success: boolean;
  toolCalls: number;
  toolFailures: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  at: number;
}

export interface AgentResult {
  agentId: string;
  role: string;
  catalogId: string;
  objective: string;
  content: string;
  toolCalls: number;
  toolFailures: number;
  usage: TokenUsage;
  costUsd: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}
