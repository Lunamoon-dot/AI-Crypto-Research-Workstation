import { PostgresJournalRepository } from './postgres-journal.repository';

// Kept for compatibility with the existing DatabaseModule selector. The local
// web MVP uses the Postgres-backed repository path for frontend-facing reads and
// writes while Prisma client generation is stabilized separately.
export class PrismaJournalRepository extends PostgresJournalRepository {}
