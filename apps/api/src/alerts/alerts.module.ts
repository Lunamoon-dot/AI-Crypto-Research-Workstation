import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { WatchlistsModule } from '../watchlists/watchlists.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

@Module({
  imports: [AuthModule, WorkspacesModule, WatchlistsModule],
  controllers: [AlertsController],
  providers: [AlertsService],
})
export class AlertsModule {}
