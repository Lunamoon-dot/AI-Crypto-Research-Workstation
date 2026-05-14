import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ComparisonsController } from './comparisons.controller';
import { ComparisonsService } from './comparisons.service';

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [ComparisonsController],
  providers: [ComparisonsService],
})
export class ComparisonsModule {}
