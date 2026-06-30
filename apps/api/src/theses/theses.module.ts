import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { ScenariosModule } from '../scenarios/scenarios.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ThesesController } from './theses.controller';
import { ThesesService } from './theses.service';

@Module({
  imports: [AuthModule, WorkspacesModule, JobsModule, ScenariosModule],
  controllers: [ThesesController],
  providers: [ThesesService],
})
export class ThesesModule {}
