import { Injectable } from '@nestjs/common';
import { toScenarioResponse, toTradePlaybookResponse } from '../contracts/frontend-contract';
import type { JsonRecord } from '../database/journal.types';
import { evaluateTradePlaybookFreshness } from '../playbooks/playbook-freshness';
import type { TradePlaybookResponse } from '../playbooks/playbook.types';
import type { ScenarioDecisionCondition } from './scenario-decision.types';
import { tradePlaybookRequiresSequencedSetup } from './sequenced-setup-guard';
import {
  ScenarioContext,
  ScenarioContextLoaderService,
} from './scenario-context-loader.service';
import type {
  ScenarioChartSummaryResponse,
  ScenarioLiveStateResponse,
} from './scenario-chart.types';
import { ScenarioLiveStateService } from './scenario-live-state.service';

@Injectable()
export class ScenarioChartSummaryService {
  constructor(
    private readonly contextLoader: ScenarioContextLoaderService,
    private readonly liveState: ScenarioLiveStateService,
  ) {}

  async getSummary(input: {
    scenarioId: string;
    workspaceId: string;
  }): Promise<ScenarioChartSummaryResponse> {
    const context = await this.contextLoader.load({
      scenarioId: input.scenarioId,
      workspaceId: input.workspaceId,
      eventLimit: 5,
    });
    return this.getSummaryFromContext(context);
  }

  async getSummaryFromContext(
    context: ScenarioContext,
  ): Promise<ScenarioChartSummaryResponse> {
    const live = await this.liveState.getLiveStateFromContext(context);
    const scenario = toScenarioResponse(context.scenario, context.thesis);
    const latestPlaybook = currentPlaybook(context.playbooks[0] ?? null, scenario);
    const currentTradePlaybook =
      latestPlaybook?.status === 'current' ? latestPlaybook : null;
    const enabledTradePlaybook =
      currentTradePlaybook &&
      !tradePlaybookRequiresSequencedSetup(currentTradePlaybook, scenario.decision_playbook)
        ? currentTradePlaybook
        : null;
    const overlayCounts = overlayCountsFromSources({
      decisionPlaybook: scenario.decision_playbook,
      tradePlaybook: enabledTradePlaybook,
      live,
      eventCount: context.events.length,
    });

    return {
      version: 'scenario_chart_summary.v1',
      workspace_id: context.workspaceId,
      scenario_id: context.scenarioId,
      mode: enabledTradePlaybook ? 'trade' : 'watch',
      symbol: context.symbol,
      market_type: context.marketType,
      generated_at: live.evaluated_at,
      trigger_status: live.trigger_status,
      validity_status: live.validity_status,
      trade_playbook_status: latestPlaybook?.status ?? 'missing',
      blocker_count: live.blockers.length,
      warning_count: warningCountFromLiveState(latestPlaybook),
      overlay_counts: overlayCounts,
      latest_event: live.latest_event,
    };
  }
}

function currentPlaybook(
  playbook: JsonRecord | null,
  scenario: ReturnType<typeof toScenarioResponse>,
): TradePlaybookResponse | null {
  if (!playbook) {
    return null;
  }
  return evaluateTradePlaybookFreshness(toTradePlaybookResponse(playbook), {
    scenario: scenario.payload,
    decisionPlaybook: scenario.decision_playbook,
    recommendation: scenario.scenario_recommendation,
    runtimeDecision: scenario.runtime_decision,
  });
}

function overlayCountsFromSources(input: {
  decisionPlaybook: ReturnType<typeof toScenarioResponse>['decision_playbook'];
  tradePlaybook: TradePlaybookResponse | null;
  live: ScenarioLiveStateResponse;
  eventCount: number;
}): ScenarioChartSummaryResponse['overlay_counts'] {
  const decision = input.decisionPlaybook
    ? [
        ...input.decisionPlaybook.entry_conditions,
        ...input.decisionPlaybook.invalidation_conditions,
        ...input.decisionPlaybook.avoid_if,
      ].filter(isOverlayCondition).length
    : 0;
  const trade = input.tradePlaybook
    ? 2 + input.tradePlaybook.targets.filter((target) => target.level !== null).length
    : 0;
  const runtime = input.live.current_price === null ? 0 : 1;
  const events = input.eventCount;
  return {
    decision,
    trade,
    runtime,
    events,
    total: decision + trade + runtime + events,
  };
}

function isOverlayCondition(condition: ScenarioDecisionCondition): boolean {
  return (
    condition.type === 'price_in_zone' ||
    typeof condition.level === 'number'
  );
}

function warningCountFromLiveState(
  playbook: TradePlaybookResponse | null,
): number {
  if (!playbook || playbook.status === 'current') {
    return 0;
  }
  return 1 + playbook.stale_reasons.length;
}
