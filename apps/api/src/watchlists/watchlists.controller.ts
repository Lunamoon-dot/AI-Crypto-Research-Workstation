import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AddWatchlistItemDto } from './dto/add-watchlist-item.dto';
import { WatchlistsService } from './watchlists.service';

@Controller('watchlists')
export class WatchlistsController {
  constructor(private readonly watchlists: WatchlistsService) {}

  @Get()
  list(@Query('limit') limit?: string) {
    return this.watchlists.list(Number(limit ?? 50));
  }

  @Post(':id/items')
  addItem(@Param('id') id: string, @Body() dto: AddWatchlistItemDto) {
    return this.watchlists.addItem(id, dto);
  }
}
