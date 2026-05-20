import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
  ThesisEvaluationInput,
} from '../database/journal.types';
import { PythonEngineClient } from '../jobs/python-engine.client';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  CalibrationEvaluationResponse,
  EvaluateThesisResponse,
  RecordCalibrationOutcomeReviewResponse,
  ThesisReviewResponse,
  toCalibrationEvaluationResponse,
  toThesisReviewResponse,
} from '../contracts/frontend-contract';
import { clampListLimit } from '../common/query-limit';
import { EvaluateThesisDto } from './dto/evaluate-thesis.dto';
import { CalibrationOutcomeReviewDto } from './dto/outcome-review.dto';

const WINDOW_PRESETS = new Set([7, 14, 30]);
const RECORDABLE_RESULTS = new Set([
  'hit_target',
  'invalidated',
  'mixed',
  'expired',
]);

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
    const windowDays = normalizeWindowDays(dto.window_days);
    const thesis = await this.getThesis(dto.thesis_id, workspaceId);
    const evaluationStart = thesisStartDate(thesis);
    const evaluationEnd = addDaysIsoDate(evaluationStart, windowDays);
    const existing = await this.requireEvaluationNaturalKeyRead()(
      {
        thesisId: dto.thesis_id,
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
      thesis_id: dto.thesis_id,
      workspace_id: workspaceId,
      window_days: windowDays,
      metadata: { source: 'calibration_lab_v1' },
    });
    if (engineResult.error_type || engineResult.status !== 'completed') {
      throw engineError(
        engineResult,
        `Evaluation for thesis ${dto.thesis_id} failed`,
      );
    }
    const engineEvaluation = recordFromValue(engineResult.evaluation);
    if (!engineEvaluation) {
      throw new ServiceUnavailableException(
        `Evaluation for thesis ${dto.thesis_id} did not return an evaluation payload.`,
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
        thesisId: dto.thesis_id,
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
    return toCalibrationEvaluationResponse(evaluation);
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
