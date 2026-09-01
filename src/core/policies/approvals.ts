/**
 * Dangerous-operation approval gate.
 *
 * These operations ALWAYS require explicit approval before execution:
 *
 *   DELETE   DROP   EXEC   PUBLISH   DEPLOY   SEND   PAY   MODIFY PRODUCTION
 *
 * The gate inspects the tool + its arguments, flags the offending
 * operations, and defers to a pluggable Approver (human-in-the-loop,
 * policy engine, ...). Default behavior is deny.
 */

export interface ApprovalRequest {
  agentId: string;
  modelId: string;
  tool: string;
  arguments: Record<string, unknown>;
  operations: string[];
  detail: string;
  at: number;
}

export type Approver = (req: ApprovalRequest) => Promise<boolean>;

export interface ApprovalDecision {
  required: boolean;
  operations: string[];
  approved: boolean;
  reason?: string;
}

type OpTest = (tool: string, args: Record<string, unknown>) => boolean;

function cmd(args: Record<string, unknown>): string {
  return String(args.command ?? '');
}

const OPERATIONS: Array<{ name: string; test: OpTest }> = [
  {
    name: 'DELETE',
    test: (tool, args) =>
      tool === 'fs:delete' ||
      tool === 'db:delete' ||
      /\bDELETE\s+FROM\b/i.test(String(args.sql ?? args.query ?? '')) ||
      /\bDELETE\s+FROM\b/i.test(cmd(args)),
  },
  {
    name: 'DROP',
    test: (tool, args) =>
      tool === 'db:drop' ||
      /\bDROP\s+(TABLE|DATABASE|SCHEMA|INDEX)\b/i.test(String(args.sql ?? args.query ?? '')) ||
      /\bDROP\s+(TABLE|DATABASE)\b/i.test(cmd(args)),
  },
  {
    name: 'EXEC',
    test: (_tool, args) =>
      /\b(sudo|rm\s+-rf\s+\/|dd\s+if=|mkfs|shutdown|reboot|chmod\s+-R\s+777|curl\s+.*\|\s*(ba)?sh)\b/i.test(
        String(args.command ?? ''),
      ),
  },
  {
    name: 'PUBLISH',
    test: (tool, args) =>
      tool === 'deploy:publish' || /\b(publish|release)\b/i.test(String(args.action ?? cmd(args))),
  },
  {
    name: 'DEPLOY',
    test: (tool, args) =>
      tool === 'deploy:run' || /\bdeploy(ment)?\b/i.test(String(args.action ?? cmd(args))),
  },
  {
    name: 'SEND',
    test: (_tool, args) =>
      /\b(send|email|notify)\b/i.test(String(args.action ?? cmd(args))) &&
      /\b(email|message|notification|to)\b/i.test(JSON.stringify(args)),
  },
  {
    name: 'PAY',
    test: (_tool, args) =>
      /\b(charge|payment|billing|invoice|transfer)\b/i.test(
        String(args.action ?? args.amount ?? cmd(args)),
      ),
  },
  {
    name: 'MODIFY PRODUCTION',
    test: (_tool, args) =>
      /\b(production|prod|live)\b/i.test(
        String(args.environment ?? args.target ?? cmd(args)),
      ) && /\b(modify|change|update|alter|write|set)\b/i.test(
        String(args.action ?? cmd(args) ?? JSON.stringify(args)),
      ),
  },
];

export class ApprovalGate {
  constructor(
    private approver: Approver = async () => false,
    private autoApproveOperations: string[] = [],
  ) {}

  /** Which dangerous operations does this call perform? */
  detect(tool: string, args: Record<string, unknown>): string[] {
    return OPERATIONS.filter((op) => op.test(tool, args)).map((op) => op.name);
  }

  /**
   * Check a planned tool call. Non-dangerous calls pass through with
   * `required: false`. Dangerous calls are routed to the Approver.
   */
  async requireApproval(req: Omit<ApprovalRequest, 'at' | 'operations'>): Promise<ApprovalDecision> {
    const operations = this.detect(req.tool, req.arguments);
    if (operations.length === 0) {
      return { required: false, operations: [], approved: true };
    }
    const full: ApprovalRequest = { ...req, operations, at: Date.now() };
    if (operations.length > 0 && operations.every((op) => this.autoApproveOperations.includes(op))) {
      return { required: true, operations, approved: true, reason: 'auto-approved by policy' };
    }
    try {
      const approved = await this.approver(full);
      return {
        required: true,
        operations,
        approved,
        reason: approved ? 'approved by operator' : 'denied by operator',
      };
    } catch (err) {
      return { required: true, operations, approved: false, reason: `approver error: ${String(err)}` };
    }
  }
}
