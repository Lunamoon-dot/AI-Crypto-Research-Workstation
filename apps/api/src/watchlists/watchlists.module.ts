import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketPriceService } from '../market-data/market-price.service';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { WatchlistsController } from './watchlists.controller';
import { WatchlistsService } from './watchlists.service';

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [WatchlistsController],
  providers: [WatchlistsService, MarketPriceService],
  exports: [WatchlistsService],
})
export class WatchlistsModule {}
