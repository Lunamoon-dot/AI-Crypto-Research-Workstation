import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { BriefsModule } from './briefs/briefs.module';
import { DatabaseModule } from './database/database.module';
import { JobsModule } from './jobs/jobs.module';
import { ResearchRunsModule } from './research-runs/research-runs.module';
import { SignalsModule } from './signals/signals.module';
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
    ThesesModule,
    SignalsModule,
    WatchlistsModule,
    BriefsModule,
  ],
})
export class AppModule {}
