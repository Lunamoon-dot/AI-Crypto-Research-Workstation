import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule {}
