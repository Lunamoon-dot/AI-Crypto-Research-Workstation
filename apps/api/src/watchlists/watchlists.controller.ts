import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { AddWatchlistItemDto } from './dto/add-watchlist-item.dto';
import { WatchlistsService } from './watchlists.service';

@Controller('watchlists')
export class WatchlistsController {
  constructor(private readonly watchlists: WatchlistsService) {}

  @Get()
  list(
    @Query('limit') limit?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.watchlists.list(Number(limit ?? 50), userId, workspaceId);
  }

  @Post(':id/items')
  addItem(
    @Param('id') id: string,
    @Body() dto: AddWatchlistItemDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.watchlists.addItem(id, dto, userId, workspaceId);
  }
}
