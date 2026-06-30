import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { BacktestService } from './backtest.service';
import { BacktestsController } from './backtests.controller';

@Module({
  imports: [AuthModule, WorkspacesModule, MarketDataModule],
  controllers: [BacktestsController],
  providers: [BacktestService],
  exports: [BacktestService],
})
export class BacktestsModule {}
