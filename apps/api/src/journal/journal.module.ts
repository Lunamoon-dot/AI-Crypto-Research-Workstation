import { Module } from '@nestjs/common';
import { ResearchRunsModule } from '../research-runs/research-runs.module';
import { JournalController } from './journal.controller';

@Module({
  imports: [ResearchRunsModule],
  controllers: [JournalController],
})
export class JournalModule {}
