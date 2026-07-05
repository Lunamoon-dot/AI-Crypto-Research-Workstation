import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { PaperExecutionModule } from '../paper-execution/paper-execution.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ScenarioEvaluationService } from './scenario-evaluation.service';
import { ScenarioEvaluationsController } from './scenario-evaluations.controller';
import { ScenarioChartProjectionService } from './scenario-chart-projection.service';
import { ScenarioChartSummaryService } from './scenario-chart-summary.service';
import { ScenarioContextLoaderService } from './scenario-context-loader.service';
import { ScenarioFeedbackPlaybookService } from './scenario-feedback-playbook.service';
import { ScenarioLiveStateService } from './scenario-live-state.service';
import { ScenarioReliabilityController } from './scenario-reliability.controller';
import { ScenarioReliabilityService } from './scenario-reliability.service';
import { ScenariosController } from './scenarios.controller';
import { ScenariosService } from './scenarios.service';

@Module({
  imports: [AuthModule, WorkspacesModule, MarketDataModule, PaperExecutionModule],
  controllers: [
    ScenariosController,
    ScenarioEvaluationsController,
    ScenarioReliabilityController,
  ],
  providers: [
    ScenariosService,
    ScenarioEvaluationService,
    ScenarioChartProjectionService,
    ScenarioChartSummaryService,
    ScenarioContextLoaderService,
    ScenarioFeedbackPlaybookService,
    ScenarioLiveStateService,
    ScenarioReliabilityService,
  ],
  exports: [
    ScenariosService,
    ScenarioEvaluationService,
    ScenarioChartProjectionService,
    ScenarioChartSummaryService,
    ScenarioContextLoaderService,
    ScenarioFeedbackPlaybookService,
    ScenarioLiveStateService,
    ScenarioReliabilityService,
  ],
})
export class ScenariosModule {}
