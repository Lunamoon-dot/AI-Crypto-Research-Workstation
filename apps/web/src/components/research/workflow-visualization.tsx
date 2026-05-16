import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ConfidenceBadge } from '@/components/research/badges';
import { formatDateTime } from '@/lib/format';
import type { ResearchRunStageTimingResponse } from '@/types';

export type WorkflowVisualizationStage = {
  key: string;
  label: string;
  icon: LucideIcon;
  statusLabel: string;
  badgeClass: string;
  detail: string;
  confidence: number | null;
  warning?: string;
};

const ANALYST_STAGE_KEYS = new Set(['market', 'news', 'social', 'onchain']);
const ANALYST_NODE_WIDTH = 210;
const ANALYST_GAP = 14;

export function WorkflowVisualization({
  stages,
  stageTimings,
  marketType,
}: {
  stages: WorkflowVisualizationStage[];
  stageTimings: ResearchRunStageTimingResponse[];
  marketType: 'spot' | 'perp';
}) {
  const timingByStage = new Map(
    stageTimings.map((timing) => [timing.stage_key, timing]),
  );
  const signalStage = stages.find((stage) => stage.key === 'quant');
  const analystStages = stages.filter((stage) => ANALYST_STAGE_KEYS.has(stage.key));
  const sequentialStages = stages.filter(
    (stage) => stage.key !== 'quant' && !ANALYST_STAGE_KEYS.has(stage.key),
  );
  const analystGridStyle = analystGridVariables(analystStages.length);
  const canvasStyle = workflowCanvasVariables(analystStages.length);
  const analystConnectorState = groupConnectorState(analystStages);
  const workflowComplete = terminalStagesComplete({
    signalStage,
    analystStages,
    sequentialStages,
  });

  return (
    <div className={`workflow-org ${workflowComplete ? 'workflow-flow-complete' : ''}`}>
      <div className="workflow-org-header">
        <div>
          <strong>Agent workflow</strong>
          <p className="small muted">Signal fan-out, analyst lanes, and sequential manager stages</p>
        </div>
        <div className="top-strip-meta">
          <span className="badge degraded">{marketType}</span>
          <span className="badge">{stages.length} nodes</span>
        </div>
      </div>

      <div className="workflow-org-scroll" aria-label="Agent workflow organization chart">
        <div className="workflow-org-canvas" style={canvasStyle}>
          {signalStage ? (
            <div className="workflow-org-row workflow-org-row-single">
              <WorkflowNode
                stage={signalStage}
                timing={timingByStage.get(signalStage.key)}
                variant="signal"
              />
            </div>
          ) : null}

          {analystStages.length > 0 ? (
            <>
              <div className="workflow-fanout-stem-row" aria-hidden>
                <span
                  className={`workflow-fanout-stem workflow-connector-line ${connectorClass(
                    analystConnectorState,
                  )}`}
                />
              </div>
              <div
                aria-hidden
                className={`workflow-branch-grid ${connectorClass(
                  analystConnectorState,
                )} ${
                  analystStages.length === 1 ? 'workflow-branch-grid-single' : ''
                }`}
                style={analystGridStyle}
              >
                {analystStages.map((stage) => (
                  <span
                    className={`workflow-branch-cell ${connectorClass(
                      stage.statusLabel,
                    )}`}
                    key={stage.key}
                  >
                    <span
                      className={`workflow-branch-drop workflow-connector-line ${connectorClass(
                        stage.statusLabel,
                      )}`}
                    />
                  </span>
                ))}
              </div>
              <div
                className="workflow-org-row workflow-org-row-agents"
                style={analystGridStyle}
              >
                {analystStages.map((stage) => (
                  <div className="workflow-agent-slot" key={stage.key}>
                    <WorkflowNode
                      stage={stage}
                      timing={timingByStage.get(stage.key)}
                      variant="analyst"
                    />
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {sequentialStages.map((stage) => (
            <div className="workflow-sequence" key={stage.key}>
              <span
                className={`workflow-sequence-connector workflow-connector-line ${connectorClass(
                  stage.statusLabel,
                )}`}
                aria-hidden
              />
              <div className="workflow-org-row workflow-org-row-single">
                <WorkflowNode
                  stage={stage}
                  timing={timingByStage.get(stage.key)}
                  variant="manager"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkflowNode({
  stage,
  timing,
  variant,
}: {
  stage: WorkflowVisualizationStage;
  timing?: ResearchRunStageTimingResponse;
  variant: 'signal' | 'analyst' | 'manager';
}) {
  const Icon = stage.icon;
  return (
    <article className={`workflow-node workflow-node-${variant} workflow-state-${stateClass(stage.statusLabel)}`}>
      <div className="workflow-node-main">
        <span className="pipeline-icon">
          <Icon aria-hidden size={17} />
        </span>
        <div className="workflow-node-copy">
          <div className="workflow-node-kicker">{nodeKicker(stage, variant)}</div>
          <h3>{stage.label}</h3>
          <p>{stage.detail}</p>
        </div>
        <span className={stage.badgeClass}>{stage.statusLabel}</span>
      </div>
      <div className="workflow-node-meta small">
        <span>Dur {formatDuration(timing?.duration_ms)}</span>
        <span>Events {timing?.source_event_ids.length ?? 0}</span>
        <span>Start {formatDateTime(timing?.started_at)}</span>
      </div>
      {stage.warning ? (
        <div className="workflow-warning small">{stage.warning}</div>
      ) : null}
      {stage.confidence !== null ? (
        <ConfidenceBadge value={stage.confidence} />
      ) : null}
    </article>
  );
}

function nodeKicker(
  stage: WorkflowVisualizationStage,
  variant: 'signal' | 'analyst' | 'manager',
): string {
  if (variant === 'signal') {
    return 'signal layer';
  }
  if (variant === 'analyst') {
    return 'parallel analyst';
  }
  if (stage.key === 'spot_checks' || stage.key === 'perp_checks') {
    return 'market branch';
  }
  return 'sequential agent';
}

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'n/a';
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  const seconds = value / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function stateClass(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

function connectorClass(value: string): string {
  return `workflow-connector-${stateClass(value)}`;
}

function terminalStagesComplete({
  signalStage,
  analystStages,
  sequentialStages,
}: {
  signalStage?: WorkflowVisualizationStage;
  analystStages: WorkflowVisualizationStage[];
  sequentialStages: WorkflowVisualizationStage[];
}): boolean {
  const terminalStages =
    sequentialStages.length > 0
      ? [sequentialStages[sequentialStages.length - 1]]
      : analystStages.length > 0
        ? analystStages
        : signalStage
          ? [signalStage]
          : [];

  return terminalStages.length > 0 && terminalStages.every(isCompleteStage);
}

function isCompleteStage(stage: WorkflowVisualizationStage): boolean {
  const state = stateClass(stage.statusLabel);
  return state === 'ready' || state === 'completed';
}

function analystGridVariables(count: number): CSSProperties {
  const rowWidth = analystRowWidth(count);
  return {
    '--analyst-count': count,
    '--analyst-width': `${ANALYST_NODE_WIDTH}px`,
    '--analyst-gap': `${ANALYST_GAP}px`,
    '--analyst-row-width': `${rowWidth}px`,
  } as CSSProperties;
}

function workflowCanvasVariables(count: number): CSSProperties {
  return {
    '--workflow-canvas-width': `${Math.max(680, analystRowWidth(count) + 64)}px`,
  } as CSSProperties;
}

function analystRowWidth(count: number): number {
  return count * ANALYST_NODE_WIDTH + Math.max(0, count - 1) * ANALYST_GAP;
}

function groupConnectorState(stages: WorkflowVisualizationStage[]): string {
  const states = stages.map((stage) => stateClass(stage.statusLabel));
  if (states.includes('running')) {
    return 'running';
  }
  if (states.includes('failed')) {
    return 'failed';
  }
  if (states.length > 0 && states.every((state) => state === 'ready' || state === 'completed')) {
    return 'ready';
  }
  if (states.includes('missing')) {
    return 'missing';
  }
  return 'pending';
}
