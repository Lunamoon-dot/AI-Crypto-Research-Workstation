# LunaCrypto Figma Roadmap Page Plan

Status: Figma MCP write blocked by Starter plan tool-call limit after creating the target file.
Target file: https://www.figma.com/design/GQPzPVkhM6he1PXe6mgXFP
Source: `docs/web-app-implementation-roadmap.md`

## Design Direction

Create a dense logged-in research workstation, not a trading dashboard or
marketing landing page.

Core product flow:

```text
market context
-> deterministic signals
-> multi-agent research
-> structured thesis
-> user decision
-> journal
-> outcome review
-> reliability learning
```

Visual rules:

- Use restrained workstation layout: left sidebar, top command strip, main work
  surface, optional contextual right rail.
- Use 8px radius or less.
- Use research language: Run research, Watch, Review, Record decision, Scenario
  active, Invalidation risk.
- Keep provenance, freshness, missing data, confidence, invalidation, and
  monitor-next fields near decision surfaces.

## Pages To Create In Figma

### 00 Cover

Purpose: explain the repo-derived product boundary and roadmap scope.

Sections:

- Product title: LunaCrypto Research Workstation.
- Research-first chips: Research-first, Journal-backed, Manual decision, No
  autonomous execution.
- Architecture flow: Web UI -> NestJS API -> Jobs/Queue -> Python Engine ->
  Journal DB -> Read APIs.
- Non-negotiable product rules.
- Route map and MVP build order.

### 01 Workbench

Purpose: first logged-in screen and daily operating view.

Layout:

- Persistent left sidebar.
- Top command strip with symbol, market type, date/as-of, profile, Run research.
- Main metrics: active theses, fresh signals, unread alerts, queued runs.
- Panels: attention queue, thesis inbox, composite signal board, scenario highlights.
- Right rail: contextual AI command rail and unread alerts.

Backend sources:

- `GET /workbench/attention`
- `GET /alerts`
- `GET /theses`
- `GET /signals`

### 02 Research Launcher

Purpose: launch a research run through the API boundary.

Sections:

- Run parameters form: symbol, asset class, market type, analysis date, analysts,
  config profile.
- Request payload preview matching `POST /research-runs`.
- Local identity headers shown as transport/debug detail, not scattered UI state.
- Backend gap callout for `GET /jobs/:id`.

### 03 Research Run Workspace

Purpose: inspect one active or completed run.

Sections:

- Run header with status, run ID, market type, model/profile, config hash,
  started/completed timestamps.
- Agent pipeline: quant, market, social, news, onchain, debate, thesis.
- Timeline events.
- Snapshots, debate, consensus, conflict, freshness, raw payload drawer.
- Right thesis rail with action summary, entry, invalidation, monitor-next, open
  thesis action.

Backend sources:

- `GET /research-runs/:id`
- `GET /research-runs/:id/events`
- `GET /research-runs/:id/snapshots`
- `GET /research-runs/:id/debate`
- `GET /research-runs/:id/workspace`

### 04 Thesis Detail

Purpose: turn generated research into explicit user-reviewed decisions.

Sections:

- Thesis header with rating, direction, confidence, setup type, created date.
- Summary metrics: direction, confidence, invalidation, targets.
- Evidence and contradiction map.
- Missing/stale data and monitor-next panel.
- Scenario radar.
- Decision journal: Watch, Accept, Reject with notes.
- Outcome review form.
- Contextual AI rail that cites the current thesis/run/signals.

Backend sources:

- `GET /theses/:id`
- `GET /theses/:id/scenarios`
- `POST /theses/:id/decision`
- `POST /theses/:id/review`

### 05 Signals And Alerts

Purpose: inspect deterministic evidence and monitoring events.

Sections:

- Signal filters: symbol, direction, signal type, min confidence, freshness.
- Signal table: symbol, signal type, direction, confidence, observed at, source,
  source timestamp, freshness, summary.
- Alert inbox right rail with unread/read state and mark-read action.
- Alert detail drawer fields: message, trigger key, payload JSON, thesis link,
  scenario or run link when available.

Backend sources:

- `GET /signals`
- `GET /alerts`
- `POST /alerts/:id/read`

### 06 Scenario And Attention Monitoring

Purpose: support the monitoring and daily research habit loop without a
separate watchlist or daily-brief domain.

Sections:

- Scenario monitor grouped by thesis/symbol and condition state.
- Attention queue rows for unread alerts, stale provider state, active runs, and
  thesis review needs.
- Alert detail drawer with mark-read action.
- Decommission callout: `/watchlists` and `/briefs/daily` are not active routes.

Backend sources:

- `GET /scenarios/monitor`
- `GET /workbench/attention`
- `GET /alerts`

### 07 Trust, Operations, Settings, Retrospective

Purpose: expose reliability and local/private-beta trust state without fake
performance claims.

Sections:

- Operations cards for provider health, LLM calls, data freshness, queue state.
- Settings cards for API base URL, local user ID, local workspace ID, auth mode.
- Retrospective cards for thesis hit rate, invalidation rate, signal reliability,
  agent calibration, confidence calibration, setup quality.
- Release gates: local MVP, private beta, hosted beta.

Backend sources:

- Future `GET /operations/provider-health`
- Future `GET /operations/llm-calls`
- Future `GET /operations/data-freshness`
- Future `GET /settings/config-health`
- Future retrospective endpoints

## Current Blocker

The Figma plugin created the file, then all further Figma MCP calls returned:

```text
You've reached the Figma MCP tool call limit on the Starter plan.
```

Once the quota issue is resolved, the next step is a single `use_figma` write
that creates the pages above as 1440px workstation frames with local primitives
and roadmap-derived content.
