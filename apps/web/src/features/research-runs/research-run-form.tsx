'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { createResearchRun } from '@/api/research-runs';
import { useAuth } from '@/auth/auth-provider';
import { PageHeader } from '@/components/research/page-header';
import { Panel } from '@/components/research/panel';
import { errorMessage } from '@/api/client';
import { todayIsoDate } from '@/lib/format';
import { routes } from '@/lib/routes';

const analystOptions = ['market', 'news', 'social', 'onchain', 'quant', 'risk'];

export function ResearchRunForm() {
  const auth = useAuth();
  const router = useRouter();
  const [symbol, setSymbol] = useState('BTC/USDT');
  const [marketType, setMarketType] = useState<'spot' | 'perp'>('spot');
  const [analysisDate, setAnalysisDate] = useState(todayIsoDate());
  const [profile, setProfile] = useState('default');
  const [analysts, setAnalysts] = useState<string[]>([
    'market',
    'news',
    'social',
    'onchain',
    'quant',
    'risk',
  ]);

  const mutation = useMutation({
    mutationFn: () =>
      createResearchRun(
        {
          workspace_id: auth.workspaceId,
          symbol,
          asset_class: 'crypto',
          market_type: marketType,
          analysis_date: analysisDate,
          analysts,
          config_profile: profile,
        },
        auth,
      ),
    onSuccess: (result) => {
      router.push(routes.researchRun(result.run_id));
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
        title="Run research"
        description="Launch a local AI research run through the NestJS API boundary."
      />
      <Panel title="Research request" description="No order execution. This creates a research artifact.">
        <form className="stack" onSubmit={submit}>
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
              Market
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

          <div className="label">
            Analysts
            <div className="top-strip-meta">
              {analystOptions.map((analyst) => (
                <label className="badge" key={analyst}>
                  <input
                    checked={analysts.includes(analyst)}
                    onChange={() => toggleAnalyst(analyst)}
                    type="checkbox"
                  />
                  {analyst}
                </label>
              ))}
            </div>
          </div>

          {mutation.isError ? (
            <div className="badge risk">{errorMessage(mutation.error)}</div>
          ) : null}

          <button
            className="button primary"
            disabled={mutation.isPending || analysts.length === 0}
            type="submit"
          >
            {mutation.isPending ? 'Submitting...' : 'Run research'}
          </button>
        </form>
      </Panel>
    </main>
  );
}
