import { Inject, Injectable } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import {
  ScenarioMonitorItemResponse,
  ScenarioMonitorResponse,
  toAlertResponse,
  toMarketSnapshotResponse,
  toScenarioResponse,
  toThesisResponse,
} from '../contracts/frontend-contract';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class ScenariosService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async monitor(
    options: { symbol?: string; status?: string; limit: number },
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ScenarioMonitorResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const symbol = normalize(options.symbol);
    const statusFilter = normalize(options.status);
    const theses = (await this.journal.listTheses(options.limit, workspaceId))
      .filter((thesis) => !symbol || stringValue(thesis.symbol) === symbol);
    const items: ScenarioMonitorItemResponse[] = [];

    for (const thesis of theses) {
      const thesisId = nullableString(thesis.id);
      if (!thesisId) {
        continue;
      }
      const scenarios = await this.journal.listScenarios(thesisId, workspaceId);
      const [snapshot, alerts] = await Promise.all([
        this.journal.getLatestMarketSnapshot(stringValue(thesis.symbol), workspaceId),
        this.journal.listAlerts(
          stringValue(thesis.symbol),
          thesisId,
          false,
          10,
          workspaceId,
        ),
      ]);
      for (const scenario of scenarios) {
        const item = buildScenarioMonitorItem(thesis, scenario, snapshot, alerts[0] ?? null);
        if (!statusFilter || item.status === statusFilter) {
          items.push(item);
        }
      }
    }

    const limited = items.slice(0, options.limit);
    return {
      workspace_id: workspaceId,
      generated_at: new Date().toISOString(),
      total_scenarios: limited.length,
      status_counts: countBy(limited, (item) => item.status),
      items: limited,
    };
  }

  private async resolveWorkspace(
    userId?: string,
    workspaceHeader?: string,
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'viewer');
    return workspaceId;
  }
}

function buildScenarioMonitorItem(
  thesis: JsonRecord,
  scenario: JsonRecord,
  snapshot: JsonRecord | null,
  latestAlert: JsonRecord | null,
): ScenarioMonitorItemResponse {
  const payload = recordValue(scenario.payload ?? scenario.payload_json);
  const action = stringValue(scenario.suggested_user_action ?? payload.suggested_user_action, 'review');
  const probability = stringValue(scenario.probability_band ?? payload.probability_band);
  const status = scenarioStatus(action, probability, snapshot, latestAlert);
  const currentPrice = snapshot ? numberValue(snapshot.current_price) : null;
  const condition = stringValue(scenario.condition ?? payload.condition);
  return {
    status,
    status_reason: statusReason(status, latestAlert, snapshot),
    trigger_summary: currentPrice === null
      ? condition
      : `${condition}${condition ? ' | ' : ''}latest price ${formatNumber(currentPrice)}`,
    risk_count: stringList(scenario.risk_map ?? payload.risk_map).length,
    scenario: toScenarioResponse(scenario),
    thesis: toThesisResponse(thesis),
    latest_market_snapshot: snapshot ? toMarketSnapshotResponse(snapshot) : null,
    latest_alert: latestAlert ? toAlertResponse(latestAlert) : null,
  };
}

function scenarioStatus(
  action: string,
  probability: string,
  snapshot: JsonRecord | null,
  latestAlert: JsonRecord | null,
): string {
  if (latestAlert && !latestAlert.read_at) {
    return 'alerting';
  }
  if (!snapshot) {
    return 'missing_price';
  }
  const normalizedAction = action.toLowerCase();
  if (normalizedAction.includes('exit') || normalizedAction.includes('reduce')) {
    return 'action_required';
  }
  if (probability.toLowerCase().includes('high')) {
    return 'high_attention';
  }
  return 'watching';
}

function statusReason(
  status: string,
  latestAlert: JsonRecord | null,
  snapshot: JsonRecord | null,
): string {
  if (status === 'alerting') {
    return stringValue(latestAlert?.message, 'Unread alert is attached to this thesis.');
  }
  if (status === 'missing_price') {
    return 'No fresh market snapshot is available for this thesis symbol.';
  }
  if (status === 'action_required') {
    return 'Suggested action asks the user to reduce, exit, or otherwise intervene.';
  }
  if (status === 'high_attention') {
    return 'High-probability scenario with current price context available.';
  }
  return snapshot ? 'Scenario is monitored with latest persisted market context.' : 'Scenario is recorded.';
}

function countBy<T>(values: T[], keyFn: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyFn(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function normalize(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function recordValue(value: unknown): JsonRecord {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
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

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => nullableString(item))
      .filter((item): item is string => item !== null);
  }
  const text = nullableString(value);
  return text ? [text] : [];
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(4);
}
