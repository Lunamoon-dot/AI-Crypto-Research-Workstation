import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ResearchContinuityController } from './research-continuity.controller';
import { ResearchContinuityService } from './research-continuity.service';

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [ResearchContinuityController],
  providers: [ResearchContinuityService],
  exports: [ResearchContinuityService],
})
export class ResearchContinuityModule {}
