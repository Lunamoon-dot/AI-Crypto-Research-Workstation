import { Module } from '@nestjs/common';
import { AlertsModule } from './alerts/alerts.module';
import { AuthModule } from './auth/auth.module';
import { BriefsModule } from './briefs/briefs.module';
import { DatabaseModule } from './database/database.module';
import { JobsController } from './jobs/jobs.controller';
import { JobsModule } from './jobs/jobs.module';
import { JournalModule } from './journal/journal.module';
import { ResearchRunsModule } from './research-runs/research-runs.module';
import { SignalsModule } from './signals/signals.module';
import { SystemController } from './system.controller';
import { ThesesModule } from './theses/theses.module';
import { UsersModule } from './users/users.module';
import { WatchlistsModule } from './watchlists/watchlists.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    WorkspacesModule,
    DatabaseModule,
    JobsModule,
    ResearchRunsModule,
    JournalModule,
    ThesesModule,
    SignalsModule,
    WatchlistsModule,
    BriefsModule,
    AlertsModule,
  ],
  controllers: [JobsController, SystemController],
})
export class AppModule {}
