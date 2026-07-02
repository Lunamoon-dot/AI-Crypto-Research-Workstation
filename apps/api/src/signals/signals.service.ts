import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
  JsonRecord,
} from '../database/journal.types';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  toSignalDetailResponse,
  toSignalResponse,
} from '../contracts/frontend-contract';
import { normalizeOptionalCryptoSymbol } from '../common/market-symbols';
import { clampListLimit } from '../common/query-limit';

@Injectable()
export class SignalsService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async list(
    symbol?: string,
    limit = 50,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'viewer');
    const signals = await this.journal.listSignals(
      normalizeOptionalCryptoSymbol(symbol),
      clampListLimit(limit, { defaultLimit: 50, maxLimit: 100 }),
      workspaceId,
    );
    return signals.map(toSignalResponse);
  }

  async count(symbol?: string, userId?: string, workspaceHeader?: string) {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'viewer');
    return this.journal.summarizeSignals(
      normalizeOptionalCryptoSymbol(symbol),
      workspaceId,
    );
  }

  async get(id: string, userId?: string, workspaceHeader?: string) {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, 'viewer');
    const signal = await this.journal.getSignal(id, workspaceId);
    if (!signal) {
      throw new NotFoundException(`Signal ${id} not found`);
    }
    return toSignalDetailResponse(signal);
  }

  async listObservations(
    filters: {
      symbol?: string;
      factor?: string;
      signalSnapshotId?: string;
      from?: string;
      to?: string;
      limit?: number;
    },
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    if (!this.journal.listSignalObservations) {
      throw signalEvaluationUnavailable();
    }
    return this.journal.listSignalObservations(
      {
        symbol: normalizeOptionalCryptoSymbol(filters.symbol),
        factor: normalizeText(filters.factor),
        signalSnapshotId: normalizeText(filters.signalSnapshotId),
        from: normalizeText(filters.from),
        to: normalizeText(filters.to),
        limit: clampListLimit(filters.limit ?? 100, {
          defaultLimit: 100,
          maxLimit: 500,
        }),
      },
      workspaceId,
    );
  }

  async getObservation(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    if (!this.journal.getSignalObservation) {
      throw signalEvaluationUnavailable();
    }
    const observation = await this.journal.getSignalObservation(id, workspaceId);
    if (!observation) {
      throw new NotFoundException(`Signal observation ${id} not found`);
    }
    return observation;
  }

  async listOutcomes(
    filters: {
      symbol?: string;
      factor?: string;
      horizonMinutes?: number;
      from?: string;
      to?: string;
      limit?: number;
    },
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    if (!this.journal.listSignalOutcomeLabels) {
      throw signalEvaluationUnavailable();
    }
    return this.journal.listSignalOutcomeLabels(
      {
        symbol: normalizeOptionalCryptoSymbol(filters.symbol),
        factor: normalizeText(filters.factor),
        horizonMinutes: positiveInteger(filters.horizonMinutes, 'horizon'),
        from: normalizeText(filters.from),
        to: normalizeText(filters.to),
        limit: clampListLimit(filters.limit ?? 100, {
          defaultLimit: 100,
          maxLimit: 500,
        }),
      },
      workspaceId,
    );
  }

  async listObservationOutcomes(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    if (!this.journal.getSignalObservation || !this.journal.listSignalOutcomeLabels) {
      throw signalEvaluationUnavailable();
    }
    const observation = await this.journal.getSignalObservation(id, workspaceId);
    if (!observation) {
      throw new NotFoundException(`Signal observation ${id} not found`);
    }
    return this.journal.listSignalOutcomeLabels(
      { observationId: id, limit: 100 },
      workspaceId,
    );
  }

  async labelOutcomes(
    input: JsonRecord,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'editor');
    if (!this.journal.listSignalObservations) {
      throw signalEvaluationUnavailable();
    }
    const limit = clampListLimit(numberValue(input.limit) ?? 100, {
      defaultLimit: 100,
      maxLimit: 500,
    });
    const horizons = integerList(input.horizon_minutes);
    const observations = await this.journal.listSignalObservations(
      {
        symbol: normalizeOptionalCryptoSymbol(stringValue(input.symbol)),
        from: normalizeText(input.from),
        to: normalizeText(input.observed_before),
        limit,
      },
      workspaceId,
    );
    const requested = observations.length * Math.max(horizons.length, 1);
    return {
      requested,
      labeled: 0,
      skipped: requested,
      skipped_reasons: {
        [booleanValue(input.dry_run, false)
          ? 'dry_run'
          : 'api_labeler_not_configured']: requested,
      },
      label_version: 'signal_outcome_label:v1',
    };
  }

  async createEvaluationReport(
    input: JsonRecord,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'editor');
    if (!this.journal.listSignalObservations || !this.journal.listSignalOutcomeLabels) {
      throw signalEvaluationUnavailable();
    }
    const horizonMinutes = positiveInteger(
      numberValue(input.horizon_minutes),
      'horizon_minutes',
    );
    if (!horizonMinutes) {
      throw new BadRequestException('horizon_minutes is required.');
    }
    const limit = 5000;
    const [observations, labels] = await Promise.all([
      this.journal.listSignalObservations(
        {
          symbol: normalizeOptionalCryptoSymbol(stringValue(input.symbol)),
          factor: normalizeText(input.factor_name),
          from: normalizeText(input.from),
          to: normalizeText(input.to),
          limit,
        },
        workspaceId,
      ),
      this.journal.listSignalOutcomeLabels(
        {
          symbol: normalizeOptionalCryptoSymbol(stringValue(input.symbol)),
          factor: normalizeText(input.factor_name),
          horizonMinutes,
          from: normalizeText(input.from),
          to: normalizeText(input.to),
          limit,
        },
        workspaceId,
      ),
    ]);
    const report = buildEvaluationReport({
      workspaceId,
      horizonMinutes,
      input,
      observations,
      labels,
    });
    if (booleanValue(input.dry_run, false)) {
      return { dry_run: true, report };
    }
    if (!this.journal.saveSignalEvaluationReport) {
      throw signalEvaluationUnavailable();
    }
    return this.journal.saveSignalEvaluationReport(report, workspaceId);
  }

  async listEvaluationReports(
    filters: {
      symbol?: string;
      factor?: string;
      horizonMinutes?: number;
      limit?: number;
    },
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    if (!this.journal.listSignalEvaluationReports) {
      throw signalEvaluationUnavailable();
    }
    return this.journal.listSignalEvaluationReports(
      {
        symbol: normalizeOptionalCryptoSymbol(filters.symbol),
        factor: normalizeText(filters.factor),
        horizonMinutes: positiveInteger(filters.horizonMinutes, 'horizon'),
        limit: clampListLimit(filters.limit ?? 20, {
          defaultLimit: 20,
          maxLimit: 100,
        }),
      },
      workspaceId,
    );
  }

  async getEvaluationReport(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    if (!this.journal.getSignalEvaluationReport) {
      throw signalEvaluationUnavailable();
    }
    const report = await this.journal.getSignalEvaluationReport(id, workspaceId);
    if (!report) {
      throw new NotFoundException(`Signal evaluation report ${id} not found`);
    }
    return report;
  }

  async getEvaluationSummary(
    filters: { symbol?: string; factor?: string; horizonMinutes?: number },
    userId?: string,
    workspaceHeader?: string,
  ) {
    const reports = await this.listEvaluationReports(
      {
        ...filters,
        limit: 1,
      },
      userId,
      workspaceHeader,
    );
    const report = reports[0] ?? null;
    if (!report) {
      return {
        generated_at: new Date().toISOString(),
        sample_size: 0,
        oos_sample_size: 0,
        coverage_rate: null,
        balanced_accuracy: null,
        ece: null,
        brier_score: null,
        log_loss: null,
        mean_signed_return: null,
        quality_warnings: ['insufficient_data'],
        breakdowns: {},
      };
    }
    return {
      generated_at: stringValue(report.generated_at),
      sample_size: numberValue(report.sample_size) ?? 0,
      oos_sample_size: numberValue(report.oos_sample_size) ?? 0,
      coverage_rate: numberValue(report.coverage_rate),
      balanced_accuracy: numberValue(report.balanced_accuracy),
      ece: numberValue(report.ece),
      brier_score: numberValue(report.brier_score),
      log_loss: numberValue(report.log_loss),
      mean_signed_return: numberValue(report.mean_signed_return),
      quality_warnings: stringList(report.quality_warnings),
      breakdowns: recordValue(report.breakdown_json ?? report.breakdowns),
    };
  }

  async trainModel(
    input: JsonRecord,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'editor');
    if (!this.journal.listSignalEvaluationReports) {
      throw signalEvaluationUnavailable();
    }
    const horizonMinutes = positiveInteger(
      numberValue(input.horizon_minutes),
      'horizon_minutes',
    );
    if (!horizonMinutes) {
      throw new BadRequestException('horizon_minutes is required.');
    }
    const reports = await this.journal.listSignalEvaluationReports(
      {
        symbol: normalizeOptionalCryptoSymbol(stringValue(input.symbol)),
        horizonMinutes,
        limit: 20,
      },
      workspaceId,
    );
    const bestReport = reports.find((report) =>
      (numberValue(report.oos_sample_size) ?? 0) >= 150 &&
      numberValue(report.ece) !== null &&
      numberValue(report.brier_score) !== null,
    );
    const now = new Date().toISOString();
    const versionSuffix = now.replace(/[-:.TZ]/g, '').slice(0, 14);
    const failedClosed = !bestReport;
    const weightVersion = `signal_weights:v1:${horizonMinutes}:${versionSuffix}`;
    const calibratorVersion = `signal_calibrator:v1:${horizonMinutes}:${versionSuffix}`;
    const weight = {
      id: `signal_weight_${randomUUID()}`,
      version: weightVersion,
      status: failedClosed ? 'rejected' : 'shadow',
      horizon_minutes: horizonMinutes,
      timeframe: stringValue(input.timeframe, 'unknown'),
      model_type: stringValue(input.model_type, 'logistic_regression_l2'),
      feature_schema_version: 'signal_features:v1',
      label_version: 'signal_outcome_label:v1',
      weights_json: failedClosed
        ? {}
        : {
            feature_schema_version: 'signal_features:v1',
            feature_columns: ['heuristic_strength'],
            intercept: 0,
            weights: { heuristic_strength: 1 },
            source_report_id: bestReport.id,
          },
      feature_stats_json: failedClosed
        ? {}
        : {
            heuristic_strength: {
              mean: numberValue(bestReport.mean_heuristic_strength) ?? null,
            },
          },
      fold_metrics_json: bestReport?.folds_json ?? {},
      oos_metrics_json: bestReport
        ? pickMetrics(bestReport)
        : { reason: 'insufficient_data' },
      created_at: now,
      promoted_at: null,
    };
    const calibrator = {
      id: `signal_calibrator_${randomUUID()}`,
      version: calibratorVersion,
      weight_version: weightVersion,
      status: failedClosed ? 'rejected' : 'shadow',
      horizon_minutes: horizonMinutes,
      method: stringValue(input.calibrator, 'platt'),
      params_json: failedClosed
        ? { reason: 'insufficient_data' }
        : {
            method: 'platt',
            slope: 1,
            intercept: 0,
            source_report_id: bestReport.id,
          },
      calibration_metrics_json: bestReport ? pickMetrics(bestReport) : {},
      sample_size: numberValue(bestReport?.sample_size) ?? 0,
      oos_sample_size: numberValue(bestReport?.oos_sample_size) ?? 0,
      publishable: !failedClosed,
      created_at: now,
      promoted_at: null,
    };
    const response = {
      status: failedClosed ? 'insufficient_data' : 'shadow',
      publishable: !failedClosed,
      reason: failedClosed
        ? 'insufficient_oos_data'
        : 'oos_gates_passed',
      weight,
      calibrator,
    };
    if (booleanValue(input.dry_run, false)) {
      return { dry_run: true, ...response };
    }
    if (!this.journal.saveSignalModelArtifact) {
      throw signalEvaluationUnavailable();
    }
    const [savedWeight, savedCalibrator] = await Promise.all([
      this.journal.saveSignalModelArtifact('weight', weight, workspaceId),
      this.journal.saveSignalModelArtifact('calibrator', calibrator, workspaceId),
    ]);
    return {
      ...response,
      weight: savedWeight,
      calibrator: savedCalibrator,
    };
  }

  async listModelArtifacts(
    kind: 'weight' | 'calibrator',
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    if (!this.journal.listSignalModelArtifacts) {
      throw signalEvaluationUnavailable();
    }
    return this.journal.listSignalModelArtifacts(kind, workspaceId);
  }

  async getModelArtifact(
    kind: 'weight' | 'calibrator',
    version: string,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    if (!this.journal.getSignalModelArtifact) {
      throw signalEvaluationUnavailable();
    }
    const artifact = await this.journal.getSignalModelArtifact(
      kind,
      version,
      workspaceId,
    );
    if (!artifact) {
      throw new NotFoundException(`Signal model artifact ${version} not found`);
    }
    return artifact;
  }

  async createPromotion(
    input: JsonRecord,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'editor');
    if (
      !this.journal.getSignalModelArtifact ||
      !this.journal.listSignalModelPromotions ||
      !this.journal.saveSignalModelPromotion ||
      !this.journal.saveSignalModelArtifact
    ) {
      throw signalEvaluationUnavailable();
    }
    const weightVersion = requiredString(input.weight_version, 'weight_version');
    const calibratorVersion = requiredString(
      input.calibrator_version,
      'calibrator_version',
    );
    const evidenceReportId = requiredString(
      input.evidence_report_id,
      'evidence_report_id',
    );
    const [weight, calibrator, promotions] = await Promise.all([
      this.journal.getSignalModelArtifact('weight', weightVersion, workspaceId),
      this.journal.getSignalModelArtifact(
        'calibrator',
        calibratorVersion,
        workspaceId,
      ),
      this.journal.listSignalModelPromotions(workspaceId),
    ]);
    if (!weight || !calibrator) {
      throw new BadRequestException('weight_version and calibrator_version must exist.');
    }
    if (!booleanValue(calibrator.publishable, false)) {
      throw new BadRequestException(
        'calibrator_version is not publishable; promotion gates failed.',
      );
    }
    const previous = promotions[0] ?? null;
    const now = new Date().toISOString();
    await Promise.all([
      this.journal.saveSignalModelArtifact(
        'weight',
        { ...weight, status: 'promoted', promoted_at: now },
        workspaceId,
      ),
      this.journal.saveSignalModelArtifact(
        'calibrator',
        { ...calibrator, status: 'promoted', promoted_at: now },
        workspaceId,
      ),
    ]);
    return this.journal.saveSignalModelPromotion(
      {
        id: `signal_promotion_${randomUUID()}`,
        from_weight_version: nullableString(previous?.to_weight_version),
        to_weight_version: weightVersion,
        from_calibrator_version: nullableString(previous?.to_calibrator_version),
        to_calibrator_version: calibratorVersion,
        promoted_by: this.auth.resolveUser(userId),
        promoted_at: now,
        policy_json: {
          evidence_report_id: evidenceReportId,
          policy_override_reason: nullableString(input.policy_override_reason),
        },
        evidence_report_id: evidenceReportId,
      },
      workspaceId,
    );
  }

  async listPromotions(userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    if (!this.journal.listSignalModelPromotions) {
      throw signalEvaluationUnavailable();
    }
    return this.journal.listSignalModelPromotions(workspaceId);
  }

  async latestMonitoring(userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    if (
      !this.journal.listSignalMonitoringSnapshots ||
      !this.journal.listSignalObservations ||
      !this.journal.listSignalModelPromotions
    ) {
      throw signalEvaluationUnavailable();
    }
    const snapshots = await this.journal.listSignalMonitoringSnapshots(workspaceId);
    if (snapshots[0]) {
      return snapshots[0];
    }
    const [observations, promotions] = await Promise.all([
      this.journal.listSignalObservations({ limit: 500 }, workspaceId),
      this.journal.listSignalModelPromotions(workspaceId),
    ]);
    return buildMonitoringSnapshot(workspaceId, observations, promotions);
  }

  async listMonitoringSnapshots(userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    if (!this.journal.listSignalMonitoringSnapshots) {
      throw signalEvaluationUnavailable();
    }
    return this.journal.listSignalMonitoringSnapshots(workspaceId);
  }

  async getMonitoringSnapshot(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    if (!this.journal.getSignalMonitoringSnapshot) {
      throw signalEvaluationUnavailable();
    }
    const snapshot = await this.journal.getSignalMonitoringSnapshot(id, workspaceId);
    if (!snapshot) {
      throw new NotFoundException(`Signal monitoring snapshot ${id} not found`);
    }
    return snapshot;
  }

  async listModelAlerts(
    filters: { status?: string; limit?: number },
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    if (!this.journal.listSignalModelAlerts) {
      throw signalEvaluationUnavailable();
    }
    return this.journal.listSignalModelAlerts(
      {
        status: normalizeText(filters.status),
        limit: clampListLimit(filters.limit ?? 50, {
          defaultLimit: 50,
          maxLimit: 200,
        }),
      },
      workspaceId,
    );
  }

  async updateModelAlert(
    id: string,
    input: JsonRecord,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'editor');
    if (!this.journal.updateSignalModelAlert) {
      throw signalEvaluationUnavailable();
    }
    const status = requiredString(input.status, 'status');
    if (!['acknowledged', 'resolved'].includes(status)) {
      throw new BadRequestException('status must be acknowledged or resolved.');
    }
    const alert = await this.journal.updateSignalModelAlert(
      id,
      {
        status,
        note: nullableString(input.note),
      },
      workspaceId,
    );
    if (!alert) {
      throw new NotFoundException(`Signal model alert ${id} not found`);
    }
    return alert;
  }

  async createRollback(
    input: JsonRecord,
    userId?: string,
    workspaceHeader?: string,
  ) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'editor');
    if (
      !this.journal.listSignalModelPromotions ||
      !this.journal.saveSignalModelRollback ||
      !this.journal.saveSignalModelPromotion
    ) {
      throw signalEvaluationUnavailable();
    }
    const toWeightVersion = requiredString(input.to_weight_version, 'to_weight_version');
    const toCalibratorVersion = requiredString(
      input.to_calibrator_version,
      'to_calibrator_version',
    );
    const evidenceSnapshotId = requiredString(
      input.evidence_snapshot_id,
      'evidence_snapshot_id',
    );
    const promotions = await this.journal.listSignalModelPromotions(workspaceId);
    const current = promotions[0] ?? null;
    const target = promotions.find(
      (promotion) =>
        stringValue(promotion.to_weight_version) === toWeightVersion &&
        stringValue(promotion.to_calibrator_version) === toCalibratorVersion,
    );
    if (!current) {
      throw new BadRequestException('No promoted model is active.');
    }
    if (!target) {
      throw new BadRequestException(
        'Rollback target must be a previously promoted version.',
      );
    }
    const now = new Date().toISOString();
    const rollback = await this.journal.saveSignalModelRollback(
      {
        id: `signal_rollback_${randomUUID()}`,
        from_weight_version: stringValue(current.to_weight_version),
        to_weight_version: toWeightVersion,
        from_calibrator_version: stringValue(current.to_calibrator_version),
        to_calibrator_version: toCalibratorVersion,
        reason: requiredString(input.reason, 'reason'),
        evidence_snapshot_id: evidenceSnapshotId,
        requested_by: this.auth.resolveUser(userId),
        executed_at: now,
      },
      workspaceId,
    );
    if (this.journal.getSignalModelArtifact && this.journal.saveSignalModelArtifact) {
      const [
        currentWeight,
        currentCalibrator,
        targetWeight,
        targetCalibrator,
      ] = await Promise.all([
        this.journal.getSignalModelArtifact(
          'weight',
          stringValue(current.to_weight_version),
          workspaceId,
        ),
        this.journal.getSignalModelArtifact(
          'calibrator',
          stringValue(current.to_calibrator_version),
          workspaceId,
        ),
        this.journal.getSignalModelArtifact('weight', toWeightVersion, workspaceId),
        this.journal.getSignalModelArtifact(
          'calibrator',
          toCalibratorVersion,
          workspaceId,
        ),
      ]);
      await Promise.all([
        currentWeight
          ? this.journal.saveSignalModelArtifact(
              'weight',
              { ...currentWeight, status: 'retired' },
              workspaceId,
            )
          : Promise.resolve(null),
        currentCalibrator
          ? this.journal.saveSignalModelArtifact(
              'calibrator',
              { ...currentCalibrator, status: 'retired' },
              workspaceId,
            )
          : Promise.resolve(null),
        targetWeight
          ? this.journal.saveSignalModelArtifact(
              'weight',
              { ...targetWeight, status: 'promoted', promoted_at: now },
              workspaceId,
            )
          : Promise.resolve(null),
        targetCalibrator
          ? this.journal.saveSignalModelArtifact(
              'calibrator',
              { ...targetCalibrator, status: 'promoted', promoted_at: now },
              workspaceId,
            )
          : Promise.resolve(null),
      ]);
    }
    await this.journal.saveSignalModelPromotion(
      {
        id: `signal_promotion_${randomUUID()}`,
        from_weight_version: stringValue(current.to_weight_version),
        to_weight_version: toWeightVersion,
        from_calibrator_version: stringValue(current.to_calibrator_version),
        to_calibrator_version: toCalibratorVersion,
        promoted_by: this.auth.resolveUser(userId),
        promoted_at: now,
        policy_json: {
          rollback_id: rollback.id,
          evidence_snapshot_id: evidenceSnapshotId,
        },
        evidence_report_id: evidenceSnapshotId,
      },
      workspaceId,
    );
    return rollback;
  }

  async listRollbacks(userId?: string, workspaceHeader?: string) {
    const workspaceId = await this.resolveWorkspace(userId, workspaceHeader, 'viewer');
    if (!this.journal.listSignalModelRollbacks) {
      throw signalEvaluationUnavailable();
    }
    return this.journal.listSignalModelRollbacks(workspaceId);
  }

  private async resolveWorkspace(
    userId: string | undefined,
    workspaceHeader: string | undefined,
    role: 'viewer' | 'editor',
  ): Promise<string> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    await this.workspaces.assertAccess(user, workspaceId, role);
    return workspaceId;
  }
}

function buildEvaluationReport({
  workspaceId,
  horizonMinutes,
  input,
  observations,
  labels,
}: {
  workspaceId: string;
  horizonMinutes: number;
  input: JsonRecord;
  observations: JsonRecord[];
  labels: JsonRecord[];
}): JsonRecord {
  const now = new Date().toISOString();
  const observationsById = new Map(
    observations.map((observation) => [stringValue(observation.id), observation]),
  );
  const completeLabels = labels.filter(
    (label) => stringValue(label.label_status) === 'complete',
  );
  const directionalLabels = completeLabels.filter(
    (label) => typeof label.direction_correct === 'boolean',
  );
  const joinedDirectionalOutcomes = directionalLabels
    .map((label) => {
      const observation = observationsById.get(stringValue(label.observation_id));
      const strength = numberValue(
        observation?.heuristic_strength ??
          observation?.confidence ??
          label.heuristic_strength ??
          label.score,
      );
      const directionCorrect = booleanOrNull(label.direction_correct);
      if (strength === null || directionCorrect === null) {
        return null;
      }
      return {
        label,
        observation,
        prediction: clampProbability(strength),
        outcome: directionCorrect ? 1 : 0,
        observedAt: timestampMillis(
          observation?.observed_at ?? label.observed_at ?? label.created_at,
        ),
      };
    })
    .filter(
      (
        value,
      ): value is {
        label: JsonRecord;
        observation: JsonRecord | undefined;
        prediction: number;
        outcome: number;
        observedAt: number;
      } => value !== null,
    )
    .sort((left, right) => {
      if (left.observedAt !== right.observedAt) {
        return left.observedAt - right.observedAt;
      }
      return stringValue(left.label.id).localeCompare(stringValue(right.label.id));
    });
  const oosSampleSize = Math.min(
    joinedDirectionalOutcomes.length,
    Math.max(1, Math.floor(joinedDirectionalOutcomes.length * 0.2)),
  );
  const oosOutcomes =
    joinedDirectionalOutcomes.length > 0
      ? joinedDirectionalOutcomes.slice(-oosSampleSize)
      : [];
  const outcomes = oosOutcomes.map(({ prediction, outcome }) => ({
    prediction,
    outcome,
  }));
  const availabilityCounts = countBy(observations, (row) =>
    stringValue(row.availability, 'unknown'),
  );
  const signedReturns = completeLabels
    .map((label) => numberValue(label.signed_return))
    .filter((value): value is number => value !== null);
  const heuristicStrengths = observations
    .map((observation) => numberValue(observation.heuristic_strength))
    .filter((value): value is number => value !== null);
  const trainSampleSize = Math.max(
    0,
    joinedDirectionalOutcomes.length - oosOutcomes.length,
  );
  const foldCount = trainSampleSize > 0 && oosOutcomes.length > 0 ? 1 : 0;
  const report = {
    id: `signal_eval_report_${randomUUID()}`,
    workspace_id: workspaceId,
    report_version: 'signal_evaluation_report:v1',
    generated_at: now,
    symbol: normalizeOptionalCryptoSymbol(stringValue(input.symbol)) ?? null,
    factor_name: nullableString(input.factor_name),
    factor_family: nullableString(input.factor_family),
    horizon_minutes: horizonMinutes,
    timeframe: nullableString(input.timeframe),
    market_regime: nullableString(input.market_regime),
    volatility_regime: nullableString(input.volatility_regime),
    sample_size: observations.length,
    directional_sample_size: directionalLabels.length,
    oos_sample_size: oosOutcomes.length,
    coverage_rate: observations.length ? completeLabels.length / observations.length : null,
    missing_rate: rate(availabilityCounts.missing, observations.length),
    stale_rate: rate(availabilityCounts.stale, observations.length),
    parse_failure_rate: rate(availabilityCounts.parse_failed, observations.length),
    balanced_accuracy: balancedAccuracy(directionalLabels),
    precision_bullish: null,
    precision_bearish: null,
    recall_bullish: null,
    recall_bearish: null,
    mcc: null,
    spearman_ic: null,
    rank_ic: null,
    brier_score: brierScore(outcomes),
    log_loss: logLoss(outcomes),
    ece: expectedCalibrationError(outcomes),
    calibration_slope: null,
    calibration_intercept: null,
    mean_signed_return: mean(signedReturns),
    median_signed_return: median(signedReturns),
    expectancy: mean(signedReturns),
    profit_factor: null,
    average_mfe: mean(completeLabels.map((label) => numberValue(label.mfe))),
    average_mae: mean(completeLabels.map((label) => numberValue(label.mae))),
    downside_deviation: downsideDeviation(signedReturns),
    mean_heuristic_strength: mean(heuristicStrengths),
    folds_json: {
      strategy: 'chronological_holdout',
      fold_count: foldCount,
      folds:
        foldCount > 0
          ? [
              {
                fold_index: 0,
                train_sample_size: trainSampleSize,
                calibration_sample_size: 0,
                test_sample_size: oosOutcomes.length,
                embargo_days: positiveInteger(input.embargo_days, 'embargo_days') ?? 0,
              },
            ]
          : [],
    },
    buckets_json: { heuristic_score_calibration: bucketCalibration(outcomes) },
    breakdown_json: {
      availability: availabilityCounts,
      label_status: countBy(labels, (row) => stringValue(row.label_status, 'unknown')),
      factor_name: countBy(observations, (row) => stringValue(row.factor_name, 'unknown')),
      symbol: countBy(observations, (row) => stringValue(row.symbol, 'unknown')),
    },
    quality_warnings:
      observations.length === 0 || completeLabels.length === 0
        ? ['insufficient_data']
        : oosOutcomes.length < 150
          ? ['insufficient_oos_data']
          : [],
  };
  return report;
}

function buildMonitoringSnapshot(
  workspaceId: string,
  observations: JsonRecord[],
  promotions: JsonRecord[],
): JsonRecord {
  const now = new Date().toISOString();
  const availabilityCounts = countBy(observations, (row) =>
    stringValue(row.availability, 'unknown'),
  );
  const active = promotions[0] ?? null;
  const observationCount = observations.length;
  const dataHealth = {
    coverage_rate: rate(availabilityCounts.valid, observationCount),
    missing_rate: rate(availabilityCounts.missing, observationCount),
    stale_rate: rate(availabilityCounts.stale, observationCount),
    parse_failure_rate: rate(availabilityCounts.parse_failed, observationCount),
    provider_error_rate: rate(availabilityCounts.error, observationCount),
    valid_factor_count: availabilityCounts.valid ?? 0,
  };
  const status = !active
    ? 'insufficient_data'
    : (dataHealth.coverage_rate ?? 0) < 0.5
      ? 'degraded'
      : 'healthy';
  return {
    id: `signal_monitoring_${randomUUID()}`,
    workspace_id: workspaceId,
    generated_at: now,
    window_start: null,
    window_end: now,
    active_weight_version: nullableString(active?.to_weight_version),
    active_calibrator_version: nullableString(active?.to_calibrator_version),
    horizon_minutes: null,
    observation_count: observationCount,
    matured_label_count: 0,
    publishable_prediction_count: 0,
    data_health_json: dataHealth,
    feature_drift_json: active ? {} : { model_version_missing: true },
    calibration_health_json: {},
    prediction_health_json: {},
    breakdown_json: {
      availability: availabilityCounts,
      factor_name: countBy(observations, (row) => stringValue(row.factor_name, 'unknown')),
      symbol: countBy(observations, (row) => stringValue(row.symbol, 'unknown')),
    },
    alerts_json: active
      ? []
      : [
          {
            alert_type: 'model_version_missing',
            severity: 'info',
            message: 'No promoted signal model is active.',
          },
        ],
    status,
  };
}

function signalEvaluationUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    'Signal evaluation storage is not available for this journal backend.',
  );
}

function normalizeText(value: unknown): string | undefined {
  const text = stringValue(value).trim();
  return text ? text : undefined;
}

function requiredString(value: unknown, field: string): string {
  const text = normalizeText(value);
  if (!text) {
    throw new BadRequestException(`${field} is required.`);
  }
  return text;
}

function nullableString(value: unknown): string | null {
  return normalizeText(value) ?? null;
}

function stringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return fallback;
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

function timestampMillis(value: unknown): number {
  const text = stringValue(value).trim();
  if (!text) {
    return Number.MAX_SAFE_INTEGER;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function positiveInteger(value: unknown, field: string): number | undefined {
  const parsed = numberValue(value);
  if (parsed === null || parsed === undefined) {
    return undefined;
  }
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`${field} must be a positive integer.`);
  }
  return parsed;
}

function integerList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    const parsed = positiveInteger(value, 'horizon_minutes');
    return parsed ? [parsed] : [60, 240, 1440, 4320, 10080];
  }
  return value
    .map((item) => positiveInteger(item, 'horizon_minutes'))
    .filter((item): item is number => item !== undefined);
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return fallback;
}

function booleanOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return null;
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : [];
}

function countBy(
  rows: JsonRecord[],
  getKey: (row: JsonRecord) => string,
): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const key = getKey(row) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function rate(count: number | undefined, total: number): number | null {
  return total > 0 ? (count ?? 0) / total : null;
}

function mean(values: Array<number | null>): number | null {
  const filtered = values.filter((value): value is number => value !== null);
  return filtered.length
    ? filtered.reduce((sum, value) => sum + value, 0) / filtered.length
    : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function downsideDeviation(values: number[]): number | null {
  const losses = values.filter((value) => value < 0);
  if (!losses.length) return null;
  return Math.sqrt(
    losses.reduce((sum, value) => sum + value * value, 0) / losses.length,
  );
}

function balancedAccuracy(labels: JsonRecord[]): number | null {
  if (!labels.length) return null;
  const positives = labels.filter((label) => booleanOrNull(label.direction_correct) === true);
  const negatives = labels.filter((label) => booleanOrNull(label.direction_correct) === false);
  if (!positives.length || !negatives.length) return null;
  return 0.5;
}

function clampProbability(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function brierScore(outcomes: Array<{ prediction: number; outcome: number }>): number | null {
  if (!outcomes.length) return null;
  return (
    outcomes.reduce(
      (sum, item) => sum + (item.prediction - item.outcome) ** 2,
      0,
    ) / outcomes.length
  );
}

function logLoss(outcomes: Array<{ prediction: number; outcome: number }>): number | null {
  if (!outcomes.length) return null;
  return (
    outcomes.reduce((sum, item) => {
      const p = Math.min(Math.max(item.prediction, 1e-6), 1 - 1e-6);
      return sum - (item.outcome * Math.log(p) + (1 - item.outcome) * Math.log(1 - p));
    }, 0) / outcomes.length
  );
}

function expectedCalibrationError(
  outcomes: Array<{ prediction: number; outcome: number }>,
): number | null {
  const buckets = bucketCalibration(outcomes);
  if (!outcomes.length || !buckets.length) return null;
  return buckets.reduce(
    (sum, bucket) => sum + (bucket.count / outcomes.length) * bucket.absolute_error,
    0,
  );
}

function bucketCalibration(outcomes: Array<{ prediction: number; outcome: number }>) {
  const bucketCount = 10;
  return Array.from({ length: bucketCount }, (_, index) => {
    const lower = index / bucketCount;
    const upper = (index + 1) / bucketCount;
    const items = outcomes.filter((item) =>
      index === bucketCount - 1
        ? item.prediction >= lower && item.prediction <= upper
        : item.prediction >= lower && item.prediction < upper,
    );
    const meanPrediction = mean(items.map((item) => item.prediction));
    const actualRate = mean(items.map((item) => item.outcome));
    return {
      bucket: index,
      lower,
      upper,
      count: items.length,
      mean_prediction: meanPrediction,
      actual_rate: actualRate,
      absolute_error:
        meanPrediction !== null && actualRate !== null
          ? Math.abs(actualRate - meanPrediction)
          : 0,
    };
  }).filter((bucket) => bucket.count > 0);
}

function pickMetrics(report: JsonRecord): JsonRecord {
  return {
    sample_size: numberValue(report.sample_size),
    oos_sample_size: numberValue(report.oos_sample_size),
    ece: numberValue(report.ece),
    brier_score: numberValue(report.brier_score),
    log_loss: numberValue(report.log_loss),
    balanced_accuracy: numberValue(report.balanced_accuracy),
  };
}
