import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ThesisDecisionDto } from './dto/thesis-decision.dto';
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

  @Post(':id/decision')
  decide(
    @Param('id') id: string,
    @Body() dto: ThesisDecisionDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.theses.decide(id, dto.action, dto.notes ?? '', userId, workspaceId);
  }

  @Post(':id/review')
  review(
    @Param('id') id: string,
    @Body() dto: ThesisReviewDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.theses.review(id, dto.result, dto.notes ?? '', userId, workspaceId);
  }
}
