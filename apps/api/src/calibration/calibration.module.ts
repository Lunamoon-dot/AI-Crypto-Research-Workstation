import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { CalibrationController } from './calibration.controller';
import { CalibrationService } from './calibration.service';

@Module({
  imports: [AuthModule, WorkspacesModule, JobsModule],
  controllers: [CalibrationController],
  providers: [CalibrationService],
})
export class CalibrationModule {}
