import { Module } from '@nestjs/common';
import { AlertsModule } from './alerts/alerts.module';
import { AuthModule } from './auth/auth.module';
import { BriefsModule } from './briefs/briefs.module';
import { CalibrationModule } from './calibration/calibration.module';
import { DatabaseModule } from './database/database.module';
import { JobsController } from './jobs/jobs.controller';
import { JobsModule } from './jobs/jobs.module';
import { JournalModule } from './journal/journal.module';
import { MarketDataModule } from './market-data/market-data.module';
import { OperationsModule } from './operations/operations.module';
import { PerformanceModule } from './performance/performance.module';
import { ResearchContinuityModule } from './research-continuity/research-continuity.module';
import { ResearchRunsModule } from './research-runs/research-runs.module';
import { ScenariosModule } from './scenarios/scenarios.module';
import { SignalsModule } from './signals/signals.module';
import { SystemController } from './system.controller';
import { ThesesModule } from './theses/theses.module';
import { UsersModule } from './users/users.module';
import { WatchlistsModule } from './watchlists/watchlists.module';
import { WorkbenchModule } from './workbench/workbench.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    WorkspacesModule,
    DatabaseModule,
    JobsModule,
    ResearchContinuityModule,
    ResearchRunsModule,
    JournalModule,
    MarketDataModule,
    ThesesModule,
    SignalsModule,
    WatchlistsModule,
    BriefsModule,
    AlertsModule,
    CalibrationModule,
    PerformanceModule,
    ScenariosModule,
    OperationsModule,
    WorkbenchModule,
  ],
  controllers: [JobsController, SystemController],
})
export class AppModule {}
