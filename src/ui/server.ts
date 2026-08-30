/**
 * Taylor Dynasty harness — dashboard UI server.
 *
 * Zero dependencies. Binds 0.0.0.0 so it works behind the Arena preview
 * proxy. The UI talks only to THIS backend; provider keys live in the
 * vault on the server and never reach the browser.
 *
 *   npm run ui        →  http://localhost:4321  (TDX_UI_PORT to override)
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness, type Harness } from '../harness.js';
import type { RoutingStrategy } from '../types.js';
import { ROUTING_STRATEGIES } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.TDX_UI_PORT ?? 4321);
const HOST = '0.0.0.0';

let harnessPromise: Promise<Harness> | null = null;

function getHarness(): Promise<Harness> {
  if (!harnessPromise) {
    harnessPromise = createHarness({
      workspaceRoot: join(process.cwd(), '.workspace', 'ui'),
      online: process.env.TDX_ONLINE === '1',
      approver: async () => false, // UI never auto-approves dangerous ops
    });
  }
  return harnessPromise;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const h = await getHarness();

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = await readFile(join(__dirname, 'index.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      json(res, 200, { ok: true, models: h.catalog.models.size, available: h.catalog.available().length });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/models') {
      json(
        res,
        200,
        h.catalog
          .list()
          .map((m) => {
            const p = h.intelligence.profile(m.catalogId);
            return {
              catalogId: m.catalogId,
              displayName: m.displayName,
              provider: m.provider,
              kind: m.kind,
              ranked: m.ranked,
              available: m.available,
              arenaRank: p.signals.arenaRank,
              agentSuccess: round1(p.signals.agentSuccess),
              toolReliability: round1(p.signals.toolReliability),
              steerability: round1(p.signals.steerability),
              coding: round1(p.signals.coding),
              reasoning: round1(p.signals.reasoning),
              speedSeconds: round2(p.signals.speedSeconds),
              costPerTask: round2(p.signals.costPerTask),
              context: m.capabilities.contextLength,
              vision: m.capabilities.vision,
              tools: m.capabilities.tools,
              structuredOutput: m.capabilities.structuredOutput,
              observations: p.observations,
            };
          })
          .sort(
            (a, b) =>
              (a.arenaRank || 999) - (b.arenaRank || 999) ||
              (a.provider === 'arena' ? 0 : 1) - (b.provider === 'arena' ? 0 : 1) ||
              a.catalogId.localeCompare(b.catalogId),
          ),
      );
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/card') {
      const model = url.searchParams.get('model') ?? '';
      if (!h.catalog.has(model)) {
        json(res, 404, { error: 'unknown model' });
        return;
      }
      json(res, 200, { model, card: h.intelligence.card(model) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/route') {
      const body = await readBody(req);
      const task = String(body.task ?? '').trim();
      if (!task) {
        json(res, 400, { error: 'task is required' });
        return;
      }
      const strategy = (ROUTING_STRATEGIES as string[]).includes(String(body.strategy))
        ? (String(body.strategy) as RoutingStrategy)
        : 'auto';
      const includeUnavailable = Boolean(body.includeUnavailable);
      const { task: t, roles } = h.route(task, strategy, { includeUnavailable });
      json(res, 200, {
        task: t.text,
        requirements: t.requirements,
        riskFlags: t.riskFlags,
        strategy,
        roles: roles.map((r) => ({
          role: r.role,
          catalogId: r.selection.catalogId,
          displayName: h.catalog.get(r.selection.catalogId).displayName,
          effectiveStrategy: r.selection.effectiveStrategy,
          score: r.selection.score,
          rationale: r.selection.rationale,
          candidates: r.selection.candidates.map((c) => ({
            catalogId: c.catalogId,
            score: c.score,
            quality: c.quality,
            speed: c.speed,
            cost: c.cost,
          })),
        })),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/battle') {
      const body = await readBody(req);
      const task = String(body.task ?? 'Create a landing page for my AI company.').trim();
      const models = Array.isArray(body.models) ? (body.models as string[]).slice(0, 5) : ['sim:obsidian', 'sim:atlas', 'sim:herald'];
      const report = await h.battleLab.run(task, models);
      json(res, 200, {
        task: report.taskText,
        durationMs: report.durationMs,
        winner: report.winner ? { catalogId: report.winner.catalogId, displayName: report.winner.displayName, score: report.winner.score } : null,
        entries: report.entries,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/audit') {
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 30), 100);
      json(res, 200, {
        entries: h.audit
          .query({ limit })
          .slice()
          .reverse()
          .map((e) => ({
            timestamp: e.timestamp,
            agent: e.agent,
            model: e.model,
            tool: e.tool,
            result: e.result,
            approval: e.approval,
            durationMs: e.durationMs,
            tokens: e.tokens ?? null,
            cost: e.cost != null ? round2(e.cost) : null,
            status: e.status,
          })),
        summary: h.audit.summary(),
      });
      return;
    }

    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, 500, { error: String(err) });
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

createServer(handle).listen(PORT, HOST, () => {
  console.log(`Taylor Dynasty harness UI → http://localhost:${PORT} (bound ${HOST})`);
});
