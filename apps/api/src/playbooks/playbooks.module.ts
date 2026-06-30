import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ScenariosModule } from '../scenarios/scenarios.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { PlaybookCompilerService } from './playbook-compiler.service';
import { PlaybooksController } from './playbooks.controller';

@Module({
  imports: [AuthModule, WorkspacesModule, ScenariosModule],
  controllers: [PlaybooksController],
  providers: [PlaybookCompilerService],
  exports: [PlaybookCompilerService],
})
export class PlaybooksModule {}
