import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Rss, Save, ServerCog, Trash2 } from 'lucide-react';
import { WorkspaceSwitcher } from '@/components/navigation/WorkspaceSwitcher';
import { BentoGrid } from '@/components/research/bento';
import { HeaderStats } from '@/components/research/header-stats';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { env } from '@/lib/env';
import { errorMessage } from '@/services/client';
import { queryKeys } from '@/services/query-keys';
import {
  deleteWorkspace,
  listWorkspaceNewsSources,
  updateWorkspaceNewsSources,
} from '@/services/workspaces';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import type {
  WorkspaceNewsSource,
  WorkspaceNewsSourceTargetAnalyst,
  WorkspaceNewsSourceTrustTier,
  WorkspaceNewsSourceType,
  WorkspaceSummary,
} from '@/types';
import { defaultWorkspaceNewsSourceScope } from './settings-news-source-scope';

type NewsSourceDraft = WorkspaceNewsSource & {
  scopeText: string;
};

const CATEGORY_OPTIONS = [
  'official_project',
  'exchange_announcements',
  'regulatory',
  'security',
  'macro',
  'crypto_media',
  'aggregator',
];

const TRUST_TIERS: WorkspaceNewsSourceTrustTier[] = [
  'user_trusted',
  'high',
  'medium',
  'low',
  'aggregator',
];

const ANALYST_TARGET_OPTIONS: Array<{
  label: string;
  value: WorkspaceNewsSourceTargetAnalyst;
}> = [
  { label: 'News Analyst', value: 'news' },
  { label: 'Social Analyst', value: 'social' },
];

export function WorkspaceConfigurationPage() {
  const auth = useWorkspaceStore();
  const queryClient = useQueryClient();
  const [newsSourceDrafts, setNewsSourceDrafts] = useState<NewsSourceDraft[]>([]);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const hasWorkspace = Boolean(auth.workspaceId.trim());
  const workspaceLabel = auth.workspace?.name ?? auth.workspaceId;
  const defaultScopeText = defaultWorkspaceNewsSourceScope(auth.workspace?.symbol);
  const hasWorkspaceSymbol = Boolean(defaultScopeText);
  const canDeleteWorkspace = hasWorkspace && auth.workspaceId !== 'local';
  const deleteConfirmationTarget = workspaceLabel || auth.workspaceId;
  const deleteConfirmationMatches =
    deleteConfirmation.trim() === deleteConfirmationTarget ||
    deleteConfirmation.trim() === auth.workspaceId;
  const newsSourcesQuery = useQuery({
    queryKey: queryKeys.workspaceNewsSources(auth.workspaceId),
    queryFn: () => listWorkspaceNewsSources(auth.workspaceId, auth),
    enabled: hasWorkspace,
  });
  const saveNewsSourcesMutation = useMutation({
    mutationFn: ({
      sources,
      workspaceId,
    }: {
      sources: WorkspaceNewsSource[];
      workspaceId: string;
    }) =>
      updateWorkspaceNewsSources(workspaceId, { sources }, auth),
    onSuccess: (response) => {
      const newsSourcesQueryKey = queryKeys.workspaceNewsSources(response.workspace_id);
      queryClient.setQueryData(newsSourcesQueryKey, response);
      if (response.workspace_id === auth.workspaceId) {
        setNewsSourceDrafts(response.sources.map(newsSourceToDraft));
      }
      void queryClient.invalidateQueries({
        queryKey: newsSourcesQueryKey,
      });
    },
  });
  const deleteWorkspaceMutation = useMutation({
    mutationFn: () => deleteWorkspace(auth.workspaceId, auth),
    onSuccess: async (workspace) => {
      queryClient.setQueryData<WorkspaceSummary[]>(
        queryKeys.workspacesRoot(),
        (workspaces) =>
          (workspaces ?? []).filter((candidate) => candidate.id !== workspace.id),
      );
      auth.clearWorkspace(workspace.id);
      setDeleteConfirmation('');
      setNewsSourceDrafts([]);
      queryClient.removeQueries({
        queryKey: queryKeys.workspaceNewsSources(workspace.id),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspacesRoot() });
    },
  });
  const showNewsSourcesQueryError =
    newsSourcesQuery.isError && newsSourceDrafts.length === 0;
  const savedNewsSources = newsSourcesQuery.data?.sources ?? [];
  const enabledSourcesForAnalyst = savedNewsSources.filter(
    (source) => source.enabled && sourceTargetsAnalyst(source, 'news'),
  );

  useEffect(() => {
    setNewsSourceDrafts([]);
    setDeleteConfirmation('');
  }, [auth.workspaceId]);

  useEffect(() => {
    if (newsSourcesQuery.data) {
      setNewsSourceDrafts(newsSourcesQuery.data.sources.map(newsSourceToDraft));
    }
  }, [newsSourcesQuery.data]);

  useEffect(() => {
    if (!defaultScopeText) {
      return;
    }
    setNewsSourceDrafts((sources) =>
      sources.map((source) =>
        source.id || source.name.trim() || source.url.trim() || source.scopeText !== 'ALL'
          ? source
          : {
              ...source,
              scope: parseScopeText(defaultScopeText),
              scopeText: defaultScopeText,
            },
      ),
    );
  }, [defaultScopeText]);

  function updateNewsSource(index: number, patch: Partial<NewsSourceDraft>) {
    setNewsSourceDrafts((sources) =>
      sources.map((source, sourceIndex) =>
        sourceIndex === index ? { ...source, ...patch } : source,
      ),
    );
  }

  function addNewsSource() {
    if (!defaultScopeText) {
      return;
    }
    setNewsSourceDrafts((sources) => [...sources, emptyNewsSourceDraft(defaultScopeText)]);
  }

  function removeNewsSource(index: number) {
    setNewsSourceDrafts((sources) =>
      sources.filter((_, sourceIndex) => sourceIndex !== index),
    );
  }

  function submitNewsSources(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasWorkspace || !defaultScopeText) {
      return;
    }
    saveNewsSourcesMutation.mutate({
      sources: newsSourceDrafts.map(draftToNewsSource),
      workspaceId: auth.workspaceId,
    });
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="Research configuration"
        title="Workspace Configuration"
        description="Workspace-scoped source controls that shape future research runs."
        action={
          <HeaderStats
            stats={[
              {
                icon: <Rss aria-hidden size={14} />,
                label: 'Enabled sources',
                tone: enabledSourcesForAnalyst.length > 0 ? 'constructive' : 'default',
                value: String(enabledSourcesForAnalyst.length),
              },
              {
                icon: <ServerCog aria-hidden size={14} />,
                label: 'API proxy',
                meta: env.apiBaseUrl,
                tone: 'warning',
                value: 'Local',
              },
            ]}
          />
        }
      />
      <BentoGrid>
        <Panel
          className="span-12"
          title="Workspace lifecycle"
          description="Archive the selected workspace from your workspace list without deleting historical research artifacts."
          action={
            <span className={canDeleteWorkspace ? 'badge warning' : 'badge'}>
              {canDeleteWorkspace ? 'deletable' : 'protected'}
            </span>
          }
        >
          <div className="workspace-news-source-context">
            <div className="workspace-news-source-target">
              <span>Selected workspace</span>
              <strong>{workspaceLabel || 'No workspace selected'}</strong>
              <small>
                Workspace id: {auth.workspaceId || 'none'} - archived workspaces are hidden from selection
              </small>
            </div>
          </div>
          <div className="form-grid">
            <label className="label">
              Type workspace name or id to delete
              <input
                className="input"
                disabled={!canDeleteWorkspace || deleteWorkspaceMutation.isPending}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                placeholder={deleteConfirmationTarget}
                value={deleteConfirmation}
              />
            </label>
          </div>
          <div className="top-strip-meta">
            <button
              className="button risk"
              disabled={
                !canDeleteWorkspace ||
                !deleteConfirmationMatches ||
                deleteWorkspaceMutation.isPending
              }
              onClick={() => deleteWorkspaceMutation.mutate()}
              type="button"
            >
              <Trash2 aria-hidden size={16} />
              {deleteWorkspaceMutation.isPending ? 'Deleting workspace' : 'Delete workspace'}
            </button>
            {deleteWorkspaceMutation.isError ? (
              <span className="badge risk">{errorMessage(deleteWorkspaceMutation.error)}</span>
            ) : null}
            {deleteWorkspaceMutation.isSuccess ? (
              <span className="badge constructive">workspace archived</span>
            ) : null}
          </div>
        </Panel>
        <Panel
          className="span-12"
          title="Workspace analyst sources"
          description="RSS sources saved here are tagged by target analyst. News-targeted sources are injected into News Analyst runs; Social-targeted sources stay separate."
          action={
            <span className={newsSourceDrafts.some((source) => source.enabled) ? 'badge constructive' : 'badge'}>
              <Rss aria-hidden size={13} />
              {newsSourceDrafts.filter((source) => source.enabled).length} enabled
            </span>
          }
        >
          <div className="workspace-news-source-context">
            <div className="workspace-news-source-target">
              <span>Source set</span>
              <strong>{workspaceLabel || 'No workspace selected'}</strong>
              <small>
                Selected workspace: {auth.workspaceId || 'none'} - Target analyst:{' '}
                source-level setting - Source scope: this workspace
              </small>
            </div>
            <WorkspaceSwitcher />
          </div>
          <div className="workspace-news-source-preview" aria-label="News Analyst source preview">
            <div className="workspace-news-source-preview-header">
              <span>News Analyst will use</span>
              <strong>{enabledSourcesForAnalyst.length} enabled source(s)</strong>
            </div>
            {enabledSourcesForAnalyst.length > 0 ? (
              <div className="workspace-news-source-preview-list">
                {enabledSourcesForAnalyst.map((source) => (
                  <div className="workspace-news-source-preview-item" key={source.id}>
                    <strong>{source.name}</strong>
                    <span>{source.url}</span>
                    <div className="top-strip-meta">
                      <span className="badge">{source.type.toUpperCase()}</span>
                      <span className="badge">{formatNewsSourceLabel(source.category)}</span>
                      <span className="badge">{formatNewsSourceLabel(source.trust_tier)}</span>
                      <span className="badge">target {formatAnalystTargets(source.target_analysts)}</span>
                      <span className="badge">scope {source.scope.join(', ')}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">
                No enabled saved sources. The next News Analyst run will use default providers only.
              </p>
            )}
            <small>Disabled sources stay saved but are not injected.</small>
          </div>
          <form className="stack lg workspace-news-source-form" onSubmit={submitNewsSources}>
            {newsSourcesQuery.isLoading ? (
              <span className="badge">
                <RefreshCw aria-hidden size={13} />
                Loading sources
              </span>
            ) : null}
            {showNewsSourcesQueryError ? (
              <span className="badge risk">{errorMessage(newsSourcesQuery.error)}</span>
            ) : null}
            {!newsSourcesQuery.isLoading && newsSourceDrafts.length === 0 ? (
              <p className="small muted">No workspace analyst sources configured.</p>
            ) : null}
            <div className="workspace-news-source-list">
              {newsSourceDrafts.map((source, index) => (
                <div className="workspace-news-source-row" key={`${source.id || 'new'}-${index}`}>
                  <div className="row start">
                    <div className="stack">
                      <strong>{source.name || 'New source'}</strong>
                      <span className="small muted">
                        {formatAnalystTargets(source.target_analysts)} -{' '}
                        {source.url || 'RSS or Atom URL'}
                      </span>
                    </div>
                    <button
                      aria-label="Remove source"
                      className="button icon"
                      onClick={() => removeNewsSource(index)}
                      type="button"
                    >
                      <Trash2 aria-hidden size={16} />
                    </button>
                  </div>
                  <div className="form-grid workspace-news-source-grid">
                    <label className="label">
                      Name
                      <input
                        className="input"
                        onChange={(event) => updateNewsSource(index, { name: event.target.value })}
                        required
                        value={source.name}
                      />
                    </label>
                    <label className="label">
                      URL
                      <input
                        className="input"
                        onChange={(event) => updateNewsSource(index, { url: event.target.value })}
                        required
                        type="url"
                        value={source.url}
                      />
                    </label>
                    <label className="label">
                      Target analyst
                      <select
                        className="select"
                        onChange={(event) =>
                          updateNewsSource(index, {
                            target_analysts: [
                              event.target.value as WorkspaceNewsSourceTargetAnalyst,
                            ],
                          })
                        }
                        value={source.target_analysts[0] ?? 'news'}
                      >
                        {ANALYST_TARGET_OPTIONS.map((target) => (
                          <option key={target.value} value={target.value}>
                            {target.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="label">
                      Type
                      <select
                        className="select"
                        onChange={(event) =>
                          updateNewsSource(index, {
                            type: event.target.value as WorkspaceNewsSourceType,
                          })
                        }
                        value={source.type}
                      >
                        <option value="rss">RSS</option>
                        <option value="atom">Atom</option>
                      </select>
                    </label>
                    <label className="label">
                      Category
                      <select
                        className="select"
                        onChange={(event) => updateNewsSource(index, { category: event.target.value })}
                        value={source.category}
                      >
                        {CATEGORY_OPTIONS.map((category) => (
                          <option key={category} value={category}>
                            {category.replaceAll('_', ' ')}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="label">
                      Trust
                      <select
                        className="select"
                        onChange={(event) =>
                          updateNewsSource(index, {
                            trust_tier: event.target.value as WorkspaceNewsSourceTrustTier,
                          })
                        }
                        value={source.trust_tier}
                      >
                        {TRUST_TIERS.map((tier) => (
                          <option key={tier} value={tier}>
                            {tier.replaceAll('_', ' ')}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="top-strip-meta">
                    <label className="inline-check">
                      <input
                        checked={source.enabled}
                        onChange={(event) => updateNewsSource(index, { enabled: event.target.checked })}
                        type="checkbox"
                      />
                      enabled
                    </label>
                    <label className="inline-check">
                      <input
                        checked={source.official}
                        onChange={(event) => updateNewsSource(index, { official: event.target.checked })}
                        type="checkbox"
                      />
                      official
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <div className="top-strip-meta">
              <button
                className="button"
                disabled={!hasWorkspaceSymbol}
                onClick={addNewsSource}
                type="button"
              >
                <Plus aria-hidden size={16} />
                Add source
              </button>
              <button
                className="button primary"
                disabled={!hasWorkspace || !hasWorkspaceSymbol || saveNewsSourcesMutation.isPending || newsSourcesQuery.isLoading}
                type="submit"
              >
                <Save aria-hidden size={16} />
                {saveNewsSourcesMutation.isPending ? 'Saving' : 'Save sources'}
              </button>
              {saveNewsSourcesMutation.isError ? (
                <span className="badge risk">{errorMessage(saveNewsSourcesMutation.error)}</span>
              ) : null}
              {saveNewsSourcesMutation.isSuccess ? (
                <span className="badge constructive">sources saved</span>
              ) : null}
            </div>
          </form>
        </Panel>
      </BentoGrid>
    </main>
  );
}

function newsSourceToDraft(source: WorkspaceNewsSource): NewsSourceDraft {
  return {
    ...source,
    scopeText: source.scope.join(', '),
  };
}

function draftToNewsSource(draft: NewsSourceDraft): WorkspaceNewsSource {
  return {
    id: draft.id,
    name: draft.name.trim(),
    type: draft.type,
    url: draft.url.trim(),
    category: draft.category,
    trust_tier: draft.trust_tier,
    target_analysts: normalizeAnalystTargets(draft.target_analysts),
    scope: parseScopeText(draft.scopeText),
    official: draft.official,
    enabled: draft.enabled,
  };
}

function emptyNewsSourceDraft(scopeText: string): NewsSourceDraft {
  return {
    id: '',
    name: '',
    type: 'rss',
    url: '',
    category: 'crypto_media',
    trust_tier: 'user_trusted',
    target_analysts: ['news'],
    scope: parseScopeText(scopeText),
    official: false,
    enabled: true,
    scopeText,
  };
}

function parseScopeText(value: string): string[] {
  const scopes = value
    .split(',')
    .map((scope) => scope.trim().toUpperCase())
    .filter(Boolean);
  return scopes.length > 0 ? [...new Set(scopes)] : ['ALL'];
}

function formatNewsSourceLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

function sourceTargetsAnalyst(
  source: WorkspaceNewsSource,
  analyst: WorkspaceNewsSourceTargetAnalyst,
): boolean {
  return normalizeAnalystTargets(source.target_analysts).includes(analyst);
}

function normalizeAnalystTargets(
  targets: WorkspaceNewsSourceTargetAnalyst[] | undefined,
): WorkspaceNewsSourceTargetAnalyst[] {
  const normalized = (targets ?? [])
    .map((target) => target.trim().toLowerCase())
    .filter((target): target is WorkspaceNewsSourceTargetAnalyst =>
      target === 'news' || target === 'social',
    );
  return normalized.length > 0 ? [...new Set(normalized)] : ['news'];
}

function formatAnalystTargets(targets: WorkspaceNewsSourceTargetAnalyst[]): string {
  return normalizeAnalystTargets(targets)
    .map(
      (target) =>
        ANALYST_TARGET_OPTIONS.find((option) => option.value === target)?.label ?? target,
    )
    .join(', ');
}
