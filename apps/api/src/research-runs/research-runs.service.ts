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
import {
  JournalRunWorkspaceResponse,
  ResearchRunDebateResponse,
  ResearchRunQueuedResponse,
  ResearchRunSnapshotsResponse,
  toAgentOpinionResponse,
  toDebateResponse,
  toMarketSnapshotResponse,
  toResearchRunEventResponse,
  toResearchRunResponse,
  toScenarioResponse,
  toSignalSnapshotResponse,
  toThesisResponse,
} from '../contracts/frontend-contract';
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

  async create(
    dto: CreateResearchRunDto,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchRunQueuedResponse> {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.assertRequestWorkspace(
      dto.workspace_id,
      workspaceHeader,
    );
    const permission = this.workspaces.assertAccess(user, workspaceId);
    const request: EngineRunRequest = {
      run_id: dto.run_id ?? `run_${randomUUID().replaceAll('-', '')}`,
      workspace_id: workspaceId,
      symbol: dto.symbol,
      asset_class: dto.asset_class ?? 'crypto',
      market_type: dto.market_type ?? 'spot',
      analysis_date: dto.analysis_date,
      analysts: dto.analysts,
      config_profile: dto.config_profile ?? 'default',
    };
    const job = await this.jobs.enqueueResearchRun(request);
    return {
      run_id: request.run_id,
      workspace_id: request.workspace_id,
      status:
        job.backend === 'inline' && typeof job.result?.status === 'string'
          ? job.result.status
          : job.backend === 'inline'
            ? 'submitted'
            : 'queued',
      job_id: job.id,
      queue_backend: job.backend,
      permission,
      result: job.result,
    };
  }

  async get(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = this.resolveWorkspace(userId, workspaceHeader);
    const run = await this.getRawRunOrThrow(id, workspaceId);
    return toResearchRunResponse(run);
  }

  async events(id: string, userId?: string, workspaceHeader?: string) {
    const workspaceId = this.resolveWorkspace(userId, workspaceHeader);
    await this.getRawRunOrThrow(id, workspaceId);
    const events = await this.journal.listRunEvents(id, workspaceId);
    return events.map(toResearchRunEventResponse);
  }

  async snapshots(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchRunSnapshotsResponse> {
    const workspaceId = this.resolveWorkspace(userId, workspaceHeader);
    const run = await this.getRawRunOrThrow(id, workspaceId);
    const marketSnapshotId = stringField(run.market_snapshot_id);
    const signalSnapshotId = stringField(run.signal_snapshot_id);
    const [marketSnapshot, signalSnapshot] = await Promise.all([
      marketSnapshotId
        ? this.journal.getMarketSnapshot(marketSnapshotId, workspaceId)
        : Promise.resolve(null),
      signalSnapshotId
        ? this.journal.getSignalSnapshot(signalSnapshotId, workspaceId)
        : Promise.resolve(null),
    ]);
    return {
      market_snapshot: marketSnapshot
        ? toMarketSnapshotResponse(marketSnapshot)
        : null,
      signal_snapshot: signalSnapshot
        ? toSignalSnapshotResponse(signalSnapshot)
        : null,
    };
  }

  async debate(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<ResearchRunDebateResponse> {
    const workspaceId = this.resolveWorkspace(userId, workspaceHeader);
    const run = await this.getRawRunOrThrow(id, workspaceId);
    const debateId = stringField(run.debate_id);
    if (!debateId) {
      return { debate: null, agent_opinions: [] };
    }
    const debate = await this.journal.getDebate(debateId, workspaceId);
    if (!debate) {
      return { debate: null, agent_opinions: [] };
    }
    const opinions = await this.journal.listAgentOpinions(debateId, workspaceId);
    return {
      debate: toDebateResponse(debate),
      agent_opinions: opinions.map(toAgentOpinionResponse),
    };
  }

  async workspace(
    id: string,
    userId?: string,
    workspaceHeader?: string,
  ): Promise<JournalRunWorkspaceResponse> {
    const workspaceId = this.resolveWorkspace(userId, workspaceHeader);
    const run = await this.getRawRunOrThrow(id, workspaceId);
    const thesisId = stringField(run.thesis_id);
    const [events, snapshots, debate, thesis] = await Promise.all([
      this.journal.listRunEvents(id, workspaceId),
      this.snapshots(id, userId, workspaceId),
      this.debate(id, userId, workspaceId),
      thesisId
        ? this.journal.getThesis(thesisId, workspaceId)
        : Promise.resolve(null),
    ]);
    const scenarios =
      thesisId && thesis
        ? await this.journal.listScenarios(thesisId, workspaceId)
        : [];
    return {
      run: toResearchRunResponse(run),
      events: events.map(toResearchRunEventResponse),
      snapshots,
      debate,
      thesis: thesis ? toThesisResponse(thesis) : null,
      scenarios: scenarios.map(toScenarioResponse),
    };
  }

  private resolveWorkspace(userId?: string, workspaceHeader?: string): string {
    const user = this.auth.resolveUser(userId);
    const workspaceId = this.workspaces.resolveWorkspace(workspaceHeader);
    this.workspaces.assertAccess(user, workspaceId);
    return workspaceId;
  }

  private async getRawRunOrThrow(id: string, workspaceId: string) {
    const run = await this.journal.getResearchRun(id, workspaceId);
    if (!run) {
      throw new NotFoundException(`Research run ${id} not found`);
    }
    return run;
  }
}

function stringField(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return String(value);
}
