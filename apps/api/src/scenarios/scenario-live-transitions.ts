import { createHash } from 'node:crypto';
import type {
  ScenarioEventResponse,
  ScenarioLiveStateResponse,
} from './scenario-chart.types';

export type ScenarioTransitionInput = {
  previous: ScenarioLiveStateResponse | null;
  current: ScenarioLiveStateResponse;
  thesisId: string | null;
  marketSnapshotId: string | null;
};

export function scenarioTransitionEvents(
  input: ScenarioTransitionInput,
): ScenarioEventResponse[] {
  const events: ScenarioEventResponse[] = [];
  appendScenarioStatusTransition(
    events,
    input,
    'trigger_status',
    'scenario.triggered',
    'triggered',
  );
  appendScenarioStatusTransition(
    events,
    input,
    'validity_status',
    'scenario.invalidated',
    'invalidated',
  );

  for (const currentCondition of input.current.condition_evaluations) {
    const previousCondition = input.previous?.condition_evaluations.find(
      (item) => item.id === currentCondition.id,
    );
    if (previousCondition?.status === currentCondition.status) {
      continue;
    }
    if (currentCondition.status === 'passed') {
      events.push(
        transitionEvent(input, {
          eventType: 'scenario.condition_passed',
          entityType: 'condition',
          entityId: currentCondition.id,
          fromStatus: previousCondition?.status ?? null,
          toStatus: 'passed',
          summary: `Condition passed: ${currentCondition.label}.`,
        }),
      );
    }
    if (currentCondition.status === 'failed') {
      events.push(
        transitionEvent(input, {
          eventType: 'scenario.condition_failed',
          entityType: 'condition',
          entityId: currentCondition.id,
          fromStatus: previousCondition?.status ?? null,
          toStatus: 'failed',
          summary: `Condition failed: ${currentCondition.label}.`,
        }),
      );
    }
  }

  for (const currentTarget of input.current.target_progress) {
    const previousTarget = input.previous?.target_progress.find(
      (item) => item.label === currentTarget.label,
    );
    if (currentTarget.status !== 'hit' || previousTarget?.status === 'hit') {
      continue;
    }
    events.push(
      transitionEvent(input, {
        eventType: 'scenario.target_hit',
        entityType: 'target',
        entityId: currentTarget.label,
        fromStatus: previousTarget?.status ?? null,
        toStatus: 'hit',
        summary: `Target hit: ${currentTarget.label}.`,
      }),
    );
  }

  return events;
}

function appendScenarioStatusTransition(
  events: ScenarioEventResponse[],
  input: ScenarioTransitionInput,
  key: 'trigger_status' | 'validity_status',
  eventType: ScenarioEventResponse['event_type'],
  toStatus: string,
): void {
  if (input.current[key] !== toStatus || input.previous?.[key] === input.current[key]) {
    return;
  }
  events.push(
    transitionEvent(input, {
      eventType,
      entityType: 'scenario',
      entityId: input.current.scenario_id,
      fromStatus: input.previous?.[key] ?? null,
      toStatus,
      summary: `Scenario ${toStatus}.`,
    }),
  );
}

function transitionEvent(
  input: ScenarioTransitionInput,
  transition: {
    eventType: ScenarioEventResponse['event_type'];
    entityType: 'scenario' | 'condition' | 'target';
    entityId: string;
    fromStatus: string | null;
    toStatus: string;
    summary: string;
  },
): ScenarioEventResponse {
  return {
    version: 'scenario_event.v1',
    id: transitionEventId(input, transition),
    workspace_id: input.current.workspace_id,
    scenario_id: input.current.scenario_id,
    thesis_id: input.thesisId,
    event_type: transition.eventType,
    event_time: input.current.evaluated_at,
    summary: transition.summary,
    payload: {
      entity_id: transition.entityId,
      entity_type: transition.entityType,
      from_status: transition.fromStatus,
      to_status: transition.toStatus,
      market_snapshot_id: input.marketSnapshotId,
      evaluated_at: input.current.evaluated_at,
      current_price: input.current.current_price,
    },
    created_at: input.current.evaluated_at,
  };
}

function transitionEventId(
  input: ScenarioTransitionInput,
  transition: {
    eventType: string;
    entityId: string;
    fromStatus: string | null;
    toStatus: string;
  },
): string {
  const occurrenceKey = [
    input.current.workspace_id,
    input.current.scenario_id,
    input.marketSnapshotId ?? input.current.evaluated_at,
    transition.eventType,
    transition.entityId,
    transition.fromStatus ?? 'none',
    transition.toStatus,
  ].join(':');
  return `scenario_event_${createHash('sha256')
    .update(occurrenceKey)
    .digest('hex')
    .slice(0, 24)}`;
}
