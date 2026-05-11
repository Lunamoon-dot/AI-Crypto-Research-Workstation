import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { PythonEngineClient } from './python-engine.client';

@Module({
  providers: [JobsService, PythonEngineClient],
  exports: [JobsService, PythonEngineClient],
})
export class JobsModule {}
