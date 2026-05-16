import { FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Brain,
  CalendarDays,
  Coins,
  Play,
  Radar,
} from 'lucide-react';
import { createResearchRun } from '@/services/research-runs';
import { BentoGrid } from '@/components/research/bento';
import { HeaderStats } from '@/components/research/header-stats';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { errorMessage } from '@/services/client';
import { todayIsoDate } from '@/lib/format';
import { routes } from '@/lib/routes';
import { researchRunRequestSchema } from '@/schemas/research-run';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';

const analystOptions = [
  {
    value: 'market',
    label: 'Market',
    avatarSrc: '/agent-avatars/market-analyst.png',
  },
  {
    value: 'news',
    label: 'News',
    avatarSrc: '/agent-avatars/news-analyst.png',
  },
  {
    value: 'social',
    label: 'Social',
    avatarSrc: '/agent-avatars/social-analyst.png',
  },
  {
    value: 'onchain',
    label: 'Onchain',
    avatarSrc: '/agent-avatars/onchain-analyst.png',
  },
];

export function ResearchRunFormPage() {
  const auth = useWorkspaceStore();
  const navigate = useNavigate();
  const [symbol, setSymbol] = useState('BTC/USDT');
  const [marketType, setMarketType] = useState<'spot' | 'perp'>('spot');
  const [analysisDate, setAnalysisDate] = useState(todayIsoDate());
  const [profile, setProfile] = useState('default');
  const [analysts, setAnalysts] = useState<string[]>([
    'market',
    'news',
    'social',
    'onchain',
  ]);

  const mutation = useMutation({
    mutationFn: () =>
      createResearchRun(
        researchRunRequestSchema.parse({
          workspace_id: auth.workspaceId,
          symbol,
          asset_class: 'crypto',
          market_type: marketType,
          analysis_date: analysisDate,
          analysts,
          config_profile: profile,
        }),
        auth,
    ),
    onSuccess: (result) => {
      navigate(routes.researchRun(result.run_id, result.job_id));
    },
  });

  function toggleAnalyst(value: string) {
    setAnalysts((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="02 Research Launcher"
        title="Launch a research run"
        description="Configure a local AI research request. The action creates research artifacts only; it does not execute trades."
        action={
          <HeaderStats
            stats={[
              {
                icon: <Coins aria-hidden size={14} />,
                label: 'Symbol',
                tone: 'primary',
                value: symbol || 'n/a',
              },
              {
                icon: <Radar aria-hidden size={14} />,
                label: 'Market',
                tone: 'constructive',
                value: marketType,
              },
              {
                icon: <CalendarDays aria-hidden size={14} />,
                label: 'Date',
                tone: 'warning',
                value: analysisDate,
              },
              {
                icon: <Brain aria-hidden size={14} />,
                label: 'Analysts',
                meta: 'Selected modules',
                value: analysts.length,
              },
            ]}
          />
        }
      />

      <form onSubmit={submit}>
        <BentoGrid>
          <Panel className="span-5 emphasis" title="Core parameters" description="Asset, market, date, and runtime profile">
            <div className="form-grid">
              <label className="label">
                Symbol
                <input
                  className="input"
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value)}
                  required
                />
              </label>
              <label className="label">
                Market type
                <select
                  className="select"
                  value={marketType}
                  onChange={(event) => setMarketType(event.target.value as 'spot' | 'perp')}
                >
                  <option value="spot">Spot</option>
                  <option value="perp">Perp</option>
                </select>
              </label>
              <label className="label">
                Analysis date
                <input
                  className="input"
                  type="date"
                  value={analysisDate}
                  onChange={(event) => setAnalysisDate(event.target.value)}
                  required
                />
              </label>
              <label className="label">
                Profile
                <select
                  className="select"
                  value={profile}
                  onChange={(event) => setProfile(event.target.value)}
                >
                  <option value="default">default</option>
                  <option value="fast">fast</option>
                  <option value="deep">deep</option>
                  <option value="low-cost">low-cost</option>
                </select>
              </label>
            </div>
          </Panel>

          <Panel className="span-7" title="Analyst modules" description="Pick the reasoning lanes for this run">
            <div className="analyst-module-grid">
              {analystOptions.map((analyst) => {
                const checked = analysts.includes(analyst.value);
                return (
                  <label className={`state-card ${checked ? 'emphasis' : ''}`} key={analyst.value}>
                    <div className="row">
                      <span className="analyst-module-avatar" aria-hidden>
                        <img src={analyst.avatarSrc} alt="" loading="lazy" />
                      </span>
                      <input
                        checked={checked}
                        onChange={() => toggleAnalyst(analyst.value)}
                        type="checkbox"
                      />
                    </div>
                    <strong>{analyst.label}</strong>
                    <span className="small muted">{checked ? 'Enabled for debate' : 'Excluded from this run'}</span>
                  </label>
                );
              })}
            </div>
          </Panel>

          <Panel className="span-12" title="Launch action" description="Submits to the existing NestJS API boundary">
            <div className="row start">
              <div className="stack">
                <div className="top-strip-meta">
                  <span className="badge primary">{auth.workspaceId}</span>
                  <span className="badge">{auth.mode}</span>
                  <span className="badge constructive">research-only</span>
                </div>
                {mutation.isError ? (
                  <div className="badge risk">{errorMessage(mutation.error)}</div>
                ) : null}
              </div>
              <button
                className="button primary"
                disabled={mutation.isPending || analysts.length === 0}
                type="submit"
              >
                <Play aria-hidden size={16} />
                {mutation.isPending ? 'Submitting...' : 'Run research'}
              </button>
            </div>
          </Panel>
        </BentoGrid>
      </form>
    </main>
  );
}
