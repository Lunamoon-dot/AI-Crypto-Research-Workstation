import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { normalizeOptionalCryptoSymbol } from '../common/market-symbols';
import { clampListLimit } from '../common/query-limit';
import { AuthService } from '../auth/auth.service';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
  ThesisEvaluationInput,
  ThesisEvaluationPromotionInput,
  ThesisEvaluationRunInput,
} from '../database/journal.types';
import { PythonEngineClient } from '../jobs/python-engine.client';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  CalibrationEvaluationResponse,
  CalibrationEvaluationRerunResponse,
  CalibrationEvaluationVersionPolicyResponse,
  CalibrationResult,
  PromoteCalibrationEvaluationResponse,
  AgentCalibrationAgentResponse,
  AgentCalibrationOutcomeBucket,
  AgentCalibrationRelation,
  AgentCalibrationReportResponse,
  AgentCalibrationRowResponse,
  AgentCalibrationStance,
  AgentCalibrationVerdict,
  ApplyMaturedEvaluationsResponse,
  CreateCalibrationEvaluationRerunResponse,
  EvaluateThesisResponse,
  MaturedEvaluationApplyRowResponse,
  MaturedEvaluationPreviewStatus,
  MaturedEvaluationPreviewRowResponse,
  MaturedEvaluationReason,
  PreviewMaturedEvaluationsResponse,
  RecordCalibrationOutcomeReviewResponse,
  SymbolCalibrationConsistencyStatus,
  SymbolCalibrationCoverageStatus,
  SymbolCalibrationOutcomeStatus,
  SymbolCalibrationReportResponse,
  SymbolCalibrationRowResponse,
  SymbolCalibrationStance,
  SymbolCalibrationVerdict,
  ThesisReviewResponse,
  toMaturedEvaluationApplyRowResponse,
  toMaturedEvaluationPreviewRowResponse,
  toCalibrationEvaluationRerunResponse,
  toCalibrationEvaluationPromotionResponse,
  toCalibrationEvaluationResponse,
  toThesisReviewResponse,
} from '../contracts/frontend-contract';
import { AgentCalibrationQueryDto } from './dto/agent-calibration.dto';
import {
  CreateEvaluationRerunDto,
  EVALUATION_RERUN_REASONS,
  EvaluationRerunReason,
} from './dto/evaluation-rerun.dto';
import { EvaluationVersionPolicyActionDto } from './dto/evaluation-version-policy.dto';
import { EvaluateThesisDto } from './dto/evaluate-thesis.dto';
import {
  ApplyMaturedEvaluationsDto,
  PreviewMaturedEvaluationsDto,
} from './dto/matured-evaluations.dto';
import { CalibrationOutcomeReviewDto } from './dto/outcome-review.dto';
import { SymbolCalibrationQueryDto } from './dto/symbol-calibration.dto';

const WINDOW_PRESETS = new Set([7, 14, 30]);
const SYMBOL_WINDOW_PRESETS = new Set([7, 14, 30]);
const LOOKBACK_PRESETS = new Set([30, 60, 90]);
const DEFAULT_SYMBOL_WINDOW_DAYS = 7;
const DEFAULT_SYMBOL_LOOKBACK_DAYS = 30;
const DEFAULT_AGENT_WINDOW_DAYS = 7;
const DEFAULT_AGENT_LOOKBACK_DAYS = 30;
const DEFAULT_SCAN_LIMIT = 100;
const MAX_SCAN_LIMIT = 500;
const DEFAULT_MAX_BATCH = 10;
const MAX_BATCH = 25;
const DEFAULT_RERUN_LIMIT = 20;
const MAX_RERUN_LIMIT = 50;
const DEFAULT_PROMOTION_LIMIT = 50;
const SYMBOL_CALIBRATION_ROW_LIMIT = 20;
const AGENT_CALIBRATION_ROW_LIMIT = 30;
const RERUN_SOURCE = 'calibration_lab_v1_3_rerun';
const PROMOTION_SOURCE = 'calibration_lab_v1_5_version_policy';
let lastPromotionTimestampMs = 0;
const MATERIAL_RETURN = 0.02;
const MATERIAL_DRAWDOWN = -0.04;
const RECORDABLE_RESULTS = new Set([
  'hit_target',
  'invalidated',
  'mixed',
  'expired',
]);
type MaturedEvaluationRow = JsonRecord & MaturedEvaluationPreviewRowResponse & {
  status: MaturedEvaluationPreviewStatus;
  reason: MaturedEvaluationReason | null;
  evaluation: JsonRecord | null;
  thesis: JsonRecord;
};

type ClassifiedSymbolStance = Exclude<SymbolCalibrationStance, 'mixed'>;

type SymbolCalibrationSourceRow = {
  thesis: JsonRecord;
  evaluation: JsonRecord | null;
  row: SymbolCalibrationRowResponse;
  stance: ClassifiedSymbolStance;
};

type AgentCalibrationSourceRow = {
  opinionId: string;
  agentName: string;
  agentRole: string;
  agentStance: AgentCalibrationStance;
  confidence: number | null;
  createdAt: string | null;
  debateId: string | null;
  researchRunId: string | null;
  thesisId: string | null;
  symbol: string | null;
  thesisDirection: AgentCalibrationStance;
  evaluationId: string | null;
  baseEvaluationId: string | null;
  activeSource: 'base_canonical' | 'promoted_rerun' | null;
  activeRerunId: string | null;
  activePromotionId: string | null;
  evaluationResult: CalibrationResult | null;
  relationToFinal: AgentCalibrationRelation;
  outcomeBucket: AgentCalibrationOutcomeBucket;
};

@Injectable()
export class CalibrationService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
    private readonly pythonEngine: PythonEngineClient,
  ) {}

  async evaluateThesis(
    dto: EvaluateThesisDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<EvaluateThesisResponse> {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    return this.evaluateThesisForWorkspace(
      dto.thesis_id,
      dto.window_days,
      workspaceId,
      'calibration_lab_v1',
    );
  }

  async previewMaturedEvaluations(
    dto: PreviewMaturedEvaluationsDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<PreviewMaturedEvaluationsResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const windowDays = normalizeWindowDays(dto.window_days);
    const scanLimit = normalizeScanLimit(dto.scan_limit);
    const symbol = normalizeSymbolFilter(dto.symbol);
    const rows = await this.collectMaturedRows(
      { windowDays, scanLimit, symbol },
      workspaceId,
    );
    const responseRows = rows.map((row) =>
      toMaturedEvaluationPreviewRowResponse(row),
    );

    return {
      window_days: windowDays,
      scan_limit: scanLimit,
      symbol: symbol ?? null,
      summary: {
        candidate: responseRows.filter((row) => row.status === 'candidate').length,
        existing: responseRows.filter((row) => row.status === 'existing').length,
        not_mature: responseRows.filter((row) => row.status === 'not_mature').length,
        invalid_thesis: responseRows.filter(
          (row) => row.status === 'invalid_thesis',
        ).length,
      },
      rows: responseRows,
    };
  }

  async applyMaturedEvaluations(
    dto: ApplyMaturedEvaluationsDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ApplyMaturedEvaluationsResponse> {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    const windowDays = normalizeWindowDays(dto.window_days);
    const maxBatch = normalizeMaxBatch(dto.max_batch);
    const symbol = normalizeSymbolFilter(dto.symbol);
    const rows = await this.collectMaturedRows(
      { windowDays, scanLimit: MAX_SCAN_LIMIT, symbol },
      workspaceId,
    );
    const responseRows: MaturedEvaluationApplyRowResponse[] = [];
    let processedCandidates = 0;

    for (const row of rows) {
      if (row.status === 'existing') {
        responseRows.push(
          toMaturedEvaluationApplyRowResponse({
            ...row,
            status: 'existing',
            result: evaluationResult(row.evaluation),
            warnings: evaluationWarnings(row.evaluation),
            message: null,
          }),
        );
        continue;
      }

      if (row.status !== 'candidate') {
        responseRows.push(
          toMaturedEvaluationApplyRowResponse({
            ...row,
            status: 'skipped',
            result: null,
            warnings: [],
            message: null,
          }),
        );
        continue;
      }

      if (processedCandidates >= maxBatch) {
        responseRows.push(
          toMaturedEvaluationApplyRowResponse({
            ...row,
            status: 'skipped',
            reason: 'max_batch_excluded',
            result: null,
            warnings: [],
            message: null,
          }),
        );
        continue;
      }

      processedCandidates += 1;
      try {
        const evaluated = await this.evaluateThesisForWorkspace(
          row.thesis_id,
          windowDays,
          workspaceId,
          'calibration_lab_v1_1_batch',
        );
        responseRows.push(
          toMaturedEvaluationApplyRowResponse({
            ...row,
            status: evaluated.created ? 'created' : 'existing',
            reason: evaluated.created ? null : 'evaluation_already_exists',
            evaluation_id: evaluated.evaluation.id,
            result: evaluated.evaluation.result,
            warnings: evaluated.warnings,
            message: null,
          }),
        );
      } catch (error) {
        responseRows.push(
          toMaturedEvaluationApplyRowResponse({
            ...row,
            status: 'failed',
            reason: batchFailureReason(error),
            evaluation_id: null,
            result: null,
            warnings: [],
            message: errorMessage(error),
          }),
        );
      }
    }

    return {
      window_days: windowDays,
      max_batch: maxBatch,
      symbol: symbol ?? null,
      summary: {
        created: responseRows.filter((row) => row.status === 'created').length,
        existing: responseRows.filter((row) => row.status === 'existing').length,
        skipped: responseRows.filter((row) => row.status === 'skipped').length,
        failed: responseRows.filter((row) => row.status === 'failed').length,
      },
      rows: responseRows,
    };
  }

  async getSymbolCalibrationReport(
    dto: SymbolCalibrationQueryDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<SymbolCalibrationReportResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const symbol = normalizeRequiredSymbol(dto.symbol);
    const windowDays = normalizeSymbolWindowDays(dto.window_days);
    const lookbackDays = normalizeLookbackDays(dto.lookback_days);
    const todayUtc = todayUtcDate();
    const periodEnd = addDaysIsoDate(todayUtc, -(windowDays + 1));
    const periodStart = addDaysIsoDate(periodEnd, -(lookbackDays - 1));
    const theses = await this.requireSymbolCalibrationThesisList()(
      { symbol, periodStart, periodEnd },
      workspaceId,
    );
    const sourceRows: SymbolCalibrationSourceRow[] = [];

    for (const thesis of theses) {
      const row = await this.buildSymbolCalibrationRow(
        thesis,
        {
          symbol,
          windowDays,
          periodStart,
          periodEnd,
          todayUtc,
        },
        workspaceId,
      );
      if (row) {
        sourceRows.push(row);
      }
    }

    const rows = sourceRows
      .map((sourceRow) => sourceRow.row)
      .sort(compareSymbolCalibrationRows)
      .slice(0, SYMBOL_CALIBRATION_ROW_LIMIT);
    const evaluatedRows = sourceRows.filter((row) => row.evaluation);
    const maturedThesisCount = sourceRows.length;
    const evaluatedCount = evaluatedRows.length;
    const missingEvaluationCount = maturedThesisCount - evaluatedCount;
    const stance = buildSymbolCalibrationStance(sourceRows);
    const outcome = buildSymbolCalibrationOutcome(
      evaluatedRows,
      stance.consensus_stance,
    );

    return {
      symbol,
      window_days: windowDays,
      lookback_days: lookbackDays,
      period_start: periodStart,
      period_end: periodEnd,
      coverage_status: symbolCalibrationCoverageStatus({
        maturedThesisCount,
        evaluatedCount,
        missingEvaluationCount,
      }),
      consistency_status: symbolCalibrationConsistencyStatus(stance),
      outcome_status: symbolCalibrationOutcomeStatus(evaluatedRows.length, outcome),
      coverage: {
        matured_thesis_count: maturedThesisCount,
        evaluated_count: evaluatedCount,
        missing_evaluation_count: missingEvaluationCount,
        coverage_pct: rate(evaluatedCount, maturedThesisCount),
      },
      stance,
      outcome,
      rows,
    };
  }

  async getAgentCalibrationReport(
    dto: AgentCalibrationQueryDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<AgentCalibrationReportResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const symbol = normalizeSymbolFilter(dto.symbol) ?? null;
    const windowDays = normalizeAgentWindowDays(dto.window_days);
    const lookbackDays = normalizeAgentLookbackDays(dto.lookback_days);
    const todayUtc = todayUtcDate();
    const periodEnd = addDaysIsoDate(todayUtc, -(windowDays + 1));
    const periodStart = addDaysIsoDate(periodEnd, -(lookbackDays - 1));
    const sourceRows = await this.requireAgentCalibrationSourceRows()(
      {
        symbol: symbol ?? undefined,
        periodStart,
        periodEnd,
        windowDays,
      },
      workspaceId,
    );
    const activeSourceRows = await this.applyActiveEvaluationToAgentRows(
      sourceRows,
      workspaceId,
    );
    const classifiedRows = activeSourceRows.map(toAgentCalibrationSourceRow);
    const rows = classifiedRows
      .map(toAgentCalibrationRowResponse)
      .sort(compareAgentCalibrationRows)
      .slice(0, AGENT_CALIBRATION_ROW_LIMIT);

    return {
      window_days: windowDays,
      lookback_days: lookbackDays,
      symbol,
      period_start: periodStart,
      period_end: periodEnd,
      coverage: buildAgentCalibrationCoverage(classifiedRows),
      agents: buildAgentCalibrationAgents(classifiedRows),
      rows,
    };
  }

  private async evaluateThesisForWorkspace(
    thesisId: string,
    windowDaysValue: number | undefined,
    workspaceId: string,
    source: string,
  ): Promise<EvaluateThesisResponse> {
    const windowDays = normalizeWindowDays(windowDaysValue);
    const thesis = await this.getThesis(thesisId, workspaceId);
    const evaluationStart = thesisStartDate(thesis);
    const evaluationEnd = addDaysIsoDate(evaluationStart, windowDays);
    const existing = await this.requireEvaluationNaturalKeyRead()(
      {
        thesisId,
        windowDays,
        evaluationStart,
        evaluationEnd,
      },
      workspaceId,
    );
    if (existing) {
      const evaluation = toCalibrationEvaluationResponse(existing);
      return {
        created: false,
        evaluation,
        warnings: evaluation.warnings,
      };
    }

    const engineResult = await this.pythonEngine.evaluateThesis({
      thesis_id: thesisId,
      workspace_id: workspaceId,
      window_days: windowDays,
      metadata: { source },
    });
    if (engineResult.error_type || engineResult.status !== 'completed') {
      throw engineError(
        engineResult,
        `Evaluation for thesis ${thesisId} failed`,
      );
    }
    const engineEvaluation = recordFromValue(engineResult.evaluation);
    if (!engineEvaluation) {
      throw new ServiceUnavailableException(
        `Evaluation for thesis ${thesisId} did not return an evaluation payload.`,
      );
    }
    const warnings = uniqueStrings([
      ...stringList(engineResult.warnings),
      ...stringList(engineEvaluation.warnings),
    ]);
    const saved = await this.requireEvaluationWrite()(
      buildEvaluationInput({
        engineEvaluation,
        thesis,
        workspaceId,
        thesisId,
        windowDays,
        evaluationStart,
        evaluationEnd,
        warnings,
      }),
      workspaceId,
    );
    const evaluation = toCalibrationEvaluationResponse(saved.evaluation);
    return {
      created: saved.created,
      evaluation,
      warnings: uniqueStrings([...warnings, ...evaluation.warnings]),
    };
  }

  async listEvaluations(
    options: { thesisId?: string; limit?: number },
    userId?: string,
    workspaceHeader?: string,
  ): Promise<CalibrationEvaluationResponse[]> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const rows = await this.requireEvaluationList()(
      {
        thesisId: optionalString(options.thesisId),
        limit: clampListLimit(options.limit ?? 50, {
          defaultLimit: 50,
          maxLimit: 200,
        }),
      },
      workspaceId,
    );
    return rows.map(toCalibrationEvaluationResponse);
  }

  async getEvaluation(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<CalibrationEvaluationResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const evaluation = await this.requireEvaluationRead()(id, workspaceId);
    if (!evaluation) {
      throw new NotFoundException(`Evaluation ${id} not found`);
    }
    return this.resolveActiveEvaluationFromCanonical(evaluation, workspaceId);
  }

  async getEvaluationVersionPolicy(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<CalibrationEvaluationVersionPolicyResponse> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const evaluation = await this.requireEvaluationRead()(id, workspaceId);
    if (!evaluation) {
      throw new NotFoundException(`Evaluation ${id} not found`);
    }
    return this.buildVersionPolicy(evaluation, workspaceId);
  }

  async promoteEvaluationRerun(
    id: string,
    rerunId: string,
    dto: EvaluationVersionPolicyActionDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<PromoteCalibrationEvaluationResponse> {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    const rawEvaluation = await this.requireEvaluationRead()(id, workspaceId);
    if (!rawEvaluation) {
      throw new NotFoundException(`Evaluation ${id} not found`);
    }
    const reason = normalizeRerunReason(dto.reason);
    const notes = optionalString(dto.notes?.trim()) ?? null;
    const idempotencyKey = optionalString(dto.idempotency_key?.trim()) ?? null;

    if (idempotencyKey) {
      const existing = await this.requirePromotionIdempotencyRead()(
        { canonicalEvaluationId: id, idempotencyKey },
        workspaceId,
      );
      if (existing) {
        return this.buildPromotionActionResponse(
          false,
          existing,
          rawEvaluation,
          workspaceId,
          ['promotion_already_exists'],
        );
      }
    }

    const canonical = toCalibrationEvaluationResponse(rawEvaluation);
    if (canonical.outcome_review_id) {
      return this.buildPromotionActionResponse(
        false,
        null,
        rawEvaluation,
        workspaceId,
        ['review_already_recorded'],
      );
    }

    const rerun = await this.requireEvaluationRunRead()(rerunId, workspaceId);
    if (!rerun) {
      return this.buildPromotionActionResponse(
        false,
        null,
        rawEvaluation,
        workspaceId,
        ['rerun_not_found'],
      );
    }
    const rerunResponse = toCalibrationEvaluationRerunResponse(rerun);
    if (rerunResponse.canonical_evaluation_id !== id) {
      return this.buildPromotionActionResponse(
        false,
        null,
        rawEvaluation,
        workspaceId,
        ['rerun_mismatch'],
      );
    }
    if (rerunResponse.status !== 'completed') {
      return this.buildPromotionActionResponse(
        false,
        null,
        rawEvaluation,
        workspaceId,
        ['rerun_not_completed'],
      );
    }

    const latest = await this.requireLatestPromotionRead()(id, workspaceId);
    if (
      latest &&
      toCalibrationEvaluationPromotionResponse(latest).action === 'promote_rerun' &&
      nullablePromotionRerunId(latest) === rerunId
    ) {
      return this.buildPromotionActionResponse(
        false,
        null,
        rawEvaluation,
        workspaceId,
        ['promotion_already_active'],
      );
    }

    const saved = await this.requirePromotionWrite()(
      buildPromotionInput({
        action: 'promote_rerun',
        canonicalEvaluationId: id,
        idempotencyKey,
        notes,
        promotedRerunId: rerunId,
        reason,
        userId,
        workspaceId,
      }),
      workspaceId,
    );
    return this.buildPromotionActionResponse(
      true,
      saved,
      rawEvaluation,
      workspaceId,
      [],
    );
  }

  async resetEvaluationVersionPolicy(
    id: string,
    dto: EvaluationVersionPolicyActionDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<PromoteCalibrationEvaluationResponse> {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    const rawEvaluation = await this.requireEvaluationRead()(id, workspaceId);
    if (!rawEvaluation) {
      throw new NotFoundException(`Evaluation ${id} not found`);
    }
    const reason = normalizeRerunReason(dto.reason);
    const notes = optionalString(dto.notes?.trim()) ?? null;
    const idempotencyKey = optionalString(dto.idempotency_key?.trim()) ?? null;

    if (idempotencyKey) {
      const existing = await this.requirePromotionIdempotencyRead()(
        { canonicalEvaluationId: id, idempotencyKey },
        workspaceId,
      );
      if (existing) {
        return this.buildPromotionActionResponse(
          false,
          existing,
          rawEvaluation,
          workspaceId,
          ['promotion_already_exists'],
        );
      }
    }

    const canonical = toCalibrationEvaluationResponse(rawEvaluation);
    if (canonical.outcome_review_id) {
      return this.buildPromotionActionResponse(
        false,
        null,
        rawEvaluation,
        workspaceId,
        ['review_already_recorded'],
      );
    }

    const latest = await this.requireLatestPromotionRead()(id, workspaceId);
    if (
      !latest ||
      toCalibrationEvaluationPromotionResponse(latest).action === 'reset_to_base'
    ) {
      return this.buildPromotionActionResponse(
        false,
        null,
        rawEvaluation,
        workspaceId,
        ['base_already_active'],
      );
    }

    const saved = await this.requirePromotionWrite()(
      buildPromotionInput({
        action: 'reset_to_base',
        canonicalEvaluationId: id,
        idempotencyKey,
        notes,
        promotedRerunId: null,
        reason,
        userId,
        workspaceId,
      }),
      workspaceId,
    );
    return this.buildPromotionActionResponse(
      true,
      saved,
      rawEvaluation,
      workspaceId,
      [],
    );
  }

  async listEvaluationReruns(
    id: string,
    options: { limit?: number },
    userId?: string,
    workspaceHeader?: string,
  ): Promise<CalibrationEvaluationRerunResponse[]> {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader);
    const evaluation = await this.requireEvaluationRead()(id, workspaceId);
    if (!evaluation) {
      throw new NotFoundException(`Evaluation ${id} not found`);
    }
    const rows = await this.requireEvaluationRunList()(
      {
        canonicalEvaluationId: id,
        limit: clampListLimit(options.limit ?? DEFAULT_RERUN_LIMIT, {
          defaultLimit: DEFAULT_RERUN_LIMIT,
          maxLimit: MAX_RERUN_LIMIT,
        }),
      },
      workspaceId,
    );
    return rows.map(toCalibrationEvaluationRerunResponse);
  }

  async createEvaluationRerun(
    id: string,
    dto: CreateEvaluationRerunDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<CreateCalibrationEvaluationRerunResponse> {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    const runWrite = this.requireEvaluationRunWrite();
    const rawEvaluation = await this.requireEvaluationRead()(id, workspaceId);
    if (!rawEvaluation) {
      throw new NotFoundException(`Evaluation ${id} not found`);
    }
    const canonical = toCalibrationEvaluationResponse(rawEvaluation);
    const reason = normalizeRerunReason(dto.reason);
    const notes = optionalString(dto.notes?.trim()) ?? null;
    const idempotencyKey = optionalString(dto.idempotency_key?.trim()) ?? null;

    if (idempotencyKey) {
      const existing = await this.requireEvaluationRunIdempotencyRead()(
        {
          canonicalEvaluationId: id,
          idempotencyKey,
        },
        workspaceId,
      );
      if (existing) {
        return {
          created: false,
          rerun: toCalibrationEvaluationRerunResponse(existing),
          warnings: ['rerun_already_exists'],
        };
      }
    }

    const requestedAt = new Date().toISOString();
    let engineResult: JsonRecord | null = null;
    try {
      engineResult = await this.pythonEngine.evaluateThesis({
        thesis_id: canonical.thesis_id,
        workspace_id: workspaceId,
        window_days: canonical.window_days,
        metadata: {
          source: RERUN_SOURCE,
          canonical_evaluation_id: id,
          rerun_reason: reason,
        },
      });
      if (engineResult.error_type || engineResult.status !== 'completed') {
        throw engineError(
          engineResult,
          `Rerun evaluation for ${id} failed`,
        );
      }
      const engineEvaluation = recordFromValue(engineResult.evaluation);
      if (!engineEvaluation) {
        throw new ServiceUnavailableException(
          `Rerun evaluation for ${id} did not return an evaluation payload.`,
        );
      }
      const warnings = uniqueStrings([
        ...stringList(engineResult.warnings),
        ...stringList(engineEvaluation.warnings),
      ]);
      const run = buildCompletedEvaluationRunInput({
        canonical,
        engineEvaluation,
        engineResult,
        id,
        idempotencyKey,
        notes,
        reason,
        requestedAt,
        userId,
        warnings,
        workspaceId,
      });
      const saved = await runWrite(run, workspaceId);
      return {
        created: true,
        rerun: toCalibrationEvaluationRerunResponse(saved),
        warnings,
      };
    } catch (error) {
      const failedRun = buildFailedEvaluationRunInput({
        canonical,
        engineResult,
        error,
        id,
        idempotencyKey,
        notes,
        reason,
        requestedAt,
        userId,
        workspaceId,
      });
      await runWrite(failedRun, workspaceId);
      throw error;
    }
  }

  async recordOutcomeReview(
    id: string,
    dto: CalibrationOutcomeReviewDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<RecordCalibrationOutcomeReviewResponse> {
    const workspaceId = await this.resolveWorkspace(
      userId,
      workspaceHeader,
      'editor',
    );
    const rawEvaluation = await this.requireEvaluationRead()(id, workspaceId);
    if (!rawEvaluation) {
      throw new NotFoundException(`Evaluation ${id} not found`);
    }
    const evaluation = toCalibrationEvaluationResponse(rawEvaluation);
    const existingReview = evaluation.outcome_review_id
      ? await this.requireOutcomeReviewRead()(
          evaluation.outcome_review_id,
          workspaceId,
        )
      : null;
    if (existingReview) {
      return {
        created: false,
        outcome_review: toThesisReviewResponse(existingReview),
        evaluation,
        warnings: ['review_already_recorded'],
      };
    }

    const blockers = recordReviewBlockers(evaluation);
    if (blockers.length > 0) {
      return {
        created: false,
        outcome_review: null,
        evaluation: {
          ...evaluation,
          can_record_review: false,
          record_review_blockers: blockers,
        },
        warnings: blockers,
      };
    }

    const notes = optionalString(dto.notes?.trim()) ?? defaultOutcomeReviewNote(evaluation);
    const review = await this.journal.recordThesisReview(
      evaluation.thesis_id,
      evaluation.result,
      notes,
      workspaceId,
      {
        max_favorable_excursion: evaluation.max_favorable_excursion,
        max_adverse_excursion: evaluation.max_adverse_excursion,
        metadata: {
          source: 'calibration_lab',
          evaluation_id: evaluation.id,
          window_days: evaluation.window_days,
        },
      },
    );
    const linked =
      (await this.requireEvaluationReviewLink()(
        id,
        stringValue(review.id),
        workspaceId,
      )) ?? rawEvaluation;
    return {
      created: true,
      outcome_review: toThesisReviewResponse(review) as ThesisReviewResponse,
      evaluation: toCalibrationEvaluationResponse(linked),
      warnings: [],
    };
  }

  private async resolveWorkspace(
    userId?: string,
    workspaceHeader?: string,
    requiredRole: 'viewer' | 'editor' = 'viewer',
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, requiredRole);
    return workspaceId;
  }

  private async getThesis(
    id: string,
    workspaceId: string,
  ): Promise<JsonRecord> {
    const thesis = await this.journal.getThesis(id, workspaceId);
    if (!thesis) {
      throw new NotFoundException(`Thesis ${id} not found`);
    }
    return thesis;
  }

  private async collectMaturedRows(
    options: { windowDays: number; scanLimit: number; symbol?: string },
    workspaceId: string,
  ): Promise<MaturedEvaluationRow[]> {
    const theses = await this.requireMaturedThesisList()(
      {
        limit: options.scanLimit,
        symbol: options.symbol,
      },
      workspaceId,
    );
    const todayUtc = todayUtcDate();
    const rows: MaturedEvaluationRow[] = [];

    for (const thesis of theses) {
      const row = await this.buildMaturedRow(
        thesis,
        options.windowDays,
        todayUtc,
        workspaceId,
      );
      if (
        options.symbol &&
        normalizeSymbolFilter(row.symbol) !== options.symbol
      ) {
        continue;
      }
      rows.push(row);
    }

    return rows.sort(compareMaturedRows);
  }

  private async buildMaturedRow(
    thesis: JsonRecord,
    windowDays: number,
    todayUtc: string,
    workspaceId: string,
  ): Promise<MaturedEvaluationRow> {
    const thesisId = stringValue(thesis.id);
    const symbol = stringValue(thesis.symbol);
    const createdAt = optionalString(thesis.created_at);
    const base = {
      thesis_id: thesisId,
      symbol,
      created_at: createdAt ?? null,
      window_days: windowDays,
      evaluation_start: null,
      evaluation_end: null,
      evaluation_id: null,
      thesis,
      evaluation: null,
    };

    if (!createdAt) {
      return {
        ...base,
        status: 'invalid_thesis',
        reason: 'missing_created_at',
      };
    }

    const parsedCreatedAt = new Date(createdAt);
    if (!Number.isFinite(parsedCreatedAt.getTime())) {
      return {
        ...base,
        status: 'invalid_thesis',
        reason: 'invalid_created_at',
      };
    }

    const evaluationStart = parsedCreatedAt.toISOString().slice(0, 10);
    const evaluationEnd = addDaysIsoDate(evaluationStart, windowDays);
    const datedBase = {
      ...base,
      evaluation_start: evaluationStart,
      evaluation_end: evaluationEnd,
    };

    if (!symbol) {
      return {
        ...datedBase,
        status: 'invalid_thesis',
        reason: 'missing_symbol',
      };
    }

    const existing = await this.requireEvaluationNaturalKeyRead()(
      {
        thesisId,
        windowDays,
        evaluationStart,
        evaluationEnd,
      },
      workspaceId,
    );
    if (existing) {
      return {
        ...datedBase,
        status: 'existing',
        reason: 'evaluation_already_exists',
        evaluation_id: optionalString(existing.id) ?? null,
        evaluation: existing,
      };
    }

    if (evaluationEnd >= todayUtc) {
      return {
        ...datedBase,
        status: 'not_mature',
        reason: 'window_not_closed',
      };
    }

    return {
      ...datedBase,
      status: 'candidate',
      reason: null,
    };
  }

  private async buildSymbolCalibrationRow(
    thesis: JsonRecord,
    options: {
      symbol: string;
      windowDays: number;
      periodStart: string;
      periodEnd: string;
      todayUtc: string;
    },
    workspaceId: string,
  ): Promise<SymbolCalibrationSourceRow | null> {
    const thesisId = stringValue(thesis.id);
    const symbol = stringValue(thesis.symbol);
    if (
      !thesisId ||
      !symbol ||
      normalizeSymbolFilter(symbol) !== options.symbol
    ) {
      return null;
    }

    const createdAt = optionalString(thesis.created_at);
    if (!createdAt) {
      return null;
    }
    const parsedCreatedAt = new Date(createdAt);
    if (!Number.isFinite(parsedCreatedAt.getTime())) {
      return null;
    }

    const evaluationStart = parsedCreatedAt.toISOString().slice(0, 10);
    if (
      evaluationStart < options.periodStart ||
      evaluationStart > options.periodEnd
    ) {
      return null;
    }

    const evaluationEnd = addDaysIsoDate(evaluationStart, options.windowDays);
    if (evaluationEnd >= options.todayUtc) {
      return null;
    }

    const evaluation = await this.requireEvaluationNaturalKeyRead()(
      {
        thesisId,
        windowDays: options.windowDays,
        evaluationStart,
        evaluationEnd,
      },
      workspaceId,
    );
    const activeEvaluation = evaluation
      ? await this.resolveActiveEvaluationFromCanonical(evaluation, workspaceId)
      : null;
    const stance = symbolCalibrationStance(thesis);

    return {
      thesis,
      evaluation: activeEvaluation as unknown as JsonRecord | null,
      stance,
      row: {
        thesis_id: thesisId,
        created_at: createdAt,
        symbol,
        stance,
        direction: stringValue(thesis.direction),
        confidence: numberValue(thesis.confidence),
        status: evaluation ? 'evaluated' : 'missing_evaluation',
        evaluation_id: activeEvaluation?.id ?? null,
        base_evaluation_id: activeEvaluation?.base_evaluation_id ?? null,
        active_source: activeEvaluation?.active_source ?? null,
        active_rerun_id: activeEvaluation?.active_rerun_id ?? null,
        active_promotion_id: activeEvaluation?.active_promotion_id ?? null,
        result: activeEvaluation ? activeEvaluation.result : null,
        max_favorable_excursion: evaluation
          ? activeEvaluation?.max_favorable_excursion ?? null
          : null,
        max_adverse_excursion: evaluation
          ? activeEvaluation?.max_adverse_excursion ?? null
          : null,
      },
    };
  }

  private async applyActiveEvaluationToAgentRows(
    rows: JsonRecord[],
    workspaceId: string,
  ): Promise<JsonRecord[]> {
    const activeByEvaluationId = new Map<string, CalibrationEvaluationResponse>();
    const activeRows: JsonRecord[] = [];
    for (const row of rows) {
      const evaluationId = optionalString(row.evaluation_id);
      if (!evaluationId) {
        activeRows.push({
          ...row,
          base_evaluation_id: null,
          active_source: null,
          active_rerun_id: null,
          active_promotion_id: null,
        });
        continue;
      }
      let active = activeByEvaluationId.get(evaluationId);
      if (!active) {
        active = await this.resolveActiveEvaluation(evaluationId, workspaceId);
        activeByEvaluationId.set(evaluationId, active);
      }
      activeRows.push({
        ...row,
        evaluation_id: active.id,
        base_evaluation_id: active.base_evaluation_id,
        active_source: active.active_source,
        active_rerun_id: active.active_rerun_id,
        active_promotion_id: active.active_promotion_id,
        evaluation_result: active.result,
      });
    }
    return activeRows;
  }

  private async resolveActiveEvaluation(
    id: string,
    workspaceId: string,
  ): Promise<CalibrationEvaluationResponse> {
    const evaluation = await this.requireEvaluationRead()(id, workspaceId);
    if (!evaluation) {
      throw new NotFoundException(`Evaluation ${id} not found`);
    }
    return this.resolveActiveEvaluationFromCanonical(evaluation, workspaceId);
  }

  private async resolveActiveEvaluationFromCanonical(
    rawEvaluation: JsonRecord,
    workspaceId: string,
  ): Promise<CalibrationEvaluationResponse> {
    const canonical = toCalibrationEvaluationResponse(rawEvaluation);
    const canonicalId = stringValue(canonical.id);
    const latest = canonicalId
      ? await this.requireLatestPromotionRead()(canonicalId, workspaceId)
      : null;
    if (
      !latest ||
      toCalibrationEvaluationPromotionResponse(latest).action === 'reset_to_base'
    ) {
      return toBaseActiveEvaluation(canonical, latest ? stringValue(latest.id) : null);
    }

    const promotedRerunId = nullablePromotionRerunId(latest);
    const rerun = promotedRerunId
      ? await this.requireEvaluationRunRead()(promotedRerunId, workspaceId)
      : null;
    if (!rerun) {
      return toBaseActiveEvaluation(canonical, stringValue(latest.id));
    }
    return toPromotedActiveEvaluation(
      canonical,
      toCalibrationEvaluationRerunResponse(rerun),
      stringValue(latest.id),
    );
  }

  private async buildVersionPolicy(
    rawEvaluation: JsonRecord,
    workspaceId: string,
  ): Promise<CalibrationEvaluationVersionPolicyResponse> {
    const baseEvaluation = toBaseActiveEvaluation(
      toCalibrationEvaluationResponse(rawEvaluation),
      null,
    );
    const activeEvaluation = await this.resolveActiveEvaluationFromCanonical(
      rawEvaluation,
      workspaceId,
    );
    const canonicalEvaluationId = stringValue(baseEvaluation.id);
    const events = canonicalEvaluationId
      ? await this.requirePromotionList()(
          {
            canonicalEvaluationId,
            limit: DEFAULT_PROMOTION_LIMIT,
          },
          workspaceId,
        )
      : [];
    return {
      canonical_evaluation_id: canonicalEvaluationId,
      active_source: activeEvaluation.active_source,
      active_rerun_id: activeEvaluation.active_rerun_id,
      active_promotion_id: activeEvaluation.active_promotion_id,
      base_evaluation: baseEvaluation,
      active_evaluation: activeEvaluation,
      events: events.map(toCalibrationEvaluationPromotionResponse),
      warnings: [],
    };
  }

  private async buildPromotionActionResponse(
    created: boolean,
    event: JsonRecord | null,
    rawEvaluation: JsonRecord,
    workspaceId: string,
    warnings: string[],
  ): Promise<PromoteCalibrationEvaluationResponse> {
    return {
      created,
      event: event ? toCalibrationEvaluationPromotionResponse(event) : null,
      policy: await this.buildVersionPolicy(rawEvaluation, workspaceId),
      warnings,
    };
  }

  private requireMaturedThesisList() {
    if (!this.journal.listThesesForMaturedEvaluation) {
      throw new ServiceUnavailableException(
        'Calibration requires matured thesis candidate listing support.',
      );
    }
    return this.journal.listThesesForMaturedEvaluation.bind(this.journal);
  }

  private requireSymbolCalibrationThesisList() {
    if (!this.journal.listThesesForSymbolCalibration) {
      throw new ServiceUnavailableException(
        'Calibration requires symbol calibration thesis listing support.',
      );
    }
    return this.journal.listThesesForSymbolCalibration.bind(this.journal);
  }

  private requireAgentCalibrationSourceRows() {
    if (!this.journal.listAgentCalibrationSourceRows) {
      throw new ServiceUnavailableException(
        'Calibration requires agent calibration source row support.',
      );
    }
    return this.journal.listAgentCalibrationSourceRows.bind(this.journal);
  }

  private requireEvaluationNaturalKeyRead() {
    if (!this.journal.getThesisEvaluationByNaturalKey) {
      throw new ServiceUnavailableException(
        'Calibration requires thesis evaluation natural-key reads.',
      );
    }
    return this.journal.getThesisEvaluationByNaturalKey.bind(this.journal);
  }

  private requireEvaluationWrite() {
    if (!this.journal.upsertThesisEvaluation) {
      throw new ServiceUnavailableException(
        'Calibration requires thesis evaluation writes.',
      );
    }
    return this.journal.upsertThesisEvaluation.bind(this.journal);
  }

  private requireEvaluationList() {
    if (!this.journal.listThesisEvaluations) {
      throw new ServiceUnavailableException(
        'Calibration requires thesis evaluation list support.',
      );
    }
    return this.journal.listThesisEvaluations.bind(this.journal);
  }

  private requireEvaluationRead() {
    if (!this.journal.getThesisEvaluation) {
      throw new ServiceUnavailableException(
        'Calibration requires thesis evaluation reads.',
      );
    }
    return this.journal.getThesisEvaluation.bind(this.journal);
  }

  private requireEvaluationRunList() {
    if (!this.journal.listThesisEvaluationRuns) {
      throw new ServiceUnavailableException(
        'Calibration requires thesis evaluation rerun list support.',
      );
    }
    return this.journal.listThesisEvaluationRuns.bind(this.journal);
  }

  private requireEvaluationRunIdempotencyRead() {
    if (!this.journal.getThesisEvaluationRunByIdempotencyKey) {
      throw new ServiceUnavailableException(
        'Calibration requires thesis evaluation rerun idempotency support.',
      );
    }
    return this.journal.getThesisEvaluationRunByIdempotencyKey.bind(this.journal);
  }

  private requireEvaluationRunRead() {
    if (!this.journal.getThesisEvaluationRun) {
      throw new ServiceUnavailableException(
        'Calibration requires thesis evaluation rerun reads.',
      );
    }
    return this.journal.getThesisEvaluationRun.bind(this.journal);
  }

  private requireEvaluationRunWrite() {
    if (!this.journal.createThesisEvaluationRun) {
      throw new ServiceUnavailableException(
        'Calibration requires thesis evaluation rerun writes.',
      );
    }
    return this.journal.createThesisEvaluationRun.bind(this.journal);
  }

  private requirePromotionList() {
    if (!this.journal.listThesisEvaluationPromotions) {
      throw new ServiceUnavailableException(
        'Calibration requires thesis evaluation promotion list support.',
      );
    }
    return this.journal.listThesisEvaluationPromotions.bind(this.journal);
  }

  private requireLatestPromotionRead() {
    if (!this.journal.getLatestThesisEvaluationPromotion) {
      throw new ServiceUnavailableException(
        'Calibration requires thesis evaluation latest promotion support.',
      );
    }
    return this.journal.getLatestThesisEvaluationPromotion.bind(this.journal);
  }

  private requirePromotionIdempotencyRead() {
    if (!this.journal.getThesisEvaluationPromotionByIdempotencyKey) {
      throw new ServiceUnavailableException(
        'Calibration requires thesis evaluation promotion idempotency support.',
      );
    }
    return this.journal.getThesisEvaluationPromotionByIdempotencyKey.bind(
      this.journal,
    );
  }

  private requirePromotionWrite() {
    if (!this.journal.createThesisEvaluationPromotion) {
      throw new ServiceUnavailableException(
        'Calibration requires thesis evaluation promotion writes.',
      );
    }
    return this.journal.createThesisEvaluationPromotion.bind(this.journal);
  }

  private requireEvaluationReviewLink() {
    if (!this.journal.linkThesisEvaluationOutcomeReview) {
      throw new ServiceUnavailableException(
        'Calibration requires thesis evaluation review links.',
      );
    }
    return this.journal.linkThesisEvaluationOutcomeReview.bind(this.journal);
  }

  private requireOutcomeReviewRead() {
    if (!this.journal.getOutcomeReview) {
      throw new ServiceUnavailableException(
        'Calibration requires outcome review reads.',
      );
    }
    return this.journal.getOutcomeReview.bind(this.journal);
  }
}

function buildEvaluationInput(input: {
  engineEvaluation: JsonRecord;
  thesis: JsonRecord;
  workspaceId: string;
  thesisId: string;
  windowDays: number;
  evaluationStart: string;
  evaluationEnd: string;
  warnings: string[];
}): ThesisEvaluationInput {
  const evidence = recordFromValue(input.engineEvaluation.evidence) ?? {
    start_price: numberValue(input.engineEvaluation.start_price),
    end_price: numberValue(input.engineEvaluation.end_price),
    highest_high: numberValue(input.engineEvaluation.max_high),
    lowest_low: numberValue(input.engineEvaluation.min_low),
    target_hit: booleanValue(input.engineEvaluation.target_hit),
    invalidation_hit: booleanValue(input.engineEvaluation.invalidated),
  };
  return {
    id: optionalString(input.engineEvaluation.id),
    workspace_id: input.workspaceId,
    thesis_id: input.thesisId,
    outcome_review_id: optionalString(input.engineEvaluation.outcome_review_id),
    symbol: stringValue(input.engineEvaluation.symbol, stringValue(input.thesis.symbol)),
    window_days: input.windowDays,
    evaluation_start: optionalString(input.engineEvaluation.evaluation_start) ?? input.evaluationStart,
    evaluation_end: optionalString(input.engineEvaluation.evaluation_end) ?? input.evaluationEnd,
    evaluated_at: optionalString(input.engineEvaluation.evaluated_at),
    result: stringValue(input.engineEvaluation.result, 'unknown'),
    max_favorable_excursion: numberValue(
      input.engineEvaluation.max_favorable_excursion,
    ),
    max_adverse_excursion: numberValue(input.engineEvaluation.max_adverse_excursion),
    invalidated: booleanValue(input.engineEvaluation.invalidated),
    warnings: input.warnings,
    evidence,
    payload: {
      ...input.engineEvaluation,
      workspace_id: input.workspaceId,
      warnings: input.warnings,
      evidence,
    },
  };
}

function buildCompletedEvaluationRunInput(input: {
  canonical: CalibrationEvaluationResponse;
  engineEvaluation: JsonRecord;
  engineResult: JsonRecord;
  id: string;
  idempotencyKey: string | null;
  notes: string | null;
  reason: EvaluationRerunReason;
  requestedAt: string;
  userId?: string;
  warnings: string[];
  workspaceId: string;
}): ThesisEvaluationRunInput {
  const evidence = recordFromValue(input.engineEvaluation.evidence) ?? {
    start_price: numberValue(input.engineEvaluation.start_price),
    end_price: numberValue(input.engineEvaluation.end_price),
    highest_high: numberValue(input.engineEvaluation.max_high),
    lowest_low: numberValue(input.engineEvaluation.min_low),
    target_hit: booleanValue(input.engineEvaluation.target_hit),
    invalidation_hit: booleanValue(input.engineEvaluation.invalidated),
  };
  const result = stringValue(input.engineEvaluation.result, 'unknown');
  const maxFavorableExcursion = numberValue(
    input.engineEvaluation.max_favorable_excursion,
  );
  const maxAdverseExcursion = numberValue(
    input.engineEvaluation.max_adverse_excursion,
  );
  const invalidated = booleanValue(input.engineEvaluation.invalidated);
  const evaluatedAt =
    optionalString(input.engineEvaluation.evaluated_at) ?? new Date().toISOString();
  const rerun = {
    result,
    max_favorable_excursion: maxFavorableExcursion,
    max_adverse_excursion: maxAdverseExcursion,
    invalidated,
    warnings: input.warnings,
    evidence,
  };
  return {
    workspace_id: input.workspaceId,
    canonical_evaluation_id: input.id,
    thesis_id: input.canonical.thesis_id,
    symbol: input.canonical.symbol,
    window_days: input.canonical.window_days,
    evaluation_start: requiredDate(
      input.canonical.evaluation_start,
      'evaluation_start',
    ),
    evaluation_end: requiredDate(input.canonical.evaluation_end, 'evaluation_end'),
    requested_by_user_id: optionalString(input.userId) ?? null,
    requested_at: input.requestedAt,
    evaluated_at: evaluatedAt,
    source: RERUN_SOURCE,
    reason: input.reason,
    notes: input.notes,
    idempotency_key: input.idempotencyKey,
    status: 'completed',
    result,
    max_favorable_excursion: maxFavorableExcursion,
    max_adverse_excursion: maxAdverseExcursion,
    invalidated,
    warnings: input.warnings,
    evidence,
    diff: buildEvaluationRerunDiff(input.canonical, rerun),
    error_type: null,
    error_message: null,
    payload: input.engineResult,
  };
}

function buildFailedEvaluationRunInput(input: {
  canonical: CalibrationEvaluationResponse;
  engineResult: JsonRecord | null;
  error: unknown;
  id: string;
  idempotencyKey: string | null;
  notes: string | null;
  reason: EvaluationRerunReason;
  requestedAt: string;
  userId?: string;
  workspaceId: string;
}): ThesisEvaluationRunInput {
  return {
    workspace_id: input.workspaceId,
    canonical_evaluation_id: input.id,
    thesis_id: input.canonical.thesis_id,
    symbol: input.canonical.symbol,
    window_days: input.canonical.window_days,
    evaluation_start: requiredDate(
      input.canonical.evaluation_start,
      'evaluation_start',
    ),
    evaluation_end: requiredDate(input.canonical.evaluation_end, 'evaluation_end'),
    requested_by_user_id: optionalString(input.userId) ?? null,
    requested_at: input.requestedAt,
    evaluated_at: null,
    source: RERUN_SOURCE,
    reason: input.reason,
    notes: input.notes,
    idempotency_key: input.idempotencyKey,
    status: 'failed',
    result: null,
    max_favorable_excursion: null,
    max_adverse_excursion: null,
    invalidated: null,
    warnings: stringList(input.engineResult?.warnings),
    evidence: {},
    diff: {},
    error_type:
      optionalString(input.engineResult?.error_type) ??
      (input.error instanceof Error ? input.error.name : 'Error'),
    error_message:
      optionalString(input.engineResult?.error) ?? errorMessage(input.error),
    payload: input.engineResult ?? { error: errorMessage(input.error) },
  };
}

function buildPromotionInput(input: {
  action: 'promote_rerun' | 'reset_to_base';
  canonicalEvaluationId: string;
  idempotencyKey: string | null;
  notes: string | null;
  promotedRerunId: string | null;
  reason: EvaluationRerunReason;
  userId?: string;
  workspaceId: string;
}): ThesisEvaluationPromotionInput {
  const promotedAt = nextPromotionTimestamp();
  return {
    workspace_id: input.workspaceId,
    canonical_evaluation_id: input.canonicalEvaluationId,
    promoted_rerun_id: input.promotedRerunId,
    action: input.action,
    promoted_by_user_id: optionalString(input.userId) ?? null,
    promoted_at: promotedAt,
    reason: input.reason,
    notes: input.notes,
    idempotency_key: input.idempotencyKey,
    payload: {
      source: PROMOTION_SOURCE,
      canonical_evaluation_id: input.canonicalEvaluationId,
      promoted_rerun_id: input.promotedRerunId,
      action: input.action,
      promoted_at: promotedAt,
      reason: input.reason,
    },
  };
}

function nextPromotionTimestamp(): string {
  const now = Date.now();
  const next =
    now <= lastPromotionTimestampMs ? lastPromotionTimestampMs + 1 : now;
  lastPromotionTimestampMs = next;
  return new Date(next).toISOString();
}

function toBaseActiveEvaluation(
  canonical: CalibrationEvaluationResponse,
  activePromotionId: string | null,
): CalibrationEvaluationResponse {
  return toCalibrationEvaluationResponse({
    ...canonical,
    base_evaluation_id: canonical.id,
    active_source: 'base_canonical',
    active_rerun_id: null,
    active_promotion_id: activePromotionId,
    payload: canonical.payload,
  });
}

function toPromotedActiveEvaluation(
  canonical: CalibrationEvaluationResponse,
  rerun: CalibrationEvaluationRerunResponse,
  activePromotionId: string,
): CalibrationEvaluationResponse {
  return toCalibrationEvaluationResponse({
    id: canonical.id,
    base_evaluation_id: canonical.id,
    workspace_id: canonical.workspace_id,
    thesis_id: canonical.thesis_id,
    outcome_review_id: canonical.outcome_review_id,
    symbol: canonical.symbol,
    window_days: canonical.window_days,
    evaluation_start: canonical.evaluation_start,
    evaluation_end: canonical.evaluation_end,
    evaluated_at: rerun.evaluated_at,
    result: rerun.result ?? 'unknown',
    max_favorable_excursion: rerun.max_favorable_excursion,
    max_adverse_excursion: rerun.max_adverse_excursion,
    invalidated: rerun.invalidated ?? false,
    warnings: rerun.warnings,
    evidence: rerun.evidence,
    calendar_mature: canonical.calendar_mature,
    active_source: 'promoted_rerun',
    active_rerun_id: rerun.id,
    active_promotion_id: activePromotionId,
    payload: rerun.payload,
  });
}

function nullablePromotionRerunId(promotion: JsonRecord): string | null {
  return optionalString(promotion.promoted_rerun_id) ?? null;
}

function recordReviewBlockers(
  evaluation: CalibrationEvaluationResponse,
): Array<'incomplete_window' | 'unknown_result' | 'review_already_recorded'> {
  const blockers: Array<
    'incomplete_window' | 'unknown_result' | 'review_already_recorded'
  > = [];
  if (!evaluation.calendar_mature) {
    blockers.push('incomplete_window');
  }
  if (!RECORDABLE_RESULTS.has(evaluation.result)) {
    blockers.push('unknown_result');
  }
  if (evaluation.outcome_review_id) {
    blockers.push('review_already_recorded');
  }
  return blockers;
}

function defaultOutcomeReviewNote(
  evaluation: CalibrationEvaluationResponse,
): string {
  return `Auto-recorded from Calibration Lab evaluation ${evaluation.id ?? 'unknown'} over ${evaluation.window_days} day(s). Result: ${evaluation.result}. MFE: ${formatPercent(evaluation.max_favorable_excursion)}. MAE: ${formatPercent(evaluation.max_adverse_excursion)}.`;
}

function buildEvaluationRerunDiff(
  canonical: CalibrationEvaluationResponse,
  rerun: {
    result: string;
    max_favorable_excursion: number | null;
    max_adverse_excursion: number | null;
    invalidated: boolean;
    warnings: string[];
    evidence: JsonRecord;
  },
): JsonRecord {
  const canonicalWarnings = new Set(canonical.warnings);
  const rerunWarnings = new Set(rerun.warnings);
  return {
    result_changed: canonical.result !== rerun.result,
    canonical_result: canonical.result,
    rerun_result: rerun.result,
    mfe_delta: metricDelta(
      canonical.max_favorable_excursion,
      rerun.max_favorable_excursion,
    ),
    mae_delta: metricDelta(
      canonical.max_adverse_excursion,
      rerun.max_adverse_excursion,
    ),
    invalidated_changed: canonical.invalidated !== rerun.invalidated,
    warnings_added: [...rerunWarnings]
      .filter((warning) => !canonicalWarnings.has(warning))
      .sort(),
    warnings_removed: [...canonicalWarnings]
      .filter((warning) => !rerunWarnings.has(warning))
      .sort(),
    start_price_delta: metricDelta(
      numberValue(canonical.evidence.start_price),
      numberValue(rerun.evidence.start_price),
    ),
    end_price_delta: metricDelta(
      numberValue(canonical.evidence.end_price),
      numberValue(rerun.evidence.end_price),
    ),
  };
}

function metricDelta(
  canonicalValue: number | null,
  rerunValue: number | null,
): number | null {
  if (canonicalValue === null || rerunValue === null) {
    return null;
  }
  return roundMetric(rerunValue - canonicalValue);
}

function requiredDate(value: string | null, field: string): string {
  if (!value) {
    throw new ServiceUnavailableException(
      `Canonical evaluation ${field} is required for rerun audit.`,
    );
  }
  return value;
}

function thesisStartDate(thesis: JsonRecord): string {
  const createdAt = optionalString(thesis.created_at);
  if (!createdAt) {
    throw new ServiceUnavailableException('Thesis created_at is required for evaluation.');
  }
  const parsed = new Date(createdAt);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ServiceUnavailableException('Thesis created_at is not a valid date.');
  }
  return parsed.toISOString().slice(0, 10);
}

function addDaysIsoDate(value: string, days: number): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function normalizeWindowDays(value: number | undefined): number {
  const normalized = value ?? 14;
  if (!WINDOW_PRESETS.has(normalized)) {
    throw new BadRequestException('window_days must be one of 7, 14, or 30.');
  }
  return normalized;
}

function normalizeSymbolWindowDays(value: number | undefined): number {
  const normalized = value ?? DEFAULT_SYMBOL_WINDOW_DAYS;
  if (!SYMBOL_WINDOW_PRESETS.has(normalized)) {
    throw new BadRequestException('window_days must be one of 7, 14, or 30.');
  }
  return normalized;
}

function normalizeAgentWindowDays(value: number | undefined): number {
  const normalized = value ?? DEFAULT_AGENT_WINDOW_DAYS;
  if (!SYMBOL_WINDOW_PRESETS.has(normalized)) {
    throw new BadRequestException('window_days must be one of 7, 14, or 30.');
  }
  return normalized;
}

function normalizeLookbackDays(value: number | undefined): number {
  const normalized = value ?? DEFAULT_SYMBOL_LOOKBACK_DAYS;
  if (!LOOKBACK_PRESETS.has(normalized)) {
    throw new BadRequestException('lookback_days must be one of 30, 60, or 90.');
  }
  return normalized;
}

function normalizeAgentLookbackDays(value: number | undefined): number {
  const normalized = value ?? DEFAULT_AGENT_LOOKBACK_DAYS;
  if (!LOOKBACK_PRESETS.has(normalized)) {
    throw new BadRequestException('lookback_days must be one of 30, 60, or 90.');
  }
  return normalized;
}

function normalizeRequiredSymbol(value: unknown): string {
  const symbol = normalizeSymbolFilter(value);
  if (!symbol) {
    throw new BadRequestException('symbol is required.');
  }
  return symbol;
}

function normalizeScanLimit(value: number | undefined): number {
  const normalized = value ?? DEFAULT_SCAN_LIMIT;
  if (
    !Number.isInteger(normalized) ||
    normalized < 1 ||
    normalized > MAX_SCAN_LIMIT
  ) {
    throw new BadRequestException('scan_limit must be an integer from 1 to 500.');
  }
  return normalized;
}

function normalizeMaxBatch(value: number | undefined): number {
  const normalized = value ?? DEFAULT_MAX_BATCH;
  if (
    !Number.isInteger(normalized) ||
    normalized < 1 ||
    normalized > MAX_BATCH
  ) {
    throw new BadRequestException('max_batch must be an integer from 1 to 25.');
  }
  return normalized;
}

function normalizeRerunReason(value: unknown): EvaluationRerunReason {
  if (
    EVALUATION_RERUN_REASONS.includes(value as EvaluationRerunReason)
  ) {
    return value as EvaluationRerunReason;
  }
  throw new BadRequestException('reason must be a valid rerun reason.');
}

function normalizeSymbolFilter(value: unknown): string | undefined {
  const text = optionalString(value)?.trim();
  return text ? normalizeOptionalCryptoSymbol(text) : undefined;
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function compareMaturedRows(
  left: MaturedEvaluationRow,
  right: MaturedEvaluationRow,
): number {
  return (
    compareStrings(left.evaluation_end, right.evaluation_end) ||
    compareStrings(left.created_at, right.created_at) ||
    left.thesis_id.localeCompare(right.thesis_id)
  );
}

function compareStrings(left: string | null, right: string | null): number {
  return (left ?? '9999-12-31').localeCompare(right ?? '9999-12-31');
}

function compareSymbolCalibrationRows(
  left: SymbolCalibrationRowResponse,
  right: SymbolCalibrationRowResponse,
): number {
  return (
    (right.created_at ?? '').localeCompare(left.created_at ?? '') ||
    left.thesis_id.localeCompare(right.thesis_id)
  );
}

function compareAgentCalibrationRows(
  left: AgentCalibrationRowResponse,
  right: AgentCalibrationRowResponse,
): number {
  return (
    (right.created_at ?? '').localeCompare(left.created_at ?? '') ||
    (left.research_run_id ?? '').localeCompare(right.research_run_id ?? '') ||
    left.agent_role.localeCompare(right.agent_role)
  );
}

function toAgentCalibrationSourceRow(row: JsonRecord): AgentCalibrationSourceRow {
  const thesisId = optionalString(row.thesis_id) ?? null;
  const evaluationId = optionalString(row.evaluation_id) ?? null;
  const agentStance = mappedAgentCalibrationStance(row.agent_stance);
  const thesisDirection = mappedAgentCalibrationStance(row.thesis_direction);
  const relationToFinal = agentCalibrationRelation({
    agentStance,
    thesisDirection,
    hasThesis: Boolean(thesisId),
  });
  const evaluationResult = evaluationId
    ? calibrationResultFromValue(row.evaluation_result)
    : null;
  const outcomeBucket = agentCalibrationOutcomeBucket(
    relationToFinal,
    evaluationResult,
  );

  return {
    opinionId: stringValue(row.opinion_id),
    agentName: stringValue(row.agent_name, 'Unknown agent'),
    agentRole: stringValue(row.agent_role, 'unknown'),
    agentStance,
    confidence: numberValue(row.confidence),
    createdAt: optionalString(row.created_at) ?? null,
    debateId: optionalString(row.debate_id) ?? null,
    researchRunId: optionalString(row.research_run_id) ?? null,
    thesisId,
    symbol: optionalString(row.symbol) ?? null,
    thesisDirection,
    evaluationId,
    baseEvaluationId: optionalString(row.base_evaluation_id) ?? null,
    activeSource:
      row.active_source === 'base_canonical' ||
      row.active_source === 'promoted_rerun'
        ? row.active_source
        : null,
    activeRerunId: optionalString(row.active_rerun_id) ?? null,
    activePromotionId: optionalString(row.active_promotion_id) ?? null,
    evaluationResult,
    relationToFinal,
    outcomeBucket,
  };
}

function toAgentCalibrationRowResponse(
  row: AgentCalibrationSourceRow,
): AgentCalibrationRowResponse {
  return {
    agent_role: row.agentRole,
    agent_name: row.agentName,
    research_run_id: row.researchRunId,
    debate_id: row.debateId,
    thesis_id: row.thesisId,
    symbol: row.symbol,
    thesis_direction: row.thesisDirection,
    agent_stance: row.agentStance,
    relation_to_final: row.relationToFinal,
    evaluation_id: row.evaluationId,
    base_evaluation_id: row.baseEvaluationId,
    active_source: row.activeSource,
    active_rerun_id: row.activeRerunId,
    active_promotion_id: row.activePromotionId,
    evaluation_result: row.evaluationResult,
    outcome_bucket: row.outcomeBucket,
    confidence: row.confidence,
    created_at: row.createdAt,
  };
}

function buildAgentCalibrationCoverage(
  rows: AgentCalibrationSourceRow[],
) {
  const opinionCount = rows.length;
  const eligibleRows = rows.filter((row) => row.thesisId);
  const scoredOpinionCount = eligibleRows.filter(isScoredAgentOpinion).length;
  return {
    opinion_count: opinionCount,
    eligible_opinion_count: eligibleRows.length,
    scored_opinion_count: scoredOpinionCount,
    missing_evaluation_count: eligibleRows.filter((row) => !row.evaluationId).length,
    unlinked_opinion_count: rows.filter((row) => !row.thesisId).length,
    unknown_stance_count: rows.filter((row) => row.agentStance === 'unknown').length,
    unclear_relation_count: eligibleRows.filter(
      (row) => row.relationToFinal === 'unclear',
    ).length,
    coverage_pct: rate(eligibleRows.length, opinionCount),
  };
}

function buildAgentCalibrationAgents(
  rows: AgentCalibrationSourceRow[],
): AgentCalibrationAgentResponse[] {
  const groups = new Map<string, AgentCalibrationSourceRow[]>();
  for (const row of rows) {
    const current = groups.get(row.agentRole) ?? [];
    current.push(row);
    groups.set(row.agentRole, current);
  }

  return [...groups.entries()]
    .map(([agentRole, agentRows]) =>
      buildAgentCalibrationAgent(agentRole, agentRows),
    )
    .sort(compareAgentCalibrationAgents);
}

function buildAgentCalibrationAgent(
  agentRole: string,
  rows: AgentCalibrationSourceRow[],
): AgentCalibrationAgentResponse {
  const eligibleRows = rows.filter((row) => row.thesisId);
  const supportsFinalCount = eligibleRows.filter(
    (row) => row.relationToFinal === 'supports_final',
  ).length;
  const opposesFinalCount = eligibleRows.filter(
    (row) => row.relationToFinal === 'opposes_final',
  ).length;
  const supportedSuccessCount = eligibleRows.filter(
    (row) => row.outcomeBucket === 'supported_success',
  ).length;
  const supportedFailureCount = eligibleRows.filter(
    (row) => row.outcomeBucket === 'supported_failure',
  ).length;
  const contrarianSuccessCount = eligibleRows.filter(
    (row) => row.outcomeBucket === 'contrarian_success',
  ).length;
  const contrarianFailureCount = eligibleRows.filter(
    (row) => row.outcomeBucket === 'contrarian_failure',
  ).length;
  const alignmentSuccessRate = rate(
    supportedSuccessCount,
    supportedSuccessCount + supportedFailureCount,
  );
  const contrarianSuccessRate = rate(
    contrarianSuccessCount,
    contrarianSuccessCount + contrarianFailureCount,
  );
  const confidenceValues = eligibleRows
    .map((row) => row.confidence)
    .filter((value): value is number => value !== null);
  const agentNames = uniqueStrings(rows.map((row) => row.agentName)).sort();
  const classifiedOpinionCount = supportsFinalCount + opposesFinalCount;

  return {
    agent_role: agentRole,
    display_name: agentNames[0] ?? agentRole,
    agent_names: agentNames,
    opinion_count: rows.length,
    eligible_opinion_count: eligibleRows.length,
    classified_opinion_count: classifiedOpinionCount,
    coverage_pct: rate(eligibleRows.length, rows.length),
    supports_final_count: supportsFinalCount,
    opposes_final_count: opposesFinalCount,
    unclear_relation_count: eligibleRows.filter(
      (row) => row.relationToFinal === 'unclear',
    ).length,
    supported_success_count: supportedSuccessCount,
    supported_failure_count: supportedFailureCount,
    contrarian_success_count: contrarianSuccessCount,
    contrarian_failure_count: contrarianFailureCount,
    inconclusive_count: eligibleRows.filter(
      (row) => row.evaluationId && row.outcomeBucket === 'inconclusive',
    ).length,
    alignment_success_rate: alignmentSuccessRate,
    contrarian_success_rate: contrarianSuccessRate,
    avg_confidence: average(confidenceValues),
    verdict: agentCalibrationVerdict({
      alignmentSuccessRate,
      classifiedOpinionCount,
      contrarianSuccessRate,
      eligibleOpinionCount: eligibleRows.length,
      supportedDenominator: supportedSuccessCount + supportedFailureCount,
      contrarianDenominator: contrarianSuccessCount + contrarianFailureCount,
    }),
  };
}

function compareAgentCalibrationAgents(
  left: AgentCalibrationAgentResponse,
  right: AgentCalibrationAgentResponse,
): number {
  return (
    right.eligible_opinion_count - left.eligible_opinion_count ||
    compareNullableRateDesc(
      left.alignment_success_rate,
      right.alignment_success_rate,
    ) ||
    left.agent_role.localeCompare(right.agent_role)
  );
}

function compareNullableRateDesc(
  left: number | null,
  right: number | null,
): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return right - left;
}

function isScoredAgentOpinion(row: AgentCalibrationSourceRow): boolean {
  return (
    row.relationToFinal !== 'unclear' &&
    (row.evaluationResult === 'hit_target' ||
      row.evaluationResult === 'invalidated')
  );
}

function agentCalibrationVerdict(input: {
  alignmentSuccessRate: number | null;
  classifiedOpinionCount: number;
  contrarianDenominator: number;
  contrarianSuccessRate: number | null;
  eligibleOpinionCount: number;
  supportedDenominator: number;
}): AgentCalibrationVerdict {
  if (input.eligibleOpinionCount < 5 || input.classifiedOpinionCount < 3) {
    return 'insufficient_data';
  }
  if (
    input.alignmentSuccessRate !== null &&
    input.alignmentSuccessRate >= 0.65 &&
    input.supportedDenominator >= 5
  ) {
    return 'strong_aligned';
  }
  if (
    input.contrarianSuccessRate !== null &&
    input.contrarianSuccessRate >= 0.6 &&
    input.contrarianDenominator >= 3
  ) {
    return 'contrarian_signal';
  }
  if (
    input.alignmentSuccessRate !== null &&
    input.alignmentSuccessRate >= 0.55
  ) {
    return 'promising';
  }
  return 'mixed';
}

function agentCalibrationRelation(input: {
  agentStance: AgentCalibrationStance;
  hasThesis: boolean;
  thesisDirection: AgentCalibrationStance;
}): AgentCalibrationRelation {
  if (
    !input.hasThesis ||
    input.agentStance === 'unknown' ||
    input.thesisDirection === 'unknown' ||
    input.agentStance === 'neutral' ||
    input.thesisDirection === 'neutral'
  ) {
    return 'unclear';
  }
  return input.agentStance === input.thesisDirection
    ? 'supports_final'
    : 'opposes_final';
}

function agentCalibrationOutcomeBucket(
  relation: AgentCalibrationRelation,
  result: CalibrationResult | null,
): AgentCalibrationOutcomeBucket {
  if (relation === 'supports_final' && result === 'hit_target') {
    return 'supported_success';
  }
  if (relation === 'supports_final' && result === 'invalidated') {
    return 'supported_failure';
  }
  if (relation === 'opposes_final' && result === 'invalidated') {
    return 'contrarian_success';
  }
  if (relation === 'opposes_final' && result === 'hit_target') {
    return 'contrarian_failure';
  }
  return 'inconclusive';
}

function mappedAgentCalibrationStance(value: unknown): AgentCalibrationStance {
  const normalized = optionalString(value)
    ?.trim()
    .toLowerCase()
    .replaceAll('-', '_');
  if (!normalized) {
    return 'unknown';
  }
  if (['long', 'bullish', 'buy', 'overweight'].includes(normalized)) {
    return 'bullish';
  }
  if (['short', 'bearish', 'sell', 'underweight'].includes(normalized)) {
    return 'bearish';
  }
  if (['avoid', 'defensive', 'risk_off'].includes(normalized)) {
    return 'defensive';
  }
  if (['watch', 'neutral', 'hold'].includes(normalized)) {
    return 'neutral';
  }
  return 'unknown';
}

function calibrationResultFromValue(value: unknown): CalibrationResult {
  const result = optionalString(value);
  if (
    result === 'hit_target' ||
    result === 'invalidated' ||
    result === 'mixed' ||
    result === 'expired' ||
    result === 'unknown'
  ) {
    return result;
  }
  return 'unknown';
}

function buildSymbolCalibrationStance(rows: SymbolCalibrationSourceRow[]) {
  const stanceCounts = {
    bullish: 0,
    bearish: 0,
    defensive: 0,
    neutral: 0,
    unknown: 0,
  };
  for (const row of rows) {
    stanceCounts[row.stance] += 1;
  }

  const classified = [
    ['bullish', stanceCounts.bullish],
    ['bearish', stanceCounts.bearish],
    ['defensive', stanceCounts.defensive],
    ['neutral', stanceCounts.neutral],
  ] as const;
  const classifiedCount = classified.reduce((sum, [, count]) => sum + count, 0);
  if (classifiedCount === 0) {
    return {
      stance_counts: stanceCounts,
      consensus_stance: 'unknown' as const,
      conflict_rate: null,
    };
  }

  const topCount = Math.max(...classified.map(([, count]) => count));
  const topStances = classified.filter(([, count]) => count === topCount);
  return {
    stance_counts: stanceCounts,
    consensus_stance:
      topStances.length === 1 ? topStances[0][0] : ('mixed' as const),
    conflict_rate: rate(classifiedCount - topCount, classifiedCount),
  };
}

function buildSymbolCalibrationOutcome(
  rows: SymbolCalibrationSourceRow[],
  consensusStance: SymbolCalibrationStance,
) {
  const resultCounts = {
    hit_target: 0,
    invalidated: 0,
    mixed: 0,
    expired: 0,
    unknown: 0,
  };
  for (const row of rows) {
    const result = row.evaluation ? evaluationResult(row.evaluation) : null;
    resultCounts[result ?? 'unknown'] += 1;
  }

  const evaluatedCount = rows.length;
  const mfes = rows
    .map((row) => numberValue(row.evaluation?.max_favorable_excursion))
    .filter((value): value is number => value !== null);
  const maes = rows
    .map((row) => numberValue(row.evaluation?.max_adverse_excursion))
    .filter((value): value is number => value !== null);
  const returns = rows
    .map((row) => (row.evaluation ? evaluationReturn(row.evaluation) : null))
    .filter((value): value is number => value !== null);
  const representativeReturn = average(returns);
  const worstMae = minValue(maes);

  return {
    result_counts: resultCounts,
    hit_rate: rate(resultCounts.hit_target, evaluatedCount),
    invalidation_rate: rate(resultCounts.invalidated, evaluatedCount),
    mixed_rate: rate(resultCounts.mixed, evaluatedCount),
    expired_rate: rate(resultCounts.expired, evaluatedCount),
    unknown_rate: rate(resultCounts.unknown, evaluatedCount),
    avg_mfe: average(mfes),
    avg_mae: average(maes),
    best_mfe: maxValue(mfes),
    worst_mae: worstMae,
    representative_return: representativeReturn,
    verdict: symbolCalibrationVerdict({
      consensusStance,
      evaluatedCount,
      representativeReturn,
      worstMae,
    }),
  };
}

function symbolCalibrationCoverageStatus(input: {
  maturedThesisCount: number;
  evaluatedCount: number;
  missingEvaluationCount: number;
}): SymbolCalibrationCoverageStatus {
  if (input.maturedThesisCount === 0) {
    return 'empty';
  }
  if (input.missingEvaluationCount === 0) {
    return 'complete';
  }
  const coveragePct = rate(input.evaluatedCount, input.maturedThesisCount);
  if (
    (coveragePct !== null && coveragePct < 0.5) ||
    input.evaluatedCount < 3
  ) {
    return 'sparse';
  }
  return 'partial';
}

function symbolCalibrationConsistencyStatus(
  stance: ReturnType<typeof buildSymbolCalibrationStance>,
): SymbolCalibrationConsistencyStatus {
  const classifiedCount =
    stance.stance_counts.bullish +
    stance.stance_counts.bearish +
    stance.stance_counts.defensive +
    stance.stance_counts.neutral;
  if (classifiedCount === 0 || stance.conflict_rate === null) {
    return 'unclear';
  }
  return stance.conflict_rate <= 0.25 ? 'coherent' : 'mixed';
}

function symbolCalibrationOutcomeStatus(
  evaluatedCount: number,
  outcome: ReturnType<typeof buildSymbolCalibrationOutcome>,
): SymbolCalibrationOutcomeStatus {
  const decisiveCount =
    outcome.result_counts.hit_target + outcome.result_counts.invalidated;
  if (evaluatedCount === 0 || decisiveCount < 3) {
    return 'inconclusive';
  }
  if (outcome.result_counts.hit_target > outcome.result_counts.invalidated) {
    return 'favorable';
  }
  if (outcome.result_counts.invalidated > outcome.result_counts.hit_target) {
    return 'unfavorable';
  }
  return 'mixed';
}

function symbolCalibrationVerdict(input: {
  consensusStance: SymbolCalibrationStance;
  evaluatedCount: number;
  representativeReturn: number | null;
  worstMae: number | null;
}): SymbolCalibrationVerdict {
  if (
    input.evaluatedCount === 0 ||
    input.consensusStance === 'mixed' ||
    input.consensusStance === 'unknown'
  ) {
    return 'inconclusive';
  }

  const representativeReturn = input.representativeReturn;
  const worstMae = input.worstMae;
  if (
    input.consensusStance === 'defensive' &&
    worstMae !== null &&
    worstMae <= MATERIAL_DRAWDOWN
  ) {
    return 'correct';
  }
  if (representativeReturn === null) {
    return 'inconclusive';
  }
  if (input.consensusStance === 'bullish') {
    return representativeReturn >= MATERIAL_RETURN ? 'correct' : 'incorrect';
  }
  if (input.consensusStance === 'bearish') {
    return representativeReturn <= -MATERIAL_RETURN ? 'correct' : 'incorrect';
  }
  if (input.consensusStance === 'defensive') {
    return representativeReturn <= 0 ? 'correct' : 'incorrect';
  }
  return Math.abs(representativeReturn) < MATERIAL_RETURN
    ? 'correct'
    : 'incorrect';
}

function symbolCalibrationStance(thesis: JsonRecord): ClassifiedSymbolStance {
  const directionStance = mappedSymbolStance(thesis.direction);
  if (directionStance !== 'unknown') {
    return directionStance;
  }

  const payload = recordFromValue(thesis.payload) ?? {};
  const payloadStructuredSummary =
    recordFromValue(payload.structured_summary) ?? {};
  const payloadSummary = recordFromValue(payload.summary) ?? {};
  const structuredSummary = recordFromValue(thesis.structured_summary) ?? {};
  const summary = recordFromValue(thesis.summary) ?? {};
  return firstMappedSymbolStance(
    payloadStructuredSummary.stance,
    payloadSummary.stance,
    payload.stance,
    structuredSummary.stance,
    summary.stance,
    thesis.stance,
  );
}

function firstMappedSymbolStance(
  ...values: unknown[]
): ClassifiedSymbolStance {
  for (const value of values) {
    const stance = mappedSymbolStance(value);
    if (stance !== 'unknown') {
      return stance;
    }
  }
  return 'unknown';
}

function mappedSymbolStance(value: unknown): ClassifiedSymbolStance {
  const normalized = optionalString(value)?.trim().toLowerCase();
  if (!normalized) {
    return 'unknown';
  }
  if (['long', 'bullish', 'overweight'].includes(normalized)) {
    return 'bullish';
  }
  if (['short', 'bearish', 'underweight'].includes(normalized)) {
    return 'bearish';
  }
  if (['avoid', 'defensive', 'risk_off', 'risk-off'].includes(normalized)) {
    return 'defensive';
  }
  if (['watch', 'neutral'].includes(normalized)) {
    return 'neutral';
  }
  return 'unknown';
}

function evaluationReturn(evaluation: JsonRecord): number | null {
  const evidence = recordFromValue(evaluation.evidence) ?? {};
  const payload = recordFromValue(evaluation.payload) ?? {};
  const payloadEvidence = recordFromValue(payload.evidence) ?? {};
  const startPrice = numberValue(
    evaluation.start_price ?? evidence.start_price ?? payloadEvidence.start_price,
  );
  const endPrice = numberValue(
    evaluation.end_price ?? evidence.end_price ?? payloadEvidence.end_price,
  );
  if (startPrice === null || startPrice <= 0 || endPrice === null) {
    return null;
  }
  return roundMetric((endPrice - startPrice) / startPrice);
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return roundMetric(numerator / denominator);
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function maxValue(values: number[]): number | null {
  return values.length > 0 ? roundMetric(Math.max(...values)) : null;
}

function minValue(values: number[]): number | null {
  return values.length > 0 ? roundMetric(Math.min(...values)) : null;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}

function evaluationResult(evaluation: JsonRecord | null): CalibrationResult | null {
  return evaluation ? toCalibrationEvaluationResponse(evaluation).result : null;
}

function evaluationWarnings(evaluation: JsonRecord | null): string[] {
  return evaluation ? toCalibrationEvaluationResponse(evaluation).warnings : [];
}

function batchFailureReason(error: unknown): MaturedEvaluationReason {
  const message = errorMessage(error).toLowerCase();
  if (
    message.includes('provider') ||
    message.includes('ohlcv') ||
    message.includes('candle') ||
    message.includes('market data')
  ) {
    return 'provider_error';
  }
  if (error instanceof Error) {
    return 'engine_error';
  }
  return 'unknown_error';
}

function errorMessage(error: unknown): string {
  const response =
    error &&
    typeof error === 'object' &&
    'getResponse' in error &&
    typeof (error as { getResponse?: unknown }).getResponse === 'function'
      ? (error as { getResponse: () => unknown }).getResponse()
      : null;
  if (typeof response === 'string') {
    return response;
  }
  if (response && typeof response === 'object') {
    const message = (response as { message?: unknown }).message;
    if (Array.isArray(message)) {
      return message.join(', ');
    }
    if (message) {
      return String(message);
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error.';
}

function recordFromValue(value: unknown): JsonRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return null;
}

function stringValue(value: unknown, fallback = ''): string {
  const text = optionalString(value);
  return text ?? fallback;
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  return String(value);
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const normalized = optionalString(value)?.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => optionalString(item))
    .filter((item): item is string => Boolean(item));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }
  return `${(value * 100).toFixed(1)}%`;
}

function engineError(result: JsonRecord, fallback: string): Error {
  const message = stringValue(result.error, fallback);
  const type = stringValue(result.error_type);
  if (type.includes('ValueError')) {
    return new BadRequestException(message);
  }
  return new ServiceUnavailableException(message);
}
