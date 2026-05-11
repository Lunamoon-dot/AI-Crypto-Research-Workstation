import { Inject, Injectable } from '@nestjs/common';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
} from '../database/journal.types';
import { AddWatchlistItemDto } from './dto/add-watchlist-item.dto';

@Injectable()
export class WatchlistsService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
  ) {}

  list(limit = 50) {
    return this.journal.listWatchlists(limit);
  }

  addItem(id: string, dto: AddWatchlistItemDto) {
    return this.journal.addWatchlistItem(id, { ...dto });
  }
}
