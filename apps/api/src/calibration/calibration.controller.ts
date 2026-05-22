import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { parseListLimit } from '../common/query-limit';
import { CalibrationService } from './calibration.service';
import { CreateEvaluationRerunDto } from './dto/evaluation-rerun.dto';
import { EvaluateThesisDto } from './dto/evaluate-thesis.dto';
import {
  ApplyMaturedEvaluationsDto,
  PreviewMaturedEvaluationsDto,
} from './dto/matured-evaluations.dto';
import { CalibrationOutcomeReviewDto } from './dto/outcome-review.dto';
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

  @Post('evaluations/:id/reruns')
  createEvaluationRerun(
    @Param('id') id: string,
    @Body() dto: CreateEvaluationRerunDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.calibration.createEvaluationRerun(id, dto, userId, workspaceId);
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
