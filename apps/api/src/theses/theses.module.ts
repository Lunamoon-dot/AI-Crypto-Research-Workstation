import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ThesesController } from './theses.controller';
import { MonitoringJobsService } from './monitoring-jobs.service';
import { ThesesService } from './theses.service';

@Module({
  imports: [AuthModule, WorkspacesModule, JobsModule, MarketDataModule],
  controllers: [ThesesController],
  providers: [ThesesService, MonitoringJobsService],
})
export class ThesesModule {}
