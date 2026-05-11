# Production roadmap

Reliability, observability, boundaries for assisted execution, cloud/monetization, and shipping posture — not feature-by-feature coding notes.

**Audience:** release engineering, security review, future hosted product owners.

**See also:** [Developer roadmap](ROADMAP_DEV.md) · [Project hub](../ROADMAP.md)

---

## Strategic Positioning

The product should be **crypto-first**.

Recommended initial market:

- BTC;
- ETH;
- SOL;
- top liquid alts;
- spot and perpetual research;
- no autonomous futures execution.

Why crypto first:

- crypto traders are more comfortable with AI tools and local workflows;
- market trades 24/7, making brief/watchlist/alert features valuable;
- data sources such as funding, open interest, liquidation maps, sentiment, and onchain signals create a strong research surface;
- retail and semi-professional crypto users are more likely to pay for workflow tooling than traditional equity traders early on;
- crypto has clearer product differentiation than generic stock analysis.

Stocks can be supported later as a secondary asset class, but the first product should not split focus.

## Non-Negotiable Product Rules

- AI never executes trades autonomously.
- LLM prose is never parsed into executable orders.
- Every thesis must show supporting evidence, contradicting evidence, freshness, confidence, and invalidation.
- Execution, if reintroduced later, must be assisted, explicit, manually confirmed, and audited.
- Historical evaluation must not claim broker-accurate PnL unless a real execution simulator exists.
- The core product is a research workflow, not a trading automation system.

## Target End State

### Local OSS Product

```text
AI Crypto Research Workstation
- local SQLite journal
- research runs
- signal provenance
- multi-agent analysis
- structured trade theses
- thesis watchlists
- invalidation alerts
- market briefs
- markdown/report export
```

### Paid Cloud Product

```text
AI Crypto Research Cloud
- cloud sync
- hosted inference
- scheduled market briefs
- email/Telegram/Discord/mobile alerts
- advanced data providers
- longer history
- cross-device workspace
```

### Team/Pro Product

```text
Collaborative Trading Research Workspace
- shared journals
- shared watchlists
- collaborative thesis review
- analyst comments
- audit timeline
- role permissions
- team-level research memory
```


---

## Excellence criteria — trust, privacy, and shipping posture

These complement the **world-class** bar in [../ROADMAP.md](../ROADMAP.md). They matter most for OSS credibility and any future hosted tier.

### Privacy & data ownership

- Explicit policy: **what stays local-only** vs **what may sync** in a cloud tier (journal encryption expectations, export portability).
- User-facing **retention and deletion** story for journal DB and cloud copies.

### Transparency & compliance framing

- Consistent **research tool / not investment advice** positioning; avoid performance claims that imply regulated advisory unless legally cleared.
- Jurisdiction-aware disclaimer review before broad marketing or app-store presence.

### Operational resilience

- **Runbooks**: provider outage, LLM deprecation, schema migration, rotating API keys without bricking installs.
- **Incident response**: leaked credentials, compromised sync account — detection, rotation, user notification pattern.

### Reliability expectations

- Document **SLO-style intent** (e.g. CLI commands return quickly; LLM-bound steps are clearly labeled) without promising fictional uptime for third-party models.

### Accessibility & reach (when scaling UX)

- Terminal UX: readable defaults, optional high-contrast; consider **i18n** for prompts and reports where demand exists.

---

# Phase 10: Configuration, Secrets, And Reliability

Estimated time: 2-3 weeks.

## Goal

Make the local app reliable and installable by other developers/users.

## Config Structure

Add:

```text
config/
  default.toml
  local.example.toml

tradingagents/config/
  loader.py
  schema.py
```

Environment variables:

```text
OPENAI_API_KEY
FINNHUB_API_KEY
REDDIT_CLIENT_ID
COINGLASS_API_KEY
DATABASE_URL
```

## Config Rules

- fail fast if required config is missing;
- warn if optional providers are missing;
- show which providers are disabled;
- do not crash the entire research run if one provider fails;
- never silently use fake data in production mode.

## Error Types

Create explicit errors:

```text
DataProviderError
StaleDataError
LLMOutputError
ConfigurationError
StorageError
RateLimitError
```

## External API Reliability

Every external data provider should have:

- timeout;
- retry with backoff;
- rate-limit handling;
- provider health status;
- graceful degradation.

## Secrets

Never log:

- API keys;
- full request headers;
- auth tokens;
- cloud sync credentials.

Add a secret redaction utility.

## Acceptance Criteria

- Fresh install has a clear config path.
- Missing optional data sources degrade gracefully.
- Logs do not leak secrets.
- Provider failures are visible and recoverable.

---

# Phase 11: Observability And Trust Layer

Estimated time: 2-4 weeks.

## Goal

Make the system explain itself.

## Run Trace

Each research run should store events:

```text
fetch_price_data: success, 320ms
fetch_funding: stale, 2h old
run_quant_agent: success, 4.2s
run_news_agent: failed, provider timeout
aggregate_thesis: success
```

Tables:

```text
run_events
provider_health
llm_calls
data_freshness_checks
```

## Explainability Questions

Every thesis must answer:

```text
Why this thesis?
What evidence supports it?
What evidence contradicts it?
What data is stale?
What would invalidate it?
What should the user monitor next?
```

## Structured Logging

Use structured logs:

```json
{
  "event": "signal_generated",
  "symbol": "BTC",
  "signal_type": "funding_extreme",
  "confidence": 0.71,
  "run_id": "..."
}
```

## Acceptance Criteria

- Research runs are debuggable after completion.
- Provider health is visible.
- LLM failures are visible.
- Thesis confidence can be explained.

---

# Phase 12: Service Layer And API

Estimated time: 3-5 weeks.

## Goal

Prepare the codebase for web app and cloud without coupling UI to internal graph/provider logic.

## Service Layer

Create:

```text
tradingagents/services/
  research_service.py
  journal_service.py
  thesis_service.py
  watchlist_service.py
  brief_service.py
  signal_service.py
```

CLI, TUI, web, and future API should call this service layer.

The CLI should not directly call graph internals, providers, or repositories in scattered ways.

## REST API

Later, add:

```text
api/
  main.py
  routes/
    research.py
    journal.py
    thesis.py
    signals.py
    watchlists.py
    briefs.py
```

Target endpoints:

```http
POST /research-runs
GET /research-runs/{id}
GET /theses
GET /theses/{id}
POST /theses/{id}/decision
POST /theses/{id}/review
GET /signals?symbol=BTC
GET /briefs/daily
```

## API Rules

- no core endpoint named `/execute`;
- no endpoint places live orders in the core product;
- assisted execution later must require explicit user approval;
- all returned theses include evidence, contradictions, freshness, and invalidation.

## Acceptance Criteria

- CLI and future web can share business logic.
- API shape reflects research workflow.
- Core domain remains independent from UI.

---

# Phase 13: Optional Assisted Execution

Estimated time: post-MVP only.

## Goal

Add execution only as an assistant layer, not as the product core.

Correct flow:

```text
AI Research
-> Trade Thesis
-> User Approval
-> Execution Ticket
-> Manual Confirmation
-> Broker/Exchange Adapter
```

## ExecutionTicket

```text
ExecutionTicket
- thesis_id
- proposed_order
- risk_summary
- user_confirmed_at
- submitted_at
- broker_response
- audit_status
```

## Hard Rules

- manual confirmation is mandatory;
- no hidden bypass;
- no auto sizing without user-defined caps;
- no leverage by default;
- no prose parsing;
- dry-run preview before submit;
- immutable audit log;
- exchange adapter is isolated from research core.

## Acceptance Criteria

- Assisted execution can be fully disabled.
- No background loop can place orders.
- Every submitted order maps to a user-confirmed ticket.
- Audit trail is complete.

---

# Phase 14: Cloud And Monetization

Estimated time: after local MVP is strong.

## Free OSS

Free local tier:

- local SQLite;
- basic agents;
- local research runs;
- decision journal;
- basic watchlists;
- manual market brief;
- AI research outputs and journal persistence (no bundled order execution).

Purpose:

- user acquisition;
- developer trust;
- open-source credibility;
- local-first positioning.

## Paid Cloud

Paid tier:

- cloud sync;
- hosted inference;
- scheduled market briefs;
- alerts;
- Telegram/Discord/email delivery;
- advanced data providers;
- longer history;
- richer analytics;
- cross-device workspace.

## Team/Pro

Team tier:

- shared journals;
- shared watchlists;
- collaborative thesis review;
- comments;
- audit timeline;
- role permissions;
- team-level brief;
- analyst reliability reports.

## Acceptance Criteria

- Local product is useful before cloud exists.
- Cloud adds convenience and scale, not basic viability.
- Paid features are aligned with workflow, not hype.

---

---

# Things not to build (near-term)

# Things Not To Build In The Next 3 Months

Avoid:

- live execution;
- futures automation;
- leverage support;
- auto position management;
- fake backtest dashboards;
- complex portfolio optimizer;
- generic stock screener;
- cloud multi-user system before local journal is strong;
- fancy dashboard before workflow is correct;
- AI hedge fund branding.

These create technical debt, legal risk, and product confusion before the core moat exists.

---

---

# MVP definition (ship checklist)

# MVP Definition

The MVP is ready when:

```text
1. User runs research for BTC/ETH/SOL.
2. App captures market snapshot and signals.
3. Multi-agent system creates structured opinions.
4. Aggregator creates a trade thesis.
5. Thesis shows supporting and contradicting evidence.
6. User records a decision.
7. App tracks thesis invalidation and target zones.
8. User reviews the outcome.
9. App generates a daily market brief.
10. Everything is saved in the local journal.
```

The MVP does not need:

```text
live trading
mobile app
cloud sync
team collaboration
full historical replay
paid billing
broker execution
```

---

---

# Engineering maturity (production-facing)

# Engineering Maturity Targets

## Testing

Required test coverage:

- domain model validation;
- signal provider behavior;
- data freshness policy;
- agent output parsing;
- contradiction detection;
- thesis generation;
- journal persistence;
- historical evaluation lookahead guardrails.

## CI/CD

Target checks:

```text
ruff or equivalent lint
type checking
unit tests
integration tests with mocked providers
migration tests
secret scanning
dependency audit
```

## Production Readiness

Before cloud:

- structured logging;
- config schema;
- migrations;
- provider timeouts;
- retry/backoff;
- error taxonomy;
- secret redaction;
- API auth;
- rate limiting;
- audit trail.


---

# Final Verdict

The correct direction is:

```text
Crypto-first research workstation, not autonomous trading automation.
```

The highest-value product identity is:

```text
Obsidian/Cursor for crypto research.
```

The first serious rewrite/build sequence should be:

```text
ResearchRun domain
-> TradeThesis schema
-> SQLite decision journal
-> signal provenance
-> structured agent opinions
-> contradiction detector
-> thesis watchlist
-> market brief
```

This path gives the project a realistic chance to become a useful product, reduce legal and technical risk, and build a monetizable workflow around structured trading research.
