import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import {
  PostgresResearchContinuityAuditRepository,
  RESEARCH_CONTINUITY_AUDIT_REPOSITORY,
} from './research-continuity-audit.repository';
import {
  PostgresResearchContinuitySettingsRepository,
  RESEARCH_CONTINUITY_SETTINGS_REPOSITORY,
} from './research-continuity-settings.repository';
import { ResearchContinuityController } from './research-continuity.controller';
import { ResearchContinuityService } from './research-continuity.service';

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [ResearchContinuityController],
  providers: [
    {
      provide: RESEARCH_CONTINUITY_AUDIT_REPOSITORY,
      useFactory: () => new PostgresResearchContinuityAuditRepository(),
    },
    {
      provide: RESEARCH_CONTINUITY_SETTINGS_REPOSITORY,
      useFactory: () => new PostgresResearchContinuitySettingsRepository(),
    },
    ResearchContinuityService,
  ],
  exports: [
    RESEARCH_CONTINUITY_AUDIT_REPOSITORY,
    RESEARCH_CONTINUITY_SETTINGS_REPOSITORY,
    ResearchContinuityService,
  ],
})
export class ResearchContinuityModule {}
