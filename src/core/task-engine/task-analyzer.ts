/**
 * Task engine — TaskAnalyzer.
 *
 *   TASK ANALYZER
 *         ↓
 *   What type of task?
 *         ↓
 *   Coding + Architecture + UI + Database
 *         ↓
 *   MODEL ROUTER (per role)
 */

import type { TaskRequirements } from '../../types.js';

export interface TaskAnalysis {
  requirements: TaskRequirements;
  /** Dominant requirement. */
  primary: keyof TaskRequirements | 'general';
  /** 1 (trivial) .. 5 (system-scale). */
  complexity: number;
  riskFlags: string[];
  /** Roles the master agent should staff, in pipeline order. */
  roles: string[];
}

const KEYWORDS: Record<keyof TaskRequirements, RegExp> = {
  coding: /\b(build|code|implement|function|class|api|endpoint|component|app|saas|service|script|refactor|debug)\b/i,
  architecture: /\b(architecture|architect|design|scalable|scale|microservice|system|production[- ]ready|infrastructure)\b/i,
  ui: /\b(ui|ux|frontend|front-end|landing page|page|css|react|html|design system|component|dashboard)\b/i,
  database: /\b(database|db\b|sql|schema|migrate|table|query|postgres|sqlite|storage|persistence)\b/i,
  research: /\b(research|investigate|compare|analyze|analyse|survey|market|best practice|evaluat)\b/i,
  writing: /\b(write|article|blog|email|copy|documentation|doc\b|summary|report)\b/i,
  data: /\b(data|csv|json|parse|transform|etl|clean)\b/i,
  security: /\b(security|auth|oauth|encrypt|secret|permission|vulnerability)\b/i,
};

const RISK_PATTERNS: Array<[string, RegExp]> = [
  ['DELETE', /\b(delete|drop|remove all|purge|truncate)\b/i],
  ['DROP', /\bdrop (table|database|schema|index)\b/i],
  ['EXEC', /\b(exec|execute|run raw|raw sql|eval)\b/i],
  ['PUBLISH', /\b(publish|release)\b/i],
  ['DEPLOY', /\b(deploy|rollout|ship to production)\b/i],
  ['SEND', /\b(send (email|message|notification|payment)|notify)\b/i],
  ['PAY', /\b(pay|charge|billing|invoice)\b/i],
  ['MODIFY PRODUCTION', /\b(modify|change|update) (production|live|prod)\b/i],
];

export function analyzeTask(text: string): TaskAnalysis {
  const requirements = {} as TaskRequirements;
  let primary: TaskAnalysis['primary'] = 'general';
  let primaryHits = 0;
  let score = 0;

  for (const key of Object.keys(KEYWORDS) as Array<keyof TaskRequirements>) {
    const hits = (text.match(new RegExp(KEYWORDS[key].source, 'gi')) ?? []).length;
    requirements[key] = hits > 0;
    score += hits;
    if (hits > primaryHits) {
      primaryHits = hits;
      primary = key;
    }
  }

  // Complexity: number of active requirement areas + size signal.
  const active = Object.values(requirements).filter(Boolean).length;
  let complexity = active >= 5 ? 5 : active >= 4 ? 4 : active >= 3 ? 3 : active >= 2 ? 2 : 1;
  if (/\b(production[- ]ready|enterprise|full[- ]stack|system)\b/i.test(text)) complexity = Math.max(complexity, 4);
  if (/\b(trivial|simple|quick|small)\b/i.test(text) && active <= 1) complexity = 1;

  const riskFlags = RISK_PATTERNS.filter(([, re]) => re.test(text)).map(([flag]) => flag);

  const roles: string[] = [];
  if (requirements.research) roles.push('researcher');
  if (complexity >= 2 || requirements.architecture) roles.push('strategist');
  if (requirements.coding || requirements.ui || requirements.database) roles.push('coder');
  if (complexity >= 2) roles.push('reviewer');
  if (requirements.coding || requirements.database || /\b(test|qa)\b/i.test(text)) roles.push('qa');
  if (roles.length === 0) roles.push('strategist');

  return { requirements, primary, complexity, riskFlags, roles };
}
