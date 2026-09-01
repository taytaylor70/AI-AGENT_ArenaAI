# TAYLOR DYNASTY — AI AGENT HARNESS

> **One Harness. Any Model. Infinite Possibilities.**

Instead of building another AI chatbot, this is a **model-independent agent
operating system**. The application never depends on OpenAI, Anthropic,
Gemini, Mistral, Groq, xAI, OpenRouter — or on Arena. It depends on one
interface:

```
Agent  →  ModelAdapter  →  Provider  →  Model
```

```
                 TAYLOR DYNASTY
              AI AGENT HARNESS
                      │
             ┌────────▼────────┐
             │ AGENT RUNTIME   │
             └────────┬────────┘
                      │
             ┌────────▼────────┐
             │ MODEL ROUTER    │
             └────────┬────────┘
                      │
      ┌───────────────┼────────────────┐
      ▼               ▼                ▼
  Arena Models    API Models      Local Models
      │               │                │
      ▼               ▼                ▼
  Arena.ai       OpenAI/etc.       Ollama/etc.
```

**Arena is not the harness.** Arena is one of the harness's
model/evaluation ecosystems — every leaderboard model is addressable through
the `ArenaAdapter`, side by side with direct provider APIs and local runtimes.

---

## Quickstart

```bash
npm install
npm test          # 70 tests — router, agents, security, battle lab, ...
npm run demo      # full offline end-to-end walkthrough
npm run ui        # dashboard → http://localhost:4321
```

The demo and the test suite run **fully offline**: the bundled Arena
leaderboard snapshot drives the routing intelligence, and the `sim` provider
(deterministic models) executes the real agent loop — tools, permissions,
approvals, audit, scoring. Connect real providers by setting keys:

| Provider   | Key env var              |
|------------|--------------------------|
| Arena      | `TDX_ARENA_API_KEY`      |
| OpenAI     | `OPENAI_API_KEY`         |
| Anthropic  | `ANTHROPIC_API_KEY`      |
| Google     | `GEMINI_API_KEY`         |
| Mistral    | `MISTRAL_API_KEY`        |
| Groq       | `GROQ_API_KEY`           |
| xAI        | `XAI_API_KEY`            |
| OpenRouter | `OPENROUTER_API_KEY`     |
| Ollama     | local runtime (`OLLAMA_URL`) |

Keys may also live in the encrypted **Secrets Vault** (`TDX_MASTER_KEY`,
`.vault/secrets.vault.json`) — providers resolve keys server-side from the
vault, and the browser/UI never sees a secret.

---

## The model abstraction

Every model implements the same internal interface:

```ts
interface ModelAdapter {
  id: string;
  provider: string;
  capabilities: ModelCapabilities;

  generate(request: ModelRequest): Promise<ModelResponse>;
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
  estimateCost(usage: TokenUsage): CostEstimate;
}
```

The **catalog** namespaces every model once: `arena:gpt-5.6`,
`openai:gpt-5.6`, `openrouter:deepseek/deepseek-v4`, `sim:atlas`,
`local:llama-4-maverick:131b` — same model, different paths, one list the
router can score.

## Arena Model Intelligence

Every model receives a **dynamic profile** — Arena leaderboard signals
blended with the harness's own observations from real runs:

```
CLAUDE SONNET 4.5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Arena Rank       #5
Agent Success    93.8%
Tool Reliability 96.9%
Steerability     94.6%
Coding           97.1
Reasoning        94.5
Speed            1.8s
Estimated Cost   $0.42/task
Context          1M
Vision           ✓
Tools            ✓
Structured Output ✓
```

The bundled snapshot in `src/providers/arena/model-registry.ts` is a
representative sample of the ecosystem (the live text leaderboard lists
hundreds of models; the Agent Arena evaluates dozens). Set
`TDX_ARENA_API` to refresh the snapshot from a live endpoint.

## Intelligent Model Router

"Build me a production-ready SaaS application" is never blindly sent to one
model. The TaskAnalyzer classifies it, then the router scores every eligible
model per strategy:

| Strategy         | Optimizes                          |
|------------------|------------------------------------|
| `best`           | maximum quality                    |
| `fast`           | latency                            |
| `cheap`          | cost                               |
| `balanced`       | quality + speed + cost (geo-mean)  |
| `arena-champion` | strongest Arena data candidate     |
| `auto`           | the harness decides from the task  |

Roles get their own routing decisions — Architecture, Coding and UI subtasks
can each land on a different model.

## Multi-Agent Architecture

```
            MASTER AGENT
                 │
   ┌─────────────┼─────────────┐
   ▼             ▼             ▼
Researcher       Coder       Strategist
   └─────────────┼─────────────┘
                 ▼
             Reviewer   (one revision loop max)
                 ▼
            QA / Tester
                 ▼
              Output
```

Steps run in dependency waves (parallel where independent); the Reviewer can
send an artifact back to the Coder exactly once before accepting it.

## Battle Lab (Arena Evaluation Mode)

```
         SAME TASK
            │
 ┌──────────┼──────────┐
 ▼          ▼          ▼
Model A   Model B   Model C
 └──────────┼──────────┘
            ▼
       EVALUATION
            │
 ┌──────────┼──────────┐
 ▼          ▼          ▼
Quality    Speed      Cost
            │
            ▼
       WINNER MODEL
```

Same task, N models, parallel execution, judged on quality (heuristic judge
or any model as judge), speed, cost and tool reliability. Results feed
straight back into Model Intelligence.

## TDX Agent Score

```
TDX SCORE
━━━━━━━━━━━━━━━━━━
Task Success       96
Reasoning          94
Tool Reliability   98
Code Quality       95
Recovery           91
Steerability       97
Efficiency         89
Cost               93

TOTAL              94.1
```

Comparable against Arena metrics (`compareWithArena`), and guarded by the
**Regression Guard** which baselines scores per task and flags any metric
that moves beyond the threshold.

## Production Security Architecture

- **Secrets** — AES-256-GCM vault, backend-only. `Browser → Backend → Vault → Provider`.
- **Permissions** — every agent gets an explicit map (`webSearch`,
  `filesystem`, `shell`, `database`, `externalHttp`, ...); roles ship with
  least-privilege defaults.
- **Approvals** — `DELETE DROP EXEC PUBLISH DEPLOY SEND PAY MODIFY
  PRODUCTION` always require an explicit approver; default is deny.
- **Audit trail** — every action recorded: timestamp, agent, model, tool,
  arguments (secrets redacted), result, duration, tokens, cost, approval,
  status. JSONL sink included.

## Memory Architecture

```
             MEMORY ENGINE
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
   Working     Session    Long-Term
   Memory      Memory     Knowledge
```

Prompts get **selective** context: working memory first, then a small
lexical-recall window from the session, then top-k long-term facts — never a
dump. Runs store durable learnings back into long-term memory (the feedback
loop: `TASK → MODEL → AGENT → TOOLS → RESULT → EVALUATION → SCORE →
MODEL ROUTER → NEXT TASK`).

---

## Repository layout

```
src/
├── core/
│   ├── agent-runtime/     Agent, MasterAgent (orchestration)
│   ├── task-engine/       Task, TaskAnalyzer
│   ├── memory/            Working / Session / Long-Term + engine
│   ├── planning/          roles, planner
│   ├── policies/          permissions, approvals, audit, secrets vault
│   └── model-router/      ModelRouter, ModelIntelligence
├── providers/
│   ├── arena/             adapter, model-registry, capabilities
│   ├── openai/  anthropic/  google/  mistral/  groq/  xai/  openrouter/
│   ├── custom/            user endpoints + offline sim models
│   └── local/             Ollama
├── tools/
│   ├── web/  browser/  filesystem/  code/  shell/  database/  http/
├── evaluation/
│   ├── benchmarks/  arena-metrics/  model-comparison/  regression/
└── ui/                    dashboard server + page
```

## Extension: adding a provider

1. Implement `ModelAdapter` (or extend `HttpProviderAdapter` for
   OpenAI-compatible APIs).
2. Register it in `buildCatalog` with its `HarnessModel` entries.
3. Done — router, battle lab, scorecards and the UI pick it up automatically.

## Notes

- The `sim` provider is a deterministic offline model used to prove the full
  agent loop in CI and demos. It is a first-class example of the `custom`
  provider extension point.
- Leaderboard values in the bundled snapshot are a representative sample for
  development; point `TDX_ARENA_API` at a live endpoint for fresh data.
- The in-memory database tool is a stand-in; a deployment swaps it for
  Postgres/SQLite behind the same `Tool` interface.
