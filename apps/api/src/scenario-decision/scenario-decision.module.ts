import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ScenariosModule } from '../scenarios/scenarios.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ScenarioDecisionController } from './scenario-decision.controller';
import { ScenarioDecisionWorkbenchService } from './scenario-decision-workbench.service';

@Module({
  imports: [AuthModule, WorkspacesModule, ScenariosModule],
  controllers: [ScenarioDecisionController],
  providers: [ScenarioDecisionWorkbenchService],
  exports: [ScenarioDecisionWorkbenchService],
})
export class ScenarioDecisionModule {}
