import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';

export interface ScenarioContext {
  scenarioId: string;
  workspaceId: string;
  scenario: JsonRecord;
  payload: JsonRecord;
  thesis: JsonRecord | null;
  thesisId: string;
  symbol: string;
  marketType: 'spot' | 'perp';
  snapshot: JsonRecord | null;
  playbooks: JsonRecord[];
  events: JsonRecord[];
}

@Injectable()
export class ScenarioContextLoaderService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
  ) {}

  async load(input: {
    scenarioId: string;
    workspaceId: string;
    eventLimit: number;
  }): Promise<ScenarioContext> {
    const scenario = await this.journal.getScenario(
      input.scenarioId,
      input.workspaceId,
    );
    if (!scenario) {
      throw new NotFoundException('Scenario not found.');
    }
    const payload = recordValue(scenario.payload ?? scenario.payload_json);
    const thesisId = stringValue(scenario.thesis_id);
    const thesis = thesisId
      ? await this.journal.getThesis(thesisId, input.workspaceId)
      : null;
    const symbol = stringValue(thesis?.symbol ?? scenario.symbol ?? payload.symbol);
    const marketType = marketTypeValue(thesis?.market_type ?? scenario.market_type);
    const [snapshot, playbooks, events] = await Promise.all([
      symbol
        ? this.journal.getLatestMarketSnapshot(symbol, input.workspaceId)
        : Promise.resolve(null),
      this.journal.listTradePlaybooksForScenario(
        input.scenarioId,
        input.workspaceId,
      ),
      this.journal.listScenarioEvents(
        input.scenarioId,
        input.workspaceId,
        input.eventLimit,
      ),
    ]);
    return {
      scenarioId: input.scenarioId,
      workspaceId: input.workspaceId,
      scenario,
      payload,
      thesis,
      thesisId,
      symbol,
      marketType,
      snapshot,
      playbooks,
      events,
    };
  }
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
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

function marketTypeValue(value: unknown): 'spot' | 'perp' {
  return value === 'perp' ? 'perp' : 'spot';
}
