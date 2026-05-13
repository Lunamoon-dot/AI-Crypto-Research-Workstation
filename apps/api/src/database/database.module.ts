import { Global, Module } from '@nestjs/common';
import { JOURNAL_REPOSITORY } from './journal.types';
import { PostgresJournalRepository } from './postgres-journal.repository';
import { PrismaJournalRepository } from './prisma-journal.repository';

@Global()
@Module({
  providers: [
    {
      provide: JOURNAL_REPOSITORY,
      useFactory: () => {
        const accessMode = (
          process.env.DATABASE_ACCESS ??
          process.env.DATABASE_REPOSITORY ??
          'prisma'
        ).toLowerCase();
        if (['pg', 'postgres', 'raw-pg'].includes(accessMode)) {
          return new PostgresJournalRepository();
        }
        return new PrismaJournalRepository();
      },
    },
  ],
  exports: [JOURNAL_REPOSITORY],
})
export class DatabaseModule {}
