import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { BriefsController } from './briefs.controller';
import { BriefsService } from './briefs.service';

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [BriefsController],
  providers: [BriefsService],
})
export class BriefsModule {}
