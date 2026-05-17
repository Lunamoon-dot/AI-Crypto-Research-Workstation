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
import { ThesisDecisionDto } from './dto/thesis-decision.dto';
import {
  PatchThesisMonitorPlanDto,
  RunThesisPulseMemoDto,
  RunThesisPulseDto,
} from './dto/thesis-monitoring.dto';
import { ThesisReviewDto } from './dto/thesis-review.dto';
import { ThesesService } from './theses.service';
import { parseListLimit } from '../common/query-limit';

@Controller('theses')
export class ThesesController {
  constructor(private readonly theses: ThesesService) {}

  @Get()
  list(
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.theses.list(
      parseListLimit(limit, { defaultLimit: 50, maxLimit: 100 }),
      userId,
      workspaceId,
    );
  }

  @Get(':id')
  get(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.theses.get(id, userId, workspaceId);
  }

  @Get(':id/scenarios')
  scenarios(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.theses.scenarios(id, userId, workspaceId);
  }

  @Get(':id/monitor-plan')
  monitorPlan(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.theses.monitorPlan(id, userId, workspaceId);
  }

  @Patch(':id/monitor-plan')
  updateMonitorPlan(
    @Param('id') id: string,
    @Body() dto: PatchThesisMonitorPlanDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.theses.updateMonitorPlan(id, dto, userId, workspaceId);
  }

  @Post(':id/pulses/run')
  runPulse(
    @Param('id') id: string,
    @Body() dto: RunThesisPulseDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.theses.runPulse(id, dto, userId, workspaceId);
  }

  @Get(':id/pulses')
  pulses(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.theses.pulses(
      id,
      parseListLimit(limit, { defaultLimit: 200, maxLimit: 1000 }),
      userId,
      workspaceId,
    );
  }

  @Post(':id/pulse-memos/run')
  runPulseMemo(
    @Param('id') id: string,
    @Body() dto: RunThesisPulseMemoDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.theses.runPulseMemo(id, dto, userId, workspaceId);
  }

  @Get(':id/pulse-memos')
  pulseMemos(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.theses.pulseMemos(
      id,
      parseListLimit(limit, { defaultLimit: 50, maxLimit: 200 }),
      userId,
      workspaceId,
    );
  }

  @Post(':id/decision')
  decide(
    @Param('id') id: string,
    @Body() dto: ThesisDecisionDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.theses.decide(
      id,
      dto.action,
      dto.notes ?? '',
      userId,
      workspaceId,
      {
        entry: dto.entry,
        stop_loss: dto.stop_loss,
        take_profit: dto.take_profit,
        position_intent: dto.position_intent,
      },
    );
  }

  @Post(':id/review')
  review(
    @Param('id') id: string,
    @Body() dto: ThesisReviewDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.theses.review(
      id,
      dto.result,
      dto.notes ?? '',
      userId,
      workspaceId,
      {
        max_favorable_excursion: dto.max_favorable_excursion,
        max_adverse_excursion: dto.max_adverse_excursion,
      },
    );
  }
}
