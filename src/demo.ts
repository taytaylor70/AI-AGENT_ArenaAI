/**
 * Taylor Dynasty — AI Agent Harness: end-to-end demo.
 *
 *   npm run demo
 *
 * Runs entirely offline: the Arena leaderboard snapshot drives the
 * routing intelligence, and the `sim` provider models execute the real
 * agent loop (tools, permissions, approvals, audit, scorecard).
 */

import { join } from 'node:path';
import { rmSync, mkdirSync } from 'node:fs';
import { createHarness } from './harness.js';
import { modelCard } from './providers/arena/capabilities.js';
import { toArenaMetrics, renderArenaMetrics } from './evaluation/arena-metrics/arena-metrics.js';
import { renderPlan } from './core/planning/planner.js';

const hr = (t: string): void => {
  console.log(`\n${'═'.repeat(78)}\n${t}\n${'═'.repeat(78)}`);
};

async function main(): Promise<void> {
  console.log(`
  ██████╗██████╗ ██╗██████╗ ████████╗ ██████╗ ███████╗ ██████╗
 ██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔═══██╗██╔════╝██╔═══██╗
 ██║     ██████╔╝██║██████╔╝   ██║   ██║   ██║█████╗  ██║   ██║
 ██║     ██╔══██╗██║██╔═══╝    ██║   ██║   ██║██╔══╝  ██║   ██║
 ╚██████╗██║  ██║██║██║        ██║   ╚██████╔╝███████╗╚██████╔╝
  ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝    ╚═════╝ ╚══════╝ ╚═════╝

  One Harness. Any Model. Infinite Possibilities.`);

  const workspace = join(process.cwd(), '.workspace', 'demo');
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });

  const harness = await createHarness({ workspaceRoot: workspace, online: false });

  /* ------------------------------------------------------------ */
  hr('1. MODEL CATALOG — every ecosystem, one abstraction');
  const top = harness.catalog.topRanked(8);
  console.log(
    [
      `  ${'RANK'.padStart(4)} ${'MODEL'.padEnd(22)}${'PROVIDER'.padEnd(13)}${'SUCCESS'.padEnd(10)}${'SPEED'.padEnd(8)}${'COST/TASK'.padEnd(11)}${'AVAIL'}`,
      ...top.map((m) =>
        `  ${String(m.signals.arenaRank).padStart(4)} ${m.displayName.padEnd(22)}` +
        `${m.catalogId.split(':')[0].padEnd(13)}` +
        `${m.signals.agentSuccess.toFixed(1).padEnd(10)}` +
        `${m.signals.speedSeconds.toFixed(1) + 's'.padEnd(8)}` +
        `$${m.signals.costPerTask.toFixed(2)}`.padEnd(11) +
        (m.available ? 'yes' : '—'),
      ),
      `  ${'sim models (offline, always available)'.padEnd(4)}`,
      ...harness.catalog.list({ provider: 'sim' }).map((m) => `  ${m.catalogId.padEnd(40)} available: yes`),
    ].join('\n'),
  );

  /* ------------------------------------------------------------ */
  hr('2. MODEL INTELLIGENCE — dynamic profile (sample card)');
  console.log(harness.intelligence.card('arena:claude-sonnet-4.5'));

  /* ------------------------------------------------------------ */
  hr('3. TASK ANALYZER → PLANNER');
  const taskText =
    'Build me a production-ready SaaS application: a landing page with a pricing table, ' +
    'a Node.js REST API, and a SQLite-backed user store with auth.';
  const routed = harness.route(taskText, 'auto');
  console.log(`  Task: ${taskText}`);
  console.log(`  Requirements: ${Object.entries(routed.task.requirements).filter(([, v]) => v).map(([k]) => k).join(', ')}`);
  console.log(`  Risk flags: ${routed.task.riskFlags.join(', ') || '(none)'}`);
  console.log(`  Roles: ${routed.roles.map((r) => r.role).join(' → ')}`);

  console.log(`\n  ROUTER DECISIONS (strategy=auto, executable models):`);
  for (const r of routed.roles) {
    console.log(`    ${r.role.padEnd(12)} → ${r.selection.catalogId.padEnd(16)} [${r.selection.effectiveStrategy}] score ${r.selection.score}`);
  }
  const champ = harness.route(taskText, 'arena-champion', { includeUnavailable: true });
  const champPick = champ.roles.find((r) => r.role === 'coder')?.selection;
  console.log(`  arena-champion (full leaderboard intelligence): coder → ${champPick?.catalogId} — ${champPick?.candidates[0]?.reasons.join(', ')}`);

  /* ------------------------------------------------------------ */
  hr('4. MASTER AGENT — multi-agent pipeline (sim models, real loop)');
  const report = await harness.run(taskText);
  console.log(renderPlan(report.plan));
  console.log('\n  EXECUTION:');
  for (const [stepId, res] of report.results) {
    console.log(
      `    [${stepId}] ${res.role.padEnd(11)} via ${res.catalogId.padEnd(14)} ` +
        `${res.success ? 'OK' : 'ERR'}  tools ${res.toolCalls} (fail ${res.toolFailures})  $${res.costUsd.toFixed(4)}  ${res.latencyMs}ms`,
    );
    console.log(`       ${res.content.split('\n')[0].slice(0, 90)}`);
  }

  /* ------------------------------------------------------------ */
  hr('5. TDX AGENT SCORE');
  console.log(report.scorecard.block);

  /* ------------------------------------------------------------ */
  hr('6. BATTLE LAB — same task, three models, one winner');
  const battle = await harness.battleLab.run(
    'Create a landing page for my AI company with a pricing section.',
    ['sim:obsidian', 'sim:atlas', 'sim:herald'],
  );
  console.log(battle.block);

  /* ------------------------------------------------------------ */
  hr('7. FEEDBACK LOOP — intelligence updated by the battle');
  for (const cid of ['sim:obsidian', 'sim:atlas', 'sim:herald']) {
    const p = harness.intelligence.profile(cid);
    console.log(
      `  ${cid.padEnd(14)} observations=${p.observations}  eff.speed=${p.signals.speedSeconds.toFixed(2)}s  eff.cost=$${p.signals.costPerTask.toFixed(4)}/task`,
    );
  }
  console.log(renderArenaMetrics(toArenaMetrics(harness.intelligence.observations()), 'Arena-style metrics (observed this session)'));

  /* ------------------------------------------------------------ */
  hr('8. REGRESSION GUARD — baseline saved');
  harness.regression.save('demo-task', { input: report.scorecard.input, total: report.scorecard.total });
  const reg = harness.regression.evaluate('demo-task', { input: report.scorecard.input, total: report.scorecard.total });
  console.log(harness.regression.renderReport(reg));

  /* ------------------------------------------------------------ */
  hr('9. SECURITY — vault, permissions, approvals, audit');
  harness.vault.put('openai', 'sk-demo-0000000000000000000000000000');
  console.log(`  vault secrets: ${harness.vault.list().join(', ')}`);
  console.log(`  vault.get('openai') → ${harness.vault.get('openai')?.slice(0, 8)}… (encrypted at rest, never sent to the browser)`);
  console.log(harness.approvals.detect('db:delete', { table: 'users', where: { id: 1 } }).join(', ') + '  (would require approval)');
  console.log('\n  ' + harness.audit.summary().split('\n').join('\n  '));
  console.log('\n  recent audit:');
  console.log(harness.audit.render(8).split('\n').map((l) => `  ${l}`).join('\n'));

  /* ------------------------------------------------------------ */
  hr('10. MEMORY — three levels, selective retrieval');
  harness.memory.session('default').add('user', 'I prefer SQLite over Postgres for this SaaS.');
  const ctx = harness.memory.assembleContext('default', 'which database should the user store use', { budgetChars: 600 });
  console.log(`  sources: ${ctx.sources.map((s) => s.level).join(', ') || '(none)'}`);
  console.log(`  ${ctx.block.split('\n')[0]?.slice(0, 100) ?? '(empty)'}`);
  console.log(`  long-term facts stored: ${harness.memory.longTerm.size}`);

  console.log(`\n  Demo complete. Workspace: ${workspace}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
