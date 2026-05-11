import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  EngineRunRequest,
  JOURNAL_REPOSITORY,
  JournalRepository,
} from '../database/journal.types';
import { JobsService } from '../jobs/jobs.service';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateResearchRunDto } from './dto/create-research-run.dto';

@Injectable()
export class ResearchRunsService {
  constructor(
    @Inject(JOURNAL_REPOSITORY)
    private readonly journal: JournalRepository,
    private readonly jobs: JobsService,
    private readonly auth: AuthService,
    private readonly workspaces: WorkspacesService,
  ) {}

  async create(dto: CreateResearchRunDto, userId?: string) {
    const user = this.auth.resolveUser(userId);
    const permission = this.workspaces.assertAccess(user, dto.workspace_id);
    const request: EngineRunRequest = {
      run_id: dto.run_id ?? `run_${randomUUID().replaceAll('-', '')}`,
      workspace_id: dto.workspace_id,
      symbol: dto.symbol,
      asset_class: dto.asset_class ?? 'crypto',
      analysis_date: dto.analysis_date,
      analysts: dto.analysts,
      config_profile: dto.config_profile ?? 'default',
    };
    const job = await this.jobs.enqueueResearchRun(request);
    return {
      run_id: request.run_id,
      workspace_id: request.workspace_id,
      status: job.backend === 'inline' ? job.result?.status ?? 'submitted' : 'queued',
      job_id: job.id,
      queue_backend: job.backend,
      permission,
      result: job.result,
    };
  }

  async get(id: string) {
    const run = await this.journal.getResearchRun(id);
    if (!run) {
      throw new NotFoundException(`Research run ${id} not found`);
    }
    return run;
  }

  async events(id: string) {
    await this.get(id);
    return this.journal.listRunEvents(id);
  }
}
