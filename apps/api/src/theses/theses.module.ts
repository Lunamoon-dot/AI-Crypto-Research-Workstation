import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ThesesController } from './theses.controller';
import { ThesesService } from './theses.service';

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [ThesesController],
  providers: [ThesesService],
})
export class ThesesModule {}
