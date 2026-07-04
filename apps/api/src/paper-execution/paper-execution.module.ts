import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { PaperExecutionController } from './paper-execution.controller';
import { PaperExecutionService } from './paper-execution.service';

@Module({
  imports: [AuthModule, WorkspacesModule, MarketDataModule],
  controllers: [PaperExecutionController],
  providers: [PaperExecutionService],
  exports: [PaperExecutionService],
})
export class PaperExecutionModule {}
