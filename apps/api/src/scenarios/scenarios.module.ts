import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ScenarioEvaluationService } from './scenario-evaluation.service';
import { ScenarioEvaluationsController } from './scenario-evaluations.controller';
import { ScenarioReliabilityController } from './scenario-reliability.controller';
import { ScenarioReliabilityService } from './scenario-reliability.service';
import { ScenariosController } from './scenarios.controller';
import { ScenariosService } from './scenarios.service';

@Module({
  imports: [AuthModule, WorkspacesModule, MarketDataModule],
  controllers: [
    ScenariosController,
    ScenarioEvaluationsController,
    ScenarioReliabilityController,
  ],
  providers: [
    ScenariosService,
    ScenarioEvaluationService,
    ScenarioReliabilityService,
  ],
  exports: [ScenariosService, ScenarioEvaluationService, ScenarioReliabilityService],
})
export class ScenariosModule {}
