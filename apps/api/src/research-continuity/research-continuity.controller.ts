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
import {
  RunResearchContinuityRepairDto,
  UpdateResearchContinuitySettingsDto,
} from './dto/research-continuity.dto';
import type {
  ResearchContinuityDebugAuditDecision,
  ResearchContinuityDebugAuditReason,
  ResearchContinuityRepairRunStatus,
} from './research-continuity-audit.types';
import { ResearchContinuityService } from './research-continuity.service';

@Controller('research-continuity')
export class ResearchContinuityController {
  constructor(private readonly continuity: ResearchContinuityService) {}

  @Get('settings')
  getSettings(
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.continuity.getWorkspaceSettings(userId, workspaceId);
  }

  @Patch('settings')
  patchSettings(
    @Body() dto: UpdateResearchContinuitySettingsDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.continuity.updateWorkspaceSettings(dto, userId, workspaceId);
  }

  @Get('scheduler')
  getScheduler(
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.continuity.getSchedulerStatus(userId, workspaceId);
  }

  @Post('scheduler/run-due')
  runDueScheduler(
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.continuity.runDueScheduledRepair(userId, workspaceId);
  }

  @Get('symbols/:symbol/state')
  getSymbolState(
    @Param('symbol') symbol: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.continuity.getSymbolState(symbol, userId, workspaceId);
  }

  @Get('symbols/:symbol/entries')
  listSymbolEntries(
    @Param('symbol') symbol: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.continuity.listSymbolEntries(
      symbol,
      { limit: parseListLimit(limit, { defaultLimit: 20, maxLimit: 100 }) },
      userId,
      workspaceId,
    );
  }

  @Get('entries/:id')
  getEntry(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.continuity.getEntry(id, userId, workspaceId);
  }

  @Get('entries/:id/debug')
  getEntryDebug(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.continuity.getEntryDebug(id, userId, workspaceId);
  }

  @Get('debug-audits')
  async listDebugAccessAudits(
    @Query('limit') limit?: string,
    @Query('entry_id') entryId?: string,
    @Query('decision') decision?: ResearchContinuityDebugAuditDecision,
    @Query('reason') reason?: ResearchContinuityDebugAuditReason,
    @Query('requested_by_user_id') requestedByUserId?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return {
      audits: await this.continuity.listDebugAccessAudits(
        {
          limit: parseListLimit(limit, { defaultLimit: 50, maxLimit: 200 }),
          entry_id: entryId,
          decision,
          reason,
          requested_by_user_id: requestedByUserId,
        },
        userId,
        workspaceId,
      ),
    };
  }

  @Get('repair/preview')
  previewRepair(
    @Query('symbol') symbol?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('case_types') caseTypes?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.continuity.previewRepair(
      {
        symbol,
        from,
        to,
        case_types: caseTypes,
        limit: parseListLimit(limit, { defaultLimit: 25, maxLimit: 100 }),
      },
      userId,
      workspaceId,
    );
  }

  @Post('repair/run')
  runRepair(
    @Body() dto: RunResearchContinuityRepairDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.continuity.runRepair(dto, userId, workspaceId);
  }

  @Get('repair/runs')
  async listRepairRuns(
    @Query('status') status?: ResearchContinuityRepairRunStatus,
    @Query('dry_run') dryRun?: string,
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return {
      runs: await this.continuity.listRepairRuns(
        {
          status,
          dry_run: parseOptionalBoolean(dryRun),
          limit: parseListLimit(limit, { defaultLimit: 20, maxLimit: 100 }),
        },
        userId,
        workspaceId,
      ),
    };
  }

  @Get('repair/runs/:id')
  getRepairRun(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.continuity.getRepairRun(id, userId, workspaceId);
  }
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}
