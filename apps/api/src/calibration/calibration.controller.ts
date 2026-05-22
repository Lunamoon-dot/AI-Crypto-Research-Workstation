import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { parseListLimit } from '../common/query-limit';
import { CalibrationService } from './calibration.service';
import { CreateEvaluationRerunDto } from './dto/evaluation-rerun.dto';
import { EvaluationVersionPolicyActionDto } from './dto/evaluation-version-policy.dto';
import { EvaluateThesisDto } from './dto/evaluate-thesis.dto';
import {
  ApplyMaturedEvaluationsDto,
  PreviewMaturedEvaluationsDto,
} from './dto/matured-evaluations.dto';
import { CalibrationOutcomeReviewDto } from './dto/outcome-review.dto';
import { AgentCalibrationQueryDto } from './dto/agent-calibration.dto';
import { SymbolCalibrationQueryDto } from './dto/symbol-calibration.dto';

@Controller('calibration')
export class CalibrationController {
  constructor(private readonly calibration: CalibrationService) {}

  @Post('evaluations/thesis')
  evaluateThesis(
    @Body() dto: EvaluateThesisDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.calibration.evaluateThesis(dto, userId, workspaceId);
  }

  @Post('evaluations/matured/preview')
  @HttpCode(200)
  previewMaturedEvaluations(
    @Body() dto: PreviewMaturedEvaluationsDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.calibration.previewMaturedEvaluations(dto, userId, workspaceId);
  }

  @Post('evaluations/matured/apply')
  @HttpCode(200)
  applyMaturedEvaluations(
    @Body() dto: ApplyMaturedEvaluationsDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.calibration.applyMaturedEvaluations(dto, userId, workspaceId);
  }

  @Get('symbol')
  getSymbolCalibration(
    @Query() dto: SymbolCalibrationQueryDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.calibration.getSymbolCalibrationReport(dto, userId, workspaceId);
  }

  @Get('agents')
  getAgentCalibration(
    @Query() dto: AgentCalibrationQueryDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.calibration.getAgentCalibrationReport(dto, userId, workspaceId);
  }

  @Get('evaluations')
  listEvaluations(
    @Query('thesis_id') thesisId?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.calibration.listEvaluations(
      {
        thesisId,
        limit: parseListLimit(limit, { defaultLimit: 50, maxLimit: 200 }),
      },
      userId,
      workspaceId,
    );
  }

  @Get('evaluations/:id')
  getEvaluation(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.calibration.getEvaluation(id, userId, workspaceId);
  }

  @Get('evaluations/:id/reruns')
  listEvaluationReruns(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.calibration.listEvaluationReruns(
      id,
      {
        limit: parseListLimit(limit, { defaultLimit: 20, maxLimit: 50 }),
      },
      userId,
      workspaceId,
    );
  }

  @Get('evaluations/:id/version-policy')
  getEvaluationVersionPolicy(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.calibration.getEvaluationVersionPolicy(id, userId, workspaceId);
  }

  @Post('evaluations/:id/reruns')
  createEvaluationRerun(
    @Param('id') id: string,
    @Body() dto: CreateEvaluationRerunDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.calibration.createEvaluationRerun(id, dto, userId, workspaceId);
  }

  @Post('evaluations/:id/reruns/:rerun_id/promote')
  @HttpCode(200)
  promoteEvaluationRerun(
    @Param('id') id: string,
    @Param('rerun_id') rerunId: string,
    @Body() dto: EvaluationVersionPolicyActionDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.calibration.promoteEvaluationRerun(
      id,
      rerunId,
      dto,
      userId,
      workspaceId,
    );
  }

  @Post('evaluations/:id/version-policy/reset')
  @HttpCode(200)
  resetEvaluationVersionPolicy(
    @Param('id') id: string,
    @Body() dto: EvaluationVersionPolicyActionDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.calibration.resetEvaluationVersionPolicy(
      id,
      dto,
      userId,
      workspaceId,
    );
  }

  @Post('evaluations/:id/outcome-review')
  recordOutcomeReview(
    @Param('id') id: string,
    @Body() dto: CalibrationOutcomeReviewDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.calibration.recordOutcomeReview(id, dto, userId, workspaceId);
  }
}
