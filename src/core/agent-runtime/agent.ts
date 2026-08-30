/**
 * Agent runtime — a single role-bound agent.
 *
 *   Agent -> ModelRouter -> ModelAdapter -> Provider -> Model
 *
 * The agent loop:
 *   1. select a model for (task, role, strategy)
 *   2. build the prompt (role system prompt + selective memory + objective)
 *   3. generate; if the model calls tools, pass each call through the
 *      security pipeline (permission -> approval -> audit) and continue
 *   4. record the observation into Model Intelligence (feedback loop)
 *   5. record the agent run in the audit trail
 */

import type {
  AgentResult,
  ChatMessage,
  ModelResponse,
  RoutingStrategy,
  Task,
  TokenUsage,
} from '../../types.js';
import type { ModelCatalog } from '../../catalog.js';
import type { ModelRouter } from '../model-router/router.js';
import type { ModelIntelligence } from '../model-router/intelligence.js';
import type { ToolRegistry } from '../../tools/tool.js';
import type { MemoryEngine } from '../memory/memory-engine.js';
import type { AuditTrail } from '../policies/audit.js';
import type { PermissionManager } from '../policies/permissions.js';
import type { ApprovalGate } from '../policies/approvals.js';
import type { RoleDef } from '../planning/roles.js';
import { price } from '../../providers/http-provider.js';

export interface AgentOptions {
  id: string;
  role: RoleDef;
  catalog: ModelCatalog;
  intelligence: ModelIntelligence;
  router: ModelRouter;
  tools: ToolRegistry;
  memory: MemoryEngine;
  audit: AuditTrail;
  permissions: PermissionManager;
  approvals: ApprovalGate;
  workspaceRoot: string;
  projectId?: string;
  strategy?: RoutingStrategy;
  /** Battle Lab: pin this agent to a specific catalog model. */
  forceModelId?: string;
  maxToolRounds?: number;
}

export class Agent {
  readonly id: string;
  readonly role: RoleDef;
  private catalog: ModelCatalog;
  private intelligence: ModelIntelligence;
  private router: ModelRouter;
  private tools: ToolRegistry;
  private memory: MemoryEngine;
  private audit: AuditTrail;
  private permissions: PermissionManager;
  private approvals: ApprovalGate;
  private workspaceRoot: string;
  private projectId: string;
  private strategy?: RoutingStrategy;
  private forceModelId?: string;
  private maxToolRounds: number;

  constructor(opts: AgentOptions) {
    this.id = opts.id;
    this.role = opts.role;
    this.catalog = opts.catalog;
    this.intelligence = opts.intelligence;
    this.router = opts.router;
    this.tools = opts.tools;
    this.memory = opts.memory;
    this.audit = opts.audit;
    this.permissions = opts.permissions;
    this.approvals = opts.approvals;
    this.workspaceRoot = opts.workspaceRoot;
    this.projectId = opts.projectId ?? 'default';
    this.strategy = opts.strategy;
    this.forceModelId = opts.forceModelId;
    this.maxToolRounds = opts.maxToolRounds ?? 6;
    this.permissions.forAgent(this.id, this.permissions.forRole(this.role.id));
  }

  async execute(objective: string, task: Task, overrideStrategy?: RoutingStrategy): Promise<AgentResult> {
    const started = Date.now();
    const projectId = this.projectId;
    this.memory.session(projectId).add('user', objective);

    /* 1. routing */
    let catalogId: string;
    let selection: { catalogId: string; model: string; rationale: string } | null = null;
    if (this.forceModelId) {
      catalogId = this.forceModelId;
    } else {
      const sel = this.router.select(task, this.role, overrideStrategy ?? this.strategy);
      catalogId = sel.catalogId;
      selection = { catalogId: sel.catalogId, model: sel.model, rationale: sel.rationale };
    }
    const model = this.catalog.get(catalogId);
    const adapter = this.catalog.adapterFor(catalogId);

    /* 2. prompt — the role marker is part of the user message so models
       (including the offline sim provider) can branch on it. */
    const mem = this.memory.assembleContext(projectId, objective, { budgetChars: 2200 });
    const messages: ChatMessage[] = [
      { role: 'system', content: this.role.systemPrompt + (mem.block ? `\n\n${mem.block}` : '') },
      { role: 'user', content: `ROLE: ${this.role.id}\n${objective}` },
    ];

    /* 3. model loop */
    const specs = this.tools.specsForAgent(this.id);
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let costUsd = 0;
    let toolCalls = 0;
    let toolFailures = 0;
    let success = false;
    let error: string | undefined;
    let content = '';

    for (let round = 0; round < this.maxToolRounds; round++) {
      const resp: ModelResponse = await adapter.generate({
        model: model.model,
        messages,
        tools: specs.length ? specs : undefined,
        temperature: 0.3,
      });
      usage.inputTokens += resp.usage.inputTokens;
      usage.outputTokens += resp.usage.outputTokens;
      costUsd += this.catalog.get(catalogId).pricing
        ? price(resp.usage, this.catalog.get(catalogId).pricing).total
        : 0;

      if (resp.toolCalls.length === 0) {
        success = true;
        content = resp.content;
        break;
      }

      messages.push({ role: 'assistant', content: resp.content || '', name: 'tool_call' });
      for (const tc of resp.toolCalls) {
        toolCalls++;
        const exec = await this.tools.execute(tc.name, tc.arguments, {
          agentId: this.id,
          modelId: catalogId,
          workspaceRoot: this.workspaceRoot,
        });
        if (!exec.result.ok) toolFailures++;
        messages.push({
          role: 'tool',
          name: tc.name,
          toolCallId: tc.id,
          content: exec.result.ok ? exec.result.output : `ERROR: ${exec.result.error}`,
        });
      }
    }

    if (!success) {
      error = `exceeded ${this.maxToolRounds} tool rounds without a final answer`;
    }

    /* 4. feedback loop */
    this.intelligence.recordObservation({
      catalogId,
      latencyMs: Date.now() - started,
      success,
      toolCalls,
      toolFailures,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
      at: Date.now(),
    });

    /* 5. audit */
    this.audit.record({
      agent: this.id,
      model: catalogId,
      tool: 'agent.run',
      arguments: { objective: objective.slice(0, 160), role: this.role.id, ...(selection ? { route: selection.rationale } : {}) },
      result: success ? 'success' : 'error',
      durationMs: Date.now() - started,
      tokens: usage.inputTokens + usage.outputTokens,
      cost: costUsd,
      approval: 'not-required',
      status: success ? `${toolCalls} tool call(s), ${toolFailures} failure(s)` : error ?? 'failed',
    });

    this.memory.session(projectId).add('assistant', content.split('\n')[0].slice(0, 200) || '(no content)');

    const result: AgentResult = {
      agentId: this.id,
      role: this.role.id,
      catalogId,
      objective,
      content,
      toolCalls,
      toolFailures,
      usage,
      costUsd,
      latencyMs: Date.now() - started,
      success,
      error,
    };
    return result;
  }
}
