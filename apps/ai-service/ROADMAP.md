# LunaCrypto AI Service - Roadmap Hub

This file is the entry point for AI-service roadmap context. Detailed planning
is split so engineering, release, security, and production concerns do not share
one overloaded document.

| Document | Audience | Contents |
| --- | --- | --- |
| [docs/ROADMAP_DEV.md](docs/ROADMAP_DEV.md) | Contributors, implementers | Phases 1-9, codebase snapshot, excellence backlog, terminal UX, refactor priorities, timelines |
| [docs/ROADMAP_PRODUCTION.md](docs/ROADMAP_PRODUCTION.md) | Shipping, security, future cloud | Positioning, phases 10-14, privacy, compliance framing, ops, MVP checklist, production readiness |
| [docs/PRODUCTION_READINESS_REVIEW.md](docs/PRODUCTION_READINESS_REVIEW.md) | Maintainers, release reviewers | Current go/no-go verdict, verification evidence, blockers, and Markdown cleanup policy |

**Last reviewed:** 2026-05-12.
**Current production verdict:** not ready for broad production launch; acceptable for controlled local alpha/beta research use.

---

## Product North Star

LunaCrypto should become a world-class AI crypto research workstation: a
local-first, optionally cloud-synced decision OS that serious retail and
semi-pro crypto traders trust for repeatable, auditable research.

The realistic final product is a workspace that ingests market, on-chain, and
sentiment context; runs specialized agents with clear roles; surfaces signal
provenance and contradictions; produces a structured trade thesis with explicit
invalidation; persists every run in a decision journal; and closes the loop with
outcome review so traders improve judgment over time.

The commercial posture is simple:

> Trade theses, not vibes. LunaCrypto sells research discipline: evidence,
> conviction, invalidation, monitoring, and review.

### Moat

The durable advantage is not one-shot LLM calls or secret prompts. It is:

- **Structured memory:** journal, runs, theses, decisions, timelines, and reviews.
- **Explainability:** every signal and stance is attributable to data, agent output, and timestamps.
- **Workflow:** the daily loop serious traders already need: research -> thesis -> track -> invalidate -> learn.
- **Trust:** the system keeps decisions explicit, confirmable, and logged.

---

## World-Class Bar

The workstation is great when a user can, without code changes:

| Dimension | Excellent looks like |
| --- | --- |
| Research depth | Multi-agent pipeline plus quant layer; outputs are actionable and conflict-aware. |
| Provenance | Any signal or thesis line can be traced to source, freshness, and evidence, including what would change the thesis. |
| Thesis quality | Every thesis ships with direction, confidence, invalidation, supporting evidence, contradicting evidence, and debate outcomes. |
| Journal | SQLite or an equivalent store is the source of truth for runs and decisions; exports are snapshots, not canonical state. |
| Operability | CLI/TUI is fast, scriptable, and observable: configs validated, failures explicit, logs redacted, timelines inspectable. |
| Reproducibility | Same ticker, date, and config pins yield auditable artifacts where replay/historical modes make that claim. |
| Model and cost governance | Token/latency budgets, model IDs, and provider metadata are recorded per run. |
| Integration | Core workflows expose stable machine-readable outputs and documented hooks without coupling the domain to one UI. |
| Trust beyond features | Privacy, retention, and research-boundary rules are real product behavior, not defensive headline copy. |

### Product Promise

> Cursor-grade workflow for crypto research: structured, local, yours - with the
> thesis paper trail every serious trader needs.

---

## Trust Rules

- AI never executes trades autonomously.
- LLM prose is never parsed into executable orders.
- Every thesis should surface supporting evidence, contradicting evidence, freshness, confidence, and invalidation.
- Execution, if introduced later, must be assisted, explicit, manually confirmed, and audited.
- Historical evaluation must distinguish thesis-quality learning from account or broker performance.
- The core product is a research workflow with a durable decision trail.

---

## Build Sequence For Moat

Ordered capabilities that compound; details and timelines live in
[docs/ROADMAP_DEV.md](docs/ROADMAP_DEV.md).

```text
ResearchRun domain
-> TradeThesis schema
-> SQLite decision journal
-> signal provenance
-> structured agent opinions
-> contradiction / consensus surfacing
-> thesis watchlist & invalidation signals
-> market brief & alerting hooks
-> optional assisted planning / cloud sync per ROADMAP_PRODUCTION
```

---

## Where To Read Next

1. Implementing features or fixing architecture: [docs/ROADMAP_DEV.md](docs/ROADMAP_DEV.md)
2. Reliability, secrets, observability, cloud, monetization: [docs/ROADMAP_PRODUCTION.md](docs/ROADMAP_PRODUCTION.md)
3. Current go-live decision and blockers: [docs/PRODUCTION_READINESS_REVIEW.md](docs/PRODUCTION_READINESS_REVIEW.md)

---

## Closing Verdict

```text
Crypto-first AI research workstation: structured, auditable, journal-backed,
and built around thesis discipline.
```

```text
Target feel: Obsidian/Cursor for crypto research - local knowledge base,
specialist agents, thesis timelines, and evidence trails.
```

If the detailed phase docs drift from this hub, this north star wins; update
sub-roadmaps to match.
