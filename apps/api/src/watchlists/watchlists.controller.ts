import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AddWatchlistItemDto } from './dto/add-watchlist-item.dto';
import { CheckWatchlistDto } from './dto/check-watchlist.dto';
import { CreateWatchlistDto } from './dto/create-watchlist.dto';
import { UpdateWatchlistDto } from './dto/update-watchlist.dto';
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

  @Post()
  create(
    @Body() dto: CreateWatchlistDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.watchlists.create(dto, userId, workspaceId);
  }

  @Get(':id')
  get(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.watchlists.get(id, userId, workspaceId);
  }

  @Get(':id/items')
  items(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.watchlists.items(id, userId, workspaceId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWatchlistDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.watchlists.update(id, dto, userId, workspaceId);
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

  @Post(':id/check')
  check(
    @Param('id') id: string,
    @Body() dto: CheckWatchlistDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.watchlists.check(id, dto, userId, workspaceId);
  }

  @Delete(':id/items/:itemId')
  removeItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.watchlists.removeItem(id, itemId, userId, workspaceId);
  }
}
