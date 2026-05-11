import { Global, Module } from '@nestjs/common';
import { JOURNAL_REPOSITORY } from './journal.types';
import { PostgresJournalRepository } from './postgres-journal.repository';

@Global()
@Module({
  providers: [
    {
      provide: JOURNAL_REPOSITORY,
      useFactory: () => new PostgresJournalRepository(),
    },
  ],
  exports: [JOURNAL_REPOSITORY],
})
export class DatabaseModule {}
