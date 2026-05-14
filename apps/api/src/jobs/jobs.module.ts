import { Module } from '@nestjs/common';
import { JobLifecycleService } from './job-lifecycle.service';
import { JobsService } from './jobs.service';
import { PythonEngineClient } from './python-engine.client';
import { ResearchJobProcessor } from './research-job.processor';
import { SqliteJournalSyncService } from './sqlite-journal-sync.service';

@Module({
  providers: [
    JobsService,
    JobLifecycleService,
    PythonEngineClient,
    ResearchJobProcessor,
    SqliteJournalSyncService,
  ],
  exports: [
    JobsService,
    JobLifecycleService,
    PythonEngineClient,
    ResearchJobProcessor,
    SqliteJournalSyncService,
  ],
})
export class JobsModule {}
