import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { SignalsController } from './signals.controller';
import { SignalsService } from './signals.service';

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [SignalsController],
  providers: [SignalsService],
})
export class SignalsModule {}
