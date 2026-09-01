/**
 * Tools — shared interface + registry.
 *
 * The registry is the single choke point where every tool call passes
 * through: permission check → dangerous-operation approval → execution →
 * audit record. No tool is ever invoked outside this path.
 */

import type { AuditEntry, AuditTrail } from '../core/policies/audit.js';
import type { ApprovalGate, ApprovalDecision } from '../core/policies/approvals.js';
import type { PermissionManager, PermissionDecision } from '../core/policies/permissions.js';
import type { ToolSpec } from '../types.js';

export interface ToolResult {
  ok: boolean;
  output: string;
  error?: string;
}

export interface ToolExecutionContext {
  agentId: string;
  modelId: string;
  workspaceRoot: string;
  signal?: AbortSignal;
}

export interface Tool {
  readonly name: string;
  readonly spec: ToolSpec;
  execute(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult>;
}

export interface AuditedToolCall extends AuditEntry {}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor(
    private permissions: PermissionManager,
    private approvals: ApprovalGate,
    private audit: AuditTrail,
  ) {}

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  /** Specs to advertise to a model, limited to the agent's allowed tools. */
  specsForAgent(agentId: string): ToolSpec[] {
    return [...this.tools.values()]
      .filter((t) => this.permissions.check(agentId, t.name).allowed)
      .map((t) => t.spec);
  }

  /**
   * Execute a tool call through the full security pipeline.
   * Returns the ToolResult plus audit/approval metadata.
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<{ result: ToolResult; audit: AuditEntry; approval?: ApprovalDecision; permission?: PermissionDecision }> {
    const started = Date.now();
    const tool = this.tools.get(name);
    const log = (result: AuditEntry['result'], status: string, detail?: string): AuditEntry =>
      this.audit.record({
        agent: ctx.agentId,
        model: ctx.modelId,
        tool: name,
        arguments: sanitizeArgs(args),
        result,
        durationMs: Date.now() - started,
        approval: 'not-required',
        status,
        detail,
      });

    if (!tool) {
      const entry = log('error', `unknown tool "${name}"`);
      return { result: { ok: false, output: '', error: `unknown tool "${name}"` }, audit: entry };
    }

    const permission = this.permissions.check(ctx.agentId, name);
    if (!permission.allowed) {
      const entry = log('denied', `permission denied: ${permission.reason}`);
      return {
        result: { ok: false, output: '', error: `PERMISSION DENIED: ${permission.reason}` },
        audit: { ...entry, approval: 'denied' },
        permission,
      };
    }

    const approval = await this.approvals.requireApproval({
      agentId: ctx.agentId,
      modelId: ctx.modelId,
      tool: name,
      arguments: args,
      detail: `planned ${name} by agent ${ctx.agentId}`,
    });
    if (approval.required && !approval.approved) {
      const entry = log('rejected', `approval rejected: ${approval.reason} (${approval.operations.join(', ')})`);
      return {
        result: { ok: false, output: '', error: `APPROVAL REJECTED: dangerous ops ${approval.operations.join(', ')} — ${approval.reason}` },
        audit: { ...entry, approval: 'denied' },
        approval,
      };
    }

    try {
      const result = await tool.execute(args, ctx);
      const entry = log(result.ok ? 'success' : 'error', result.ok ? 'ok' : result.error ?? 'tool error', result.error);
      return {
        result,
        audit: {
          ...entry,
          approval: approval.required ? (approval.approved ? 'granted' : 'denied') : 'not-required',
        },
        approval,
        permission,
      };
    } catch (err) {
      const entry = log('error', `exception: ${String(err)}`);
      return { result: { ok: false, output: '', error: String(err) }, audit: entry };
    }
  }
}

/** Keep audit logs from leaking secrets or huge payloads. */
export function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    const lk = k.toLowerCase();
    if (/(key|token|secret|password|authorization)/.test(lk)) {
      out[k] = v === undefined ? undefined : '[redacted]';
      continue;
    }
    if (typeof v === 'string' && v.length > 300) {
      out[k] = `${v.slice(0, 300)}…(+${v.length - 300} chars)`;
      continue;
    }
    out[k] = v;
  }
  return out;
}
