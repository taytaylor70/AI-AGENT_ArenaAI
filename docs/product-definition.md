# New Product Definition — TAYLOR DYNASTY AI AGENT HARNESS

*Original product definition, preserved verbatim.*

**Tagline:** One Harness. Any Model. Infinite Possibilities.

## Core concept

Instead of building another AI chatbot, we're building a model-independent
agent operating system.

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

The important distinction:

> **Arena is not the harness.**
> Arena becomes one of the harness's model/evaluation ecosystems.

## 2. Arena Compatibility Layer

The architecture gets a new first-class component: **ArenaAdapter**

```
src/
├── core/
│   ├── agent-runtime/
│   ├── task-engine/
│   ├── memory/
│   ├── planning/
│   └── policies/
│
├── providers/
│   ├── arena/
│   │   ├── adapter
│   │   ├── model-registry
│   │   └── capabilities
│   ├── openai/
│   ├── anthropic/
│   ├── google/
│   ├── mistral/
│   ├── groq/
│   ├── xai/
│   ├── openrouter/
│   └── custom/
│
├── tools/
│   ├── web/
│   ├── browser/
│   ├── filesystem/
│   ├── code/
│   ├── shell/
│   ├── database/
│   └── http/
│
├── evaluation/
│   ├── benchmarks/
│   ├── arena-metrics/
│   ├── model-comparison/
│   └── regression/
│
└── ui/
```

## 3. The Model Abstraction

Every model must implement the same internal interface.

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

The application never directly depends on:

- OpenAI
- Anthropic
- Gemini
- Mistral
- Arena

Instead:

```
Agent
  ↓
ModelAdapter
  ↓
Provider
  ↓
Model
```

This is what makes the system expandable.

Arena's current model ecosystem spans hundreds of models; its text
leaderboard currently lists hundreds of publicly available models, while
Agent Arena evaluates dozens of agent-capable models.

## 4. Arena Model Intelligence

This is where the harness becomes one-of-a-kind.

Don't merely display `GPT-5.6 / Claude Opus / Gemini`. Instead create
**Model Intelligence**: every model receives a dynamic profile.

| Signal           | Example    |
|------------------|------------|
| Arena Rank       | #4         |
| Agent Success    | 91.4%      |
| Tool Reliability | 96.2%      |
| Steerability     | 93.8%      |
| Coding           | 97.1%      |
| Reasoning        | 94.5%      |
| Speed            | 1.8s       |
| Estimated Cost   | $0.42/task |
| Context          | 1M         |
| Vision           | ✓          |
| Tools            | ✓          |
| Structured Output| ✓          |

Arena's Agent leaderboard already exposes signals such as confirmed
success, steerability, Bash recovery, tool hallucination, cost/task, and
output tokens/task.

Your harness turns those signals into routing intelligence.

## 5. Intelligent Model Router

This becomes one of the flagship features.

User says: *"Build me a production-ready SaaS application."*

The harness doesn't blindly send that to one model. It evaluates:

```
TASK ANALYZER
      ↓
What type of task?
      ↓
Coding + Architecture + UI + Database
      ↓
MODEL ROUTER
      ↓
┌─────────────┬─────────────┬─────────────┐
│ Architecture│ Coding      │ UI          │
│ Model       │ Model       │ Model       │
└─────────────┴─────────────┴─────────────┘
      ↓
      AGENT
```

Potential strategies:

- **Best** — optimize for maximum quality.
- **Fast** — optimize latency.
- **Cheap** — optimize cost.
- **Balanced** — quality + speed + cost.
- **Arena Champion** — use Arena performance data to select the strongest
  available candidate.
- **Auto** — let the harness determine the routing strategy.

## 6. Multi-Agent Architecture

Instead of one giant agent:

```
                 MASTER AGENT
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   Researcher       Coder       Strategist
        │             │             │
        └─────────────┼─────────────┘
                      ▼
                  Reviewer
                      │
                      ▼
                 QA / Tester
                      │
                      ▼
                   Output
```

This gives the harness actual orchestration capability.

## 7. Arena Evaluation Mode

Add a dedicated mode: **BATTLE LAB**

This is where the harness becomes extremely interesting.

User submits: *"Create a landing page for my AI company."*

Harness can run:

```
        SAME TASK
           │
 ┌─────────┼─────────┐
 ▼         ▼         ▼
Model A   Model B   Model C
 │         │         │
 ▼         ▼         ▼
Output    Output    Output
 └─────────┼─────────┘
           ▼
      EVALUATION
           │
 ┌─────────┼──────────┐
 ▼         ▼          ▼
Quality   Speed      Cost
           │
           ▼
      WINNER MODEL
```

This fits naturally with Arena's side-by-side/model-comparison philosophy.
Arena's model selector supports direct selection across paid, open-source,
and proprietary models.

## 8. Agent Arena Scorecard

Create your own internal score: **TDX Agent Score**

```
TDX SCORE
━━━━━━━━━━━━━━━━━━━━

Task Success       96
Reasoning          94
Tool Reliability   98
Code Quality       95
Recovery            91
Steerability        97
Efficiency          89
Cost                93

TOTAL              94.1
```

And compare that against Arena metrics where available.

This creates a feedback loop:

```
TASK → MODEL → AGENT → TOOLS → RESULT → EVALUATION → SCORE → MODEL ROUTER → NEXT TASK
```

## 9. Production Security Architecture

This needs to be treated as a real agent platform.

**Secrets** — never expose API keys to the browser.

```
Browser
   ↓
Backend
   ↓
Encrypted Secrets Vault
   ↓
Provider
```

**Tool permissions** — every agent gets:

```js
permissions: {
  webSearch: true,
  filesystem: false,
  shell: false,
  database: false,
  externalHttp: true
}
```

**Dangerous operations** — require approval:

```
DELETE
DROP
EXEC
PUBLISH
DEPLOY
SEND
PAY
MODIFY PRODUCTION
```

**Audit trail** — every agent action gets:

```
timestamp
agent
model
tool
arguments
result
duration
tokens
cost
approval
status
```

## 10. Memory Architecture

Use three levels.

- **Working Memory** — current task.
- **Session Memory** — current conversation/project.
- **Long-Term Memory** — persistent knowledge.

```
             MEMORY ENGINE
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
   Working     Session    Long-Term
   Memory      Memory     Knowledge
```

Long-term memory should be selectively retrieved — not dumped into every
prompt.
