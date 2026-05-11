import { Inject, Injectable } from '@nestjs/common';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
} from '../database/journal.types';

@Injectable()
export class BriefsService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
  ) {}

  daily(date?: string, limit = 20) {
    return this.journal.listDailyBriefs(date, limit);
  }
}
