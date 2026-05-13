import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ResearchRunsController } from './research-runs.controller';
import { ResearchRunsService } from './research-runs.service';

@Module({
  imports: [AuthModule, WorkspacesModule, JobsModule],
  controllers: [ResearchRunsController],
  providers: [ResearchRunsService],
  exports: [ResearchRunsService],
})
export class ResearchRunsModule {}
