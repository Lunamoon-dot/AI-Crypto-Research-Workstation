import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { ResearchContinuityModule } from '../research-continuity/research-continuity.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MarketDataGuardService } from './market-data-guard.service';
import { ResearchRunsController } from './research-runs.controller';
import { ResearchRunsService } from './research-runs.service';

@Module({
  imports: [AuthModule, WorkspacesModule, JobsModule, ResearchContinuityModule],
  controllers: [ResearchRunsController],
  providers: [ResearchRunsService, MarketDataGuardService],
  exports: [ResearchRunsService],
})
export class ResearchRunsModule {}
