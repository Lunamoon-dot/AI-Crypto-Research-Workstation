import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  JOURNAL_REPOSITORY,
  JournalRepository,
} from '../database/journal.types';

@Injectable()
export class ThesesService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
  ) {}

  list(limit = 50) {
    return this.journal.listTheses(limit);
  }

  async get(id: string) {
    const thesis = await this.journal.getThesis(id);
    if (!thesis) {
      throw new NotFoundException(`Thesis ${id} not found`);
    }
    return thesis;
  }

  async decide(id: string, action: string, notes = '') {
    await this.get(id);
    return this.journal.recordThesisDecision(id, action, notes);
  }

  async review(id: string, result: string, notes = '') {
    await this.get(id);
    return this.journal.recordThesisReview(id, result, notes);
  }
}
