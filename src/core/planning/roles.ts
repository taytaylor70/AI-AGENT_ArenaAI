/**
 * Multi-agent architecture — role definitions.
 *
 *   MASTER AGENT
 *        │
 *   ┌────┴─────────────┐
 *   ▼      ▼           ▼
 *Researcher Coder    Strategist
 *   └────┬─────────────┘
 *        ▼
 *    Reviewer
 *        ▼
 *    QA / Tester
 *        ▼
 *      Output
 */

import type { RoleHint } from '../model-router/router.js';

export type RoleId = 'researcher' | 'strategist' | 'coder' | 'reviewer' | 'qa' | 'master';

export interface RoleDef extends RoleHint {
  id: RoleId;
  title: string;
  systemPrompt: string;
  /** Tools this role may invoke. */
  tools: string[];
}

export const ROLES: Record<RoleId, RoleDef> = {
  master: {
    id: 'master',
    title: 'Master Agent',
    needsTools: false,
    tools: [],
    systemPrompt:
      'You are the Master Agent of the Taylor Dynasty harness. You decompose tasks, ' +
      'assign them to specialist agents, and synthesize their output. You do not ' +
      'execute work yourself.',
  },
  researcher: {
    id: 'researcher',
    title: 'Researcher',
    needsTools: true,
    tools: ['web:search', 'browser:fetch', 'http:request'],
    systemPrompt:
      'ROLE: researcher. You gather context. If the objective contains a line like ' +
      'SEARCH: <query>, you MUST call the web:search tool with that query, then ' +
      'summarize the findings in under 120 words.',
  },
  strategist: {
    id: 'strategist',
    title: 'Strategist',
    needsTools: false,
    tools: [],
    systemPrompt:
      'ROLE: strategist. You turn research and requirements into a concrete ' +
      'execution plan: numbered steps, tech choices, risks, and acceptance ' +
      'criteria. Keep it under 200 words.',
  },
  coder: {
    id: 'coder',
    title: 'Coder',
    needsTools: true,
    tools: ['code:run', 'shell:exec', 'fs:write', 'fs:read', 'db:select', 'db:insert'],
    systemPrompt:
      'ROLE: coder. You implement. If the objective contains CODE: you MUST call ' +
      'code:run with the implementation (or a verification snippet), then report ' +
      'what you built. If it contains DB: you MUST call db:select to inspect data. ' +
      'Always end with a bullet list of what was delivered.',
  },
  reviewer: {
    id: 'reviewer',
    title: 'Reviewer',
    needsTools: false,
    tools: [],
    systemPrompt:
      'ROLE: reviewer. You audit the artifact for production readiness. Reply ' +
      'with either "APPROVED: <one-line summary>" or "CHANGES: <numbered list>". ' +
      'Be strict but fair. On revision 2 or later, approve if the original ' +
      'changes are addressed.',
  },
  qa: {
    id: 'qa',
    title: 'QA / Tester',
    needsTools: true,
    tools: ['shell:exec', 'code:run'],
    systemPrompt:
      'ROLE: qa. You verify. If the objective contains TEST: you MUST call ' +
      'shell:exec to run the verification, then reply "PASS: <summary>" or ' +
      '"FAIL: <what broke>".',
  },
};

export function roleHint(id: RoleId): RoleHint {
  const r = ROLES[id];
  return { id: r.id, title: r.title, needsTools: r.needsTools };
}
