import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { parseListLimit } from '../common/query-limit';
import { SignalsService } from './signals.service';

@Controller('signals')
export class SignalsController {
  constructor(private readonly signals: SignalsService) {}

  @Get('count')
  count(
    @Query('symbol') symbol?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.count(symbol, userId, workspaceId);
  }

  @Get('observations')
  observations(
    @Query('symbol') symbol?: string,
    @Query('factor') factor?: string,
    @Query('signal_snapshot_id') signalSnapshotId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.listObservations(
      {
        symbol,
        factor,
        signalSnapshotId,
        from,
        to,
        limit: parseListLimit(limit, { defaultLimit: 100, maxLimit: 500 }),
      },
      userId,
      workspaceId,
    );
  }

  @Get('observations/:id/outcomes')
  observationOutcomes(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.listObservationOutcomes(id, userId, workspaceId);
  }

  @Get('observations/:id')
  observation(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.getObservation(id, userId, workspaceId);
  }

  @Get('outcomes')
  outcomes(
    @Query('symbol') symbol?: string,
    @Query('factor') factor?: string,
    @Query('horizon') horizon?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.listOutcomes(
      {
        symbol,
        factor,
        horizonMinutes: optionalInteger(horizon),
        from,
        to,
        limit: parseListLimit(limit, { defaultLimit: 100, maxLimit: 500 }),
      },
      userId,
      workspaceId,
    );
  }

  @Post('outcomes/label')
  labelOutcomes(
    @Body() body: Record<string, unknown>,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.labelOutcomes(body, userId, workspaceId);
  }

  @Post('evaluation/reports')
  createEvaluationReport(
    @Body() body: Record<string, unknown>,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.createEvaluationReport(body, userId, workspaceId);
  }

  @Get('evaluation/reports')
  evaluationReports(
    @Query('symbol') symbol?: string,
    @Query('factor') factor?: string,
    @Query('horizon') horizon?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.listEvaluationReports(
      {
        symbol,
        factor,
        horizonMinutes: optionalInteger(horizon),
        limit: parseListLimit(limit, { defaultLimit: 20, maxLimit: 100 }),
      },
      userId,
      workspaceId,
    );
  }

  @Get('evaluation/reports/:id')
  evaluationReport(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.getEvaluationReport(id, userId, workspaceId);
  }

  @Get('evaluation/summary')
  evaluationSummary(
    @Query('symbol') symbol?: string,
    @Query('factor') factor?: string,
    @Query('horizon') horizon?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.getEvaluationSummary(
      { symbol, factor, horizonMinutes: optionalInteger(horizon) },
      userId,
      workspaceId,
    );
  }

  @Post('models/train')
  trainModel(
    @Body() body: Record<string, unknown>,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.trainModel(body, userId, workspaceId);
  }

  @Get('models/weights')
  weights(
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.listModelArtifacts('weight', userId, workspaceId);
  }

  @Get('models/weights/:version')
  weight(
    @Param('version') version: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.getModelArtifact('weight', version, userId, workspaceId);
  }

  @Get('models/calibrators')
  calibrators(
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.listModelArtifacts('calibrator', userId, workspaceId);
  }

  @Get('models/calibrators/:version')
  calibrator(
    @Param('version') version: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.getModelArtifact(
      'calibrator',
      version,
      userId,
      workspaceId,
    );
  }

  @Post('models/promotions')
  createPromotion(
    @Body() body: Record<string, unknown>,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.createPromotion(body, userId, workspaceId);
  }

  @Get('models/promotions')
  promotions(
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.listPromotions(userId, workspaceId);
  }

  @Get('models/monitoring/latest')
  latestMonitoring(
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.latestMonitoring(userId, workspaceId);
  }

  @Get('models/monitoring/snapshots')
  monitoringSnapshots(
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.listMonitoringSnapshots(userId, workspaceId);
  }

  @Get('models/monitoring/snapshots/:id')
  monitoringSnapshot(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.getMonitoringSnapshot(id, userId, workspaceId);
  }

  @Get('models/alerts')
  modelAlerts(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.listModelAlerts(
      {
        status,
        limit: parseListLimit(limit, { defaultLimit: 50, maxLimit: 200 }),
      },
      userId,
      workspaceId,
    );
  }

  @Patch('models/alerts/:id')
  updateModelAlert(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.updateModelAlert(id, body, userId, workspaceId);
  }

  @Post('models/rollbacks')
  createRollback(
    @Body() body: Record<string, unknown>,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.createRollback(body, userId, workspaceId);
  }

  @Get('models/rollbacks')
  rollbacks(
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.listRollbacks(userId, workspaceId);
  }

  @Get(':id')
  get(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.get(id, userId, workspaceId);
  }

  @Get()
  list(
    @Query('symbol') symbol?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.signals.list(
      symbol,
      parseListLimit(limit, { defaultLimit: 50, maxLimit: 100 }),
      userId,
      workspaceId,
    );
  }
}

function optionalInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  return Number(value);
}
