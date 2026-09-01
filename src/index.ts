/**
 * Taylor Dynasty — AI Agent Harness
 * One Harness. Any Model. Infinite Possibilities.
 */

/* Core abstraction */
export type {
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  ModelEvent,
  ModelCapabilities,
  ModelPricing,
  TokenUsage,
  CostEstimate,
  ChatMessage,
  ToolCall,
  ToolSpec,
  LeaderboardSignals,
  HarnessModel,
  RoutingStrategy,
  ModelSelection,
  Task,
  TaskRequirements,
  AgentResult,
  AgentObservation,
  ChatRole,
  FinishReason,
} from './types.js';
export { ROUTING_STRATEGIES } from './types.js';

/* Catalog */
export { buildCatalog, ModelCatalog, type CatalogOptions } from './catalog.js';

/* Arena compatibility layer */
export {
  ArenaAdapter,
  type ArenaAdapterOptions,
} from './providers/arena/adapter.js';
export {
  ARENA_LEADERBOARD,
  ARENA_API_BASE,
  fetchArenaLeaderboard,
  getArenaEntry,
  rankedArenaModels,
  type ArenaModelEntry,
} from './providers/arena/model-registry.js';
export {
  meetsCapabilities,
  modelCard,
  compareModels,
  topModels,
  bottomModels,
  formatContext,
  type CapabilityRequirement,
} from './providers/arena/capabilities.js';

/* Providers */
export { HttpProviderAdapter, price, type HttpProviderOptions, type ProviderModelDef } from './providers/http-provider.js';
export { createOpenAIAdapter } from './providers/openai/adapter.js';
export { AnthropicAdapter } from './providers/anthropic/adapter.js';
export { GoogleAdapter, createGoogleAdapter } from './providers/google/adapter.js';
export { MistralAdapter, createMistralAdapter } from './providers/mistral/adapter.js';
export { GroqAdapter, createGroqAdapter } from './providers/groq/adapter.js';
export { XaiAdapter, createXaiAdapter } from './providers/xai/adapter.js';
export { OpenRouterAdapter, createOpenRouterAdapter } from './providers/openrouter/adapter.js';
export { CustomAdapter, createCustomAdapter, SimulatedAdapter, SIM_MODELS } from './providers/custom/adapter.js';
export { OllamaAdapter } from './providers/local/ollama.js';

/* Core: model router & intelligence */
export { ModelRouter, type RouterOptions, type RoleHint } from './core/model-router/router.js';
export { ModelIntelligence, type ResolvedProfile } from './core/model-router/intelligence.js';

/* Core: task engine & planning */
export { createTask } from './core/task-engine/task.js';
export { analyzeTask, type TaskAnalysis } from './core/task-engine/task-analyzer.js';
export { plan, renderPlan, type ExecutionPlan, type PlanStep } from './core/planning/planner.js';
export { ROLES, type RoleDef, type RoleId } from './core/planning/roles.js';

/* Core: agent runtime */
export { Agent, type AgentOptions } from './core/agent-runtime/agent.js';
export { MasterAgent, type RunReport, type MasterAgentOptions } from './core/agent-runtime/master-agent.js';

/* Core: memory */
export { MemoryEngine, type ContextAssembly } from './core/memory/memory-engine.js';
export { WorkingMemory } from './core/memory/working-memory.js';
export { SessionMemory, type SessionMessage } from './core/memory/session-memory.js';
export { LongTermMemory, type LongTermFact } from './core/memory/long-term-memory.js';

/* Core: policies (security) */
export {
  PermissionManager,
  DEFAULT_PERMISSIONS,
  TRUSTED_PERMISSIONS,
  TOOL_PERMISSION,
  type AgentPermissions,
} from './core/policies/permissions.js';
export { ApprovalGate, type Approver, type ApprovalRequest, type ApprovalDecision } from './core/policies/approvals.js';
export { AuditTrail, type AuditEntry, type AuditResult, type AuditApproval } from './core/policies/audit.js';
export { SecretsVault } from './core/policies/secrets-vault.js';

/* Tools */
export { ToolRegistry, sanitizeArgs, type Tool, type ToolResult, type ToolExecutionContext } from './tools/tool.js';
export { createWebSearchTool, SimulatedWebSearchProvider, HttpWebSearchProvider } from './tools/web/web-search.js';
export { createBrowserTool } from './tools/browser/browser.js';
export { createFilesystemTools } from './tools/filesystem/filesystem.js';
export { createCodeTool } from './tools/code/code.js';
export { createShellTool } from './tools/shell/shell.js';
export { createDatabaseTools, InMemoryDatabase } from './tools/database/database.js';
export { createHttpTool } from './tools/http/http.js';

/* Evaluation */
export { computeTdxScore, renderTdxScore, compareWithArena, type ScorecardInput, type TdxScorecard } from './evaluation/scorecard.js';
export { toArenaMetrics, renderArenaMetrics, type ArenaMetricSet } from './evaluation/arena-metrics/arena-metrics.js';
export { BattleLab, renderBattleReport, type BattleReport, type BattleEntry, type BattleLabOptions } from './evaluation/model-comparison/battle-lab.js';
export { HeuristicJudge, ModelJudge, expectedSections, type JudgeResult } from './evaluation/model-comparison/judge.js';
export { RegressionGuard, type Baseline, type RegressionReport } from './evaluation/regression/regression.js';
export { BENCHMARK_TASKS, runBenchmark, renderBenchmark, type BenchmarkReport, type BenchmarkTask } from './evaluation/benchmarks/benchmarks.js';

/* Harness */
export { createHarness, type Harness, type HarnessOptions, type RoleRoute } from './harness.js';
