# TradingAgents — roadmap hub

This file is the **entry point**. Detailed planning is split so engineers and production/release concerns do not share one overloaded document.

| Document | Audience | Contents |
|----------|----------|----------|
| [**docs/ROADMAP_DEV.md**](docs/ROADMAP_DEV.md) | Contributors, implementers | Phases 1–9, codebase snapshot, **excellence backlog (reproducibility, agents, workflow)**, terminal UX, refactor priorities, timelines |
| [**docs/ROADMAP_PRODUCTION.md**](docs/ROADMAP_PRODUCTION.md) | Shipping, security, future cloud | Positioning, phases 10–14, **excellence criteria (privacy, compliance framing, ops)**, MVP checklist, production readiness |

**Last reviewed:** 2026-05-11.

---

## Product north star

TradingAgents should become a **world-class AI Crypto Research Workstation** — a local-first (and optionally cloud-synced) **Trading Copilot** that serious retail and semi-pro crypto traders trust for **repeatable, auditable research**, not for “set and forget” automation.

The **realistic final product** is:

> A research workspace that ingests market + on-chain + sentiment context, runs specialized agents with clear roles, surfaces **signal provenance** and **contradictions**, produces a **structured trade thesis** with explicit invalidation, persists every run in a **decision journal**, and closes the loop with **outcome review** — so traders improve judgment over time.

It should **not** be positioned as:

> An autonomous live-trading bot, AI hedge fund, or black-box alpha printer.

### Moat (why this wins)

The durable advantage is **not** one-shot LLM calls or secret prompts. It is:

- **Structured memory** — journal, runs, theses, decisions, timelines (not disposable chat).
- **Explainability** — every signal and stance is attributable to data + agent output + timestamps.
- **Workflow** — same serious traders use daily: research → thesis → track → invalidate → learn.
- **Trust** — no hidden execution; assisted steps are explicit, confirmable, and logged when they exist.

---

## What “world-class” means (bar for the shipped product)

The workstation is **great** when a user can, without code changes:

| Dimension | Excellent looks like |
|-----------|---------------------|
| **Research depth** | Multi-agent pipeline (market, context, news/sentiment, on-chain) + quant layer; outputs are **actionable** and **conflict-aware**, not generic summaries. |
| **Provenance** | Any signal or thesis line can be traced to **source, freshness, and evidence** (including “what would change my mind”). |
| **Thesis quality** | Every thesis ships with **direction, confidence, invalidation**, and links to supporting / contradicting signals and debate outcomes. |
| **Journal** | SQLite (or equivalent) is the **source of truth** for runs and decisions; exports (Markdown/PDF) are snapshots, not canonical state. |
| **Operability** | CLI/TUI is fast, scriptable, and observable — configs validated, failures explicit, logs redacted, timelines inspectable. |
| **Safety** | Product rules below are true in UX and code paths — not marketing copy. |
| **Reproducibility** | Same ticker + date + config pins yields **auditable** artifacts; replay/historical modes obey **no-lookahead** contracts where claimed. |
| **Model & cost governance** | Token/latency budgets per pipeline stage; model IDs and provider recorded on runs for debugging and calibration. |
| **Integration** | Core workflows expose **stable machine-readable** outputs (`--json` where promised) and documented hooks (API/MCP/webhooks) without coupling domain to one UI. |
| **Trust beyond features** | Privacy boundaries (local vs cloud), data retention, and **research-not-advice** posture are documented and reflected in product copy — see **docs/ROADMAP_PRODUCTION.md**. |

### Product promise (one sentence)

> **“Cursor-grade workflow for crypto research: structured, local, yours — with a paper trail every serious trader needs.”**

---

## Non-negotiable rules

- AI never executes trades autonomously.
- LLM prose is never parsed into executable orders.
- Every thesis should surface supporting evidence, contradicting evidence, freshness, confidence, and invalidation (see domain schema and journal UX).
- Execution, if reintroduced later, must be assisted, explicit, manually confirmed, and audited — see **docs/ROADMAP_PRODUCTION.md** Phase 13.
- Historical evaluation must not claim broker-accurate PnL unless a real execution simulator exists.
- The core product is a **research workflow**, not a trading automation system.

---

## Build sequence for moat (abbreviated)

Ordered capabilities that compound; details and timelines live in **docs/ROADMAP_DEV.md**.

```text
ResearchRun domain
→ TradeThesis schema
→ SQLite decision journal
→ signal provenance
→ structured agent opinions
→ contradiction / consensus surfacing
→ thesis watchlist & invalidation signals
→ market brief & alerting hooks
→ (optional) assisted planning / cloud sync per ROADMAP_PRODUCTION
```

---

## Where to read next

1. **Implementing features or fixing architecture** → [docs/ROADMAP_DEV.md](docs/ROADMAP_DEV.md)  
2. **Reliability, secrets, observability, cloud, monetization** → [docs/ROADMAP_PRODUCTION.md](docs/ROADMAP_PRODUCTION.md)

---

## Closing verdict

```text
Crypto-first AI research workstation: structured, auditable, journal-backed — not autonomous trading automation.
```

```text
Target feel: Obsidian/Cursor for crypto research — local knowledge base + agents + timelines, not a gambling UI.
```

If the detailed phase docs drift from this hub, **this north star wins**; update sub-roadmaps to match.
