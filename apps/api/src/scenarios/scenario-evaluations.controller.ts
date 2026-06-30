import { Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ScenarioEvaluationService } from './scenario-evaluation.service';

@Controller()
export class ScenarioEvaluationsController {
  constructor(private readonly evaluations: ScenarioEvaluationService) {}

  @Post('scenarios/:id/evaluations')
  evaluateScenario(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.evaluations.evaluateScenario(id, userId, workspaceId);
  }

  @Get('scenarios/:id/evaluations')
  listForScenario(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.evaluations.listForScenario(id, userId, workspaceId);
  }

  @Get('scenario-evaluations/:id')
  getEvaluation(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.evaluations.getEvaluation(id, userId, workspaceId);
  }
}
