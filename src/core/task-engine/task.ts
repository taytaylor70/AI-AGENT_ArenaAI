/**
 * Task engine — task creation.
 */

import type { Task } from '../../types.js';
import { analyzeTask, type TaskAnalysis } from './task-analyzer.js';

let counter = 0;

export function createTask(text: string, constraints: string[] = []): Task {
  const analysis = analyzeTask(text);
  const estimatedTokens = Math.max(256, Math.ceil(text.length / 4) + analysis.complexity * 500);
  return {
    id: `task_${Date.now().toString(36)}_${(counter++).toString(36)}`,
    text: text + (constraints.length ? `\n\nConstraints: ${constraints.join('; ')}` : ''),
    requirements: analysis.requirements,
    riskFlags: analysis.riskFlags,
    hasImages: /\b(image|photo|screenshot|\.png|\.jpg|\.jpeg|vision)\b/i.test(text),
    estimatedTokens,
    createdAt: Date.now(),
  };
}

export function analyze(text: string): TaskAnalysis {
  return analyzeTask(text);
}
