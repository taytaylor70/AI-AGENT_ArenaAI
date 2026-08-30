/**
 * createHarness — wires every component of the Taylor Dynasty harness
 * together. This is the only thing the demo, the UI and tests build.
 *
 *   AGENT RUNTIME
 *        │
 *   MODEL ROUTER
 *        │
 *   ┌────┼──────────────────┐
 *   ▼    ▼                  ▼
 * Arena  API Models     Local Models
 */

import { join } from 'node:path';
import type { ModelSelection, RoutingStrategy, Task } from './types.js';
import { buildCatalog } from './catalog.js';
import { ModelIntelligence } from './core/model-router/intelligence.js';
import { ModelRouter } from './core/model-router/router.js';
import { MasterAgent } from './core/agent-runtime/master-agent.js';
import { BattleLab } from './evaluation/model-comparison/battle-lab.js';
import { RegressionGuard } from './evaluation/regression/regression.js';
import { ToolRegistry } from './tools/tool.js';
import { createWebSearchTool, HttpWebSearchProvider, SimulatedWebSearchProvider } from './tools/web/web-search.js';
import { createBrowserTool } from './tools/browser/browser.js';
import { createFilesystemTools } from './tools/filesystem/filesystem.js';
import { createCodeTool } from './tools/code/code.js';
import { createShellTool } from './tools/shell/shell.js';
import { createDatabaseTools, InMemoryDatabase } from './tools/database/database.js';
import { createHttpTool } from './tools/http/http.js';
import { MemoryEngine } from './core/memory/memory-engine.js';
import { AuditTrail } from './core/policies/audit.js';
import { PermissionManager, TRUSTED_PERMISSIONS, type AgentPermissions } from './core/policies/permissions.js';
import { ApprovalGate, type Approver } from './core/policies/approvals.js';
import { SecretsVault } from './core/policies/secrets-vault.js';
import { createTask } from './core/task-engine/task.js';
import { analyzeTask } from './core/task-engine/task-analyzer.js';
import { ROLES, type RoleId } from './core/planning/roles.js';
import type { RunReport } from './core/agent-runtime/master-agent.js';

export interface HarnessOptions {
  workspaceRoot?: string;
  /** Enable real outbound web tools (search/browser). */
  online?: boolean;
  /** Human/policy approver for dangerous operations. Default: deny. */
  approver?: Approver;
  /** Operations to auto-approve without the approver. */
  autoApproveOperations?: string[];
  /** Default permission set for agents without a role mapping. */
  defaultPermissions?: AgentPermissions;
  auditJsonlPath?: string;
  longTermPath?: string;
  projectId?: string;
  seedDemoData?: boolean;
  arenaApiKey?: string;
  refreshLeaderboard?: boolean;
  /** Built-in sim model options (latency scale, deterministic no-failures). */
  simOptions?: { latencyScale?: number; noFailures?: boolean };
  /** Fixed routing strategy for all agents in this harness. */
  strategy?: RoutingStrategy;
}

export interface RoleRoute {
  role: RoleId;
  selection: ModelSelection;
}

export interface Harness {
  catalog: Awaited<ReturnType<typeof buildCatalog>>;
  intelligence: ModelIntelligence;
  router: ModelRouter;
  /** Router variant that also shows unavailable models (intelligence view). */
  intelRouter: ModelRouter;
  tools: ToolRegistry;
  memory: MemoryEngine;
  audit: AuditTrail;
  permissions: PermissionManager;
  approvals: ApprovalGate;
  vault: SecretsVault;
  masterAgent: MasterAgent;
  battleLab: BattleLab;
  regression: RegressionGuard;
  workspaceRoot: string;
  db: InMemoryDatabase;
  run(taskText: string, constraints?: string[]): Promise<RunReport>;
  route(
    taskText: string,
    strategy?: RoutingStrategy,
    opts?: { includeUnavailable?: boolean },
  ): { task: Task; roles: RoleRoute[] };
}

export async function createHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const workspaceRoot = opts.workspaceRoot ?? join(process.cwd(), '.workspace');
  const vault = new SecretsVault({});
  const audit = new AuditTrail(opts.auditJsonlPath ?? join(workspaceRoot, 'audit.jsonl'));
  const permissions = new PermissionManager(opts.defaultPermissions ?? TRUSTED_PERMISSIONS);
  const approvals = new ApprovalGate(
    opts.approver ?? (async () => false),
    opts.autoApproveOperations ?? [],
  );

  const catalog = await buildCatalog({
    arenaApiKey: opts.arenaApiKey,
    refreshLeaderboard: opts.refreshLeaderboard,
    simOptions: opts.simOptions,
  });
  const intelligence = new ModelIntelligence(catalog);
  const router = new ModelRouter(catalog, intelligence, { defaultStrategy: 'balanced', requireAvailable: true });
  const intelRouter = new ModelRouter(catalog, intelligence, {
    defaultStrategy: 'balanced',
    requireAvailable: false,
  });

  const tools = new ToolRegistry(permissions, approvals, audit);
  const online = opts.online ?? process.env.TDX_ONLINE === '1';
  const searchProvider = online ? new HttpWebSearchProvider() : new SimulatedWebSearchProvider();
  tools.register(createWebSearchTool(searchProvider));
  tools.register(createBrowserTool());
  for (const t of createFilesystemTools()) tools.register(t);
  tools.register(createCodeTool());
  tools.register(createShellTool());

  const db = new InMemoryDatabase();
  if (opts.seedDemoData !== false) {
    db.create('users');
    db.insert('users', { id: 1, email: 'ada@example.com', plan: 'pro' });
    db.insert('users', { id: 2, email: 'grace@example.com', plan: 'free' });
    db.insert('users', { id: 3, email: 'alan@example.com', plan: 'pro' });
  }
  for (const t of createDatabaseTools(db)) tools.register(t);
  tools.register(createHttpTool());

  const memory = new MemoryEngine({
    projectSessionId: opts.projectId ?? 'default',
    longTermPath: opts.longTermPath ?? join(workspaceRoot, 'long-term.json'),
  });

  const masterAgent = new MasterAgent({
    catalog, intelligence, router, tools, memory, audit, permissions, approvals, workspaceRoot,
    projectId: opts.projectId ?? 'default',
    strategy: opts.strategy,
  });
  const battleLab = new BattleLab({
    catalog, intelligence, tools, memory, audit, permissions, approvals, workspaceRoot,
  });
  const regression = new RegressionGuard(join(workspaceRoot, 'regression-baseline.json'));

  const harness: Harness = {
    catalog, intelligence, router, intelRouter, tools, memory, audit, permissions,
    approvals, vault, masterAgent, battleLab, regression, workspaceRoot, db,
    run: (taskText, constraints) => masterAgent.run(taskText, constraints),
    route: (taskText, strategy, opts) => {
      const task = createTask(taskText);
      const analysis = analyzeTask(taskText);
      const active = opts?.includeUnavailable ? intelRouter : router;
      const roles: RoleRoute[] = analysis.roles.map((r) => ({
        role: r as RoleId,
        selection: active.select(task, ROLES[r as RoleId], strategy),
      }));
      return { task, roles };
    },
  };
  return harness;
}
