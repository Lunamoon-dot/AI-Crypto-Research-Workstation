import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import {
  PostgresResearchContinuityAuditRepository,
  RESEARCH_CONTINUITY_AUDIT_REPOSITORY,
} from './research-continuity-audit.repository';
import { ResearchContinuityController } from './research-continuity.controller';
import { ResearchContinuityService } from './research-continuity.service';

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [ResearchContinuityController],
  providers: [
    {
      provide: RESEARCH_CONTINUITY_AUDIT_REPOSITORY,
      useClass: PostgresResearchContinuityAuditRepository,
    },
    ResearchContinuityService,
  ],
  exports: [RESEARCH_CONTINUITY_AUDIT_REPOSITORY, ResearchContinuityService],
})
export class ResearchContinuityModule {}
