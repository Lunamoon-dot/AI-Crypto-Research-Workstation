# Incident Message Template

**Last updated**: 2026-05-12
**Audience**: Users or operators affected by a local data, provider, or credential incident.

```text
Subject: LunaCrypto incident notice - <short title>

Status: Investigating / Mitigated / Resolved
Start time: <YYYY-MM-DD HH:MM UTC>
Resolved time: <YYYY-MM-DD HH:MM UTC or pending>

What happened:
<Plain-language summary. Do not include secrets, raw stack traces, or private journal content.>

Impact:
- Affected component: <LLM provider / data provider / local journal / reports / configuration>
- Affected users or environments: <scope>
- Data exposure: <none known / under review / confirmed with details>

Actions taken:
- <containment action>
- <recovery action>
- <verification action>

Required user action:
<None / rotate key / restore journal backup / rerun affected research / delete local artifact>

Current limitations:
<Known degraded behavior or unavailable feature>

Next update:
<time or condition>

Contact:
<maintainer or support channel>
```

## Rules

- Never include API keys, bearer tokens, journal payloads, or private report text.
- Use absolute dates and times with timezone.
- Separate confirmed facts from investigation hypotheses.
- For research-output issues, describe LunaCrypto as research assistance with user-reviewed decisions.
