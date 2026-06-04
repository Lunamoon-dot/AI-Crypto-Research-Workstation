import type { JsonRecord } from '../database/journal.types';
import type {
  ResearchChatContextPackResponse,
  ResearchChatIntent,
  ResearchChatSourceResponse,
} from './dto/research-chat.dto';

export function buildResearchChatSources(
  context: ResearchChatContextPackResponse,
): ResearchChatSourceResponse[] {
  const sources: ResearchChatSourceResponse[] = [];
  addSource(sources, 'thesis', context.latest_thesis, 'Latest thesis');
  addSource(sources, 'research_run', context.latest_run, 'Latest research run');
  addSource(sources, 'research_run', context.previous_run, 'Previous research run');
  addSource(sources, 'continuity_state', context.continuity_state, 'Continuity state');
  for (const entry of context.recent_continuity_entries.slice(0, 3)) {
    addSource(sources, 'continuity_entry', entry, 'Continuity entry');
  }
  for (const scenario of context.active_scenarios.slice(0, 5)) {
    addSource(sources, 'scenario', scenario, 'Active scenario');
  }
  for (const alert of context.latest_alerts.slice(0, 5)) {
    addSource(sources, 'alert', alert, 'Latest alert');
  }
  addSource(sources, 'market_snapshot', context.market_snapshot, 'Market snapshot');
  addSource(sources, 'signal_snapshot', context.signal_snapshot, 'Signal snapshot');
  return dedupeSources(sources);
}

export function buildResearchChatAnswer(
  intent: ResearchChatIntent,
  context: ResearchChatContextPackResponse,
): string {
  if (!context.latest_thesis && !context.continuity_state) {
    return [
      `${context.symbol}: I do not have a saved thesis or continuity state to cite yet.`,
      'The research artifact tables are empty for this workspace, so this structured-RAG chat has no source material yet.',
      'Run a completed research job or import existing artifacts for this workspace and symbol, then ask again.',
      'For V0 I can answer from structured artifacts only: thesis, continuity entries, active scenarios, alerts, market snapshots, and signal snapshots.',
    ].join(' ');
  }

  switch (intent) {
    case 'diff':
      return diffAnswer(context);
    case 'risk':
      return riskAnswer(context);
    case 'scenario':
      return scenarioAnswer(context);
    case 'bias':
      return biasAnswer(context);
    case 'thesis':
      return thesisAnswer(context);
    default:
      return generalAnswer(context);
  }
}

function thesisAnswer(context: ResearchChatContextPackResponse): string {
  const thesis = context.latest_thesis;
  const summary = recordValue(thesis?.summary);
  return [
    `${context.symbol} current thesis: ${firstText(
      thesis?.thesis_text,
      thesis?.decision,
      summary.action_summary,
      'no explicit thesis_text is available.',
    )}`,
    `Direction: ${stringValue(thesis?.direction, stringValue(summary.direction, 'unknown'))}.`,
    `Confidence: ${formatNullable(thesis?.confidence ?? summary.confidence)}.`,
    listSentence('Key reasons', stringList(summary.key_reasons).slice(0, 3)),
    listSentence('Risks', riskTexts(context).slice(0, 3)),
  ]
    .filter(Boolean)
    .join(' ');
}

function diffAnswer(context: ResearchChatContextPackResponse): string {
  const latest = context.recent_continuity_entries[0] ?? null;
  const previous = context.recent_continuity_entries[1] ?? null;
  const events = records(latest?.events).slice(0, 4);
  const eventText = events
    .map((event) =>
      firstText(
        event.reason,
        event.summary,
        event.after,
        event.current_text,
        event.event_type,
      ),
    )
    .filter(Boolean);
  return [
    `Compared with the previous run, ${context.symbol} is currently summarized as: ${firstText(
      latest?.summary,
      'no delta summary is available.',
    )}`,
    previous ? `Previous run recorded: ${stringValue(previous.summary, 'n/a')}` : '',
    listSentence('Key changes', eventText),
    listSentence('Notable risks', riskTexts(context).slice(0, 3)),
  ]
    .filter(Boolean)
    .join(' ');
}

function riskAnswer(context: ResearchChatContextPackResponse): string {
  const risks = riskTexts(context);
  return risks.length
    ? `${context.symbol} current risks: ${risks.slice(0, 5).join('; ')}.`
    : `${context.symbol}: no structured risks were found in the thesis or continuity state.`;
}

function scenarioAnswer(context: ResearchChatContextPackResponse): string {
  if (context.active_scenarios.length === 0) {
    return `${context.symbol}: no active scenario is attached to the latest thesis.`;
  }
  const scenarios = context.active_scenarios
    .slice(0, 5)
    .map((scenario) =>
      [
        firstText(scenario.condition, 'Scenario has no condition'),
        stringValue(scenario.probability_band)
          ? `probability ${stringValue(scenario.probability_band)}`
          : '',
        stringValue(scenario.suggested_user_action)
          ? `action ${stringValue(scenario.suggested_user_action)}`
          : '',
      ]
        .filter(Boolean)
        .join(' / '),
    );
  return `${context.symbol} active scenarios: ${scenarios.join('; ')}.`;
}

function biasAnswer(context: ResearchChatContextPackResponse): string {
  const currentView = recordValue(context.continuity_state?.current_view);
  return [
    `${context.symbol} current bias/conviction: ${stringValue(
      currentView.directional_bias,
      stringValue(context.latest_thesis?.direction, 'unknown'),
    )} / ${stringValue(currentView.conviction, 'unknown')}.`,
    `Risk posture: ${stringValue(currentView.risk_posture, 'unknown')}.`,
    `Latest continuity rationale: ${stringValue(
      context.recent_continuity_entries[0]?.summary,
      'no continuity summary is available.',
    )}`,
  ].join(' ');
}

function generalAnswer(context: ResearchChatContextPackResponse): string {
  return [
    thesisAnswer(context),
    scenarioAnswer(context),
    riskAnswer(context),
  ].join(' ');
}

function riskTexts(context: ResearchChatContextPackResponse): string[] {
  const summary = recordValue(context.latest_thesis?.summary);
  const thesisRisks = stringList(context.latest_thesis?.risks).concat(
    stringList(summary.risks),
  );
  const activeRisks = records(context.continuity_state?.active_items)
    .filter((item) => ['risk', 'risks'].includes(stringValue(item.type ?? item.item_type)))
    .map((item) => firstText(item.text, item.current_text, item.title));
  return uniqueStrings([...thesisRisks, ...activeRisks]);
}

function addSource(
  sources: ResearchChatSourceResponse[],
  type: ResearchChatSourceResponse['type'],
  record: JsonRecord | null,
  label: string,
): void {
  const id = nullableString(record?.id ?? record?.run_id);
  if (!id) {
    return;
  }
  const sourceRecord = record ?? {};
  sources.push({ type, id, label, excerpt: sourceExcerpt(type, sourceRecord) });
}

function dedupeSources(
  sources: ResearchChatSourceResponse[],
): ResearchChatSourceResponse[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.type}:${source.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function listSentence(label: string, values: string[]): string {
  return values.length ? `${label}: ${values.join('; ')}.` : '';
}

function sourceExcerpt(
  type: ResearchChatSourceResponse['type'],
  record: JsonRecord,
): string | null {
  const payload = recordValue(record.payload ?? record.payload_json);
  const summary = recordValue(record.summary ?? payload.summary);
  switch (type) {
    case 'thesis':
      return truncateText(
        firstText(
          record.thesis_text,
          record.decision,
          summary.action_summary,
          stringList(summary.key_reasons).join('; '),
        ),
        220,
      );
    case 'research_run':
      return truncateText(
        [
          stringValue(record.status),
          stringValue(record.symbol),
          stringValue(record.completed_at ?? record.started_at),
        ]
          .filter(Boolean)
          .join(' / '),
        180,
      );
    case 'continuity_state':
      return truncateText(
        firstText(
          recordValue(record.current_view).directional_bias,
          recordValue(record.current_view).conviction,
          `active items ${records(record.active_items).length}`,
        ),
        180,
      );
    case 'continuity_entry':
      return truncateText(firstText(record.summary, payload.summary), 240);
    case 'scenario':
      return truncateText(
        [
          firstText(record.condition, payload.condition),
          firstText(record.expected_behavior, payload.expected_behavior),
          firstText(record.suggested_user_action, payload.suggested_user_action),
        ]
          .filter(Boolean)
          .join(' / '),
        240,
      );
    case 'alert':
      return truncateText(firstText(record.message, payload.message), 220);
    case 'market_snapshot':
      return truncateText(
        [
          stringValue(record.current_price),
          stringValue(record.source),
          stringValue(record.captured_at),
        ]
          .filter(Boolean)
          .join(' / '),
        180,
      );
    case 'signal_snapshot':
      return truncateText(
        [
          `signals ${stringValue(record.signal_count, '0')}`,
          `bullish ${stringValue(record.bullish_count, '0')}`,
          `bearish ${stringValue(record.bearish_count, '0')}`,
        ].join(' / '),
        180,
      );
    default:
      return null;
  }
}

function formatNullable(value: unknown): string {
  return value === null || value === undefined || value === ''
    ? 'unknown'
    : String(value);
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = nullableString(value)?.replace(/\s+/g, ' ').trim();
    if (text) {
      return text;
    }
  }
  return '';
}

function truncateText(value: string, maxLength: number): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
    : normalized;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonRecord =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => nullableString(item))
      .filter((item): item is string => Boolean(item));
  }
  const text = nullableString(value);
  return text ? [text] : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}

function stringValue(value: unknown, fallback = ''): string {
  return nullableString(value) ?? fallback;
}
