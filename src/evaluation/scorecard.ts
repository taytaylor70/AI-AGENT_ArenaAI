/**
 * TDX Agent Score — the harness's own internal scorecard.
 *
 *   TDX SCORE
 *   ━━━━━━━━━━━━━━━━━━━━
 *   Task Success       96
 *   Reasoning          94
 *   Tool Reliability   98
 *   Code Quality       95
 *   Recovery           91
 *   Steerability       97
 *   Efficiency         89
 *   Cost               93
 *
 *   TOTAL              94.1
 *
 * Scores are compared against Arena metrics where available, closing the
 * feedback loop: the next task routes with fresher intelligence.
 */

export interface ScorecardInput {
  taskSuccess: number;
  reasoning: number;
  toolReliability: number;
  codeQuality: number;
  recovery: number;
  steerability: number;
  efficiency: number;
  cost: number;
}

export interface TdxScorecard {
  input: ScorecardInput;
  total: number;
}

const WEIGHTS: Record<keyof ScorecardInput, number> = {
  taskSuccess: 0.2,
  reasoning: 0.1,
  toolReliability: 0.15,
  codeQuality: 0.15,
  recovery: 0.1,
  steerability: 0.1,
  efficiency: 0.1,
  cost: 0.1,
};

export function computeTdxScore(input: ScorecardInput): TdxScorecard {
  const clamped = (n: number) => Math.max(0, Math.min(100, n));
  const total =
    Object.entries(WEIGHTS).reduce((n, [k, w]) => n + clamped(input[k as keyof ScorecardInput]) * w, 0);
  return { input, total: Math.round(total * 10) / 10 };
}

export function renderTdxScore(card: TdxScorecard): string {
  const i = card.input;
  const row = (label: string, v: number) => `${label.padEnd(18)} ${v.toFixed(0).padStart(3)}`;
  return [
    'TDX SCORE',
    `${'━'.repeat(18)}`,
    row('Task Success', i.taskSuccess),
    row('Reasoning', i.reasoning),
    row('Tool Reliability', i.toolReliability),
    row('Code Quality', i.codeQuality),
    row('Recovery', i.recovery),
    row('Steerability', i.steerability),
    row('Efficiency', i.efficiency),
    row('Cost', i.cost),
    '',
    `${'TOTAL'.padEnd(18)} ${card.total.toFixed(1)}`,
  ].join('\n');
}

/** Compare a TDX scorecard against a model's Arena signals. */
export function compareWithArena(card: TdxScorecard, arena: {
  agentSuccess: number;
  toolReliability: number;
  steerability: number;
  coding: number;
  reasoning: number;
  bashRecovery: number;
}): string {
  const rows: Array<[string, number, number]> = [
    ['Task Success / Confirmed Success', card.input.taskSuccess, arena.agentSuccess],
    ['Tool Reliability', card.input.toolReliability, arena.toolReliability],
    ['Steerability', card.input.steerability, arena.steerability],
    ['Code Quality / Coding', card.input.codeQuality, arena.coding],
    ['Recovery / Bash Recovery', card.input.recovery, arena.bashRecovery],
    ['Reasoning', card.input.reasoning, arena.reasoning],
  ];
  const lines = rows.map(([label, tdx, ar]) => {
    const delta = tdx - ar;
    return `${label.padEnd(34)} TDX ${tdx.toFixed(1).padStart(5)}  Arena ${ar.toFixed(1).padStart(5)}  ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`;
  });
  return `TDX vs Arena\n${'─'.repeat(70)}\n${lines.join('\n')}`;
}
