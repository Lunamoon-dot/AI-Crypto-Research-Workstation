import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MarketDataController } from './market-data.controller';
import { MarketOhlcvService } from './market-ohlcv.service';
import { MarketPriceService } from './market-price.service';

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [MarketDataController],
  providers: [MarketOhlcvService, MarketPriceService],
  exports: [MarketOhlcvService, MarketPriceService],
})
export class MarketDataModule {}
