import { Inject, Injectable } from '@nestjs/common';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
} from '../database/journal.types';

@Injectable()
export class SignalsService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
  ) {}

  list(symbol?: string, limit = 50) {
    return this.journal.listSignals(symbol, limit);
  }
}
