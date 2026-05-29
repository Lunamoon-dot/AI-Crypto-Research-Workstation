import { FormEvent, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Brain,
  CalendarDays,
  CheckCircle2,
  Coins,
  Gauge,
  Play,
  Radar,
  ShieldCheck,
} from "lucide-react";
import { createResearchRun } from "@/services/research-runs";
import { BentoGrid } from "@/components/research/bento";
import { HeaderStats } from "@/components/research/header-stats";
import { PageHeader } from "@/components/research/page-header";
import { Panel } from "@/components/research/panel";
import { errorMessage } from "@/services/client";
import { todayIsoDate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { researchRunRequestSchema } from "@/schemas/research-run";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";

type MarketType = "spot" | "perp";

const symbolPresets = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
  "LINK/USDT",
  "BNB/USDT",
];

const marketOptions: Array<{
  value: MarketType;
  label: string;
  description: string;
  meta: string;
}> = [
  {
    value: "spot",
    label: "Spot desk",
    description:
      "Use cash-market evidence without funding or liquidation assumptions.",
    meta: "clean directional read",
  },
  {
    value: "perp",
    label: "Perp desk",
    description:
      "Include derivatives context when the run needs leverage-sensitive signals.",
    meta: "funding aware",
  },
];

const profileOptions = [
  {
    value: "default",
    label: "Balanced review",
    description:
      "Best default for daily research with full evidence gathering.",
    meta: "standard cost",
  },
  {
    value: "fast",
    label: "Fast triage",
    description:
      "Short pass for deciding whether a setup deserves deeper work.",
    meta: "low latency",
  },
  {
    value: "deep",
    label: "Deep dossier",
    description:
      "Use when invalidation, debate, and continuity matter more than speed.",
    meta: "max context",
  },
  {
    value: "low-cost",
    label: "Cost guard",
    description:
      "Conservative evidence sweep for routine watchlist maintenance.",
    meta: "budget first",
  },
];

const analystOptions = [
  {
    value: "market",
    label: "Market",
    description:
      "Price structure, trend regime, volatility, and deterministic signal checks.",
    avatarSrc: "/agent-avatars/market-analyst.png",
  },
  {
    value: "news",
    label: "News",
    description:
      "Catalysts, macro context, token-specific headlines, and source freshness.",
    avatarSrc: "/agent-avatars/news-analyst.png",
  },
  {
    value: "social",
    label: "Social",
    description:
      "Narrative pressure, attention shifts, and crowd-risk evidence.",
    avatarSrc: "/agent-avatars/social-analyst.png",
  },
  {
    value: "onchain",
    label: "On-chain",
    description:
      "Wallet activity, flows, supply movement, and chain-level anomalies.",
    avatarSrc: "/agent-avatars/onchain-analyst.png",
  },
];

export function ResearchRunFormPage() {
  const auth = useWorkspaceStore();
  const navigate = useNavigate();
  const [symbol, setSymbol] = useState("BTC/USDT");
  const [marketType, setMarketType] = useState<MarketType>("spot");
  const [analysisDate, setAnalysisDate] = useState(todayIsoDate());
  const [profile, setProfile] = useState("default");
  const [analysts, setAnalysts] = useState<string[]>([
    "market",
    "news",
    "social",
    "onchain",
  ]);

  const normalizedSymbol = symbol.trim().toUpperCase();
  const selectedProfile =
    profileOptions.find((option) => option.value === profile) ??
    profileOptions[0];
  const selectedAnalystLabels = useMemo(
    () =>
      analystOptions
        .filter((analyst) => analysts.includes(analyst.value))
        .map((analyst) => analyst.label),
    [analysts],
  );
  const disabledReason = !normalizedSymbol
    ? "Enter a symbol before launching."
    : analysts.length === 0
      ? "Select at least one analyst module."
      : "";

  const mutation = useMutation({
    mutationFn: () =>
      createResearchRun(
        researchRunRequestSchema.parse({
          workspace_id: auth.workspaceId,
          symbol: normalizedSymbol,
          asset_class: "crypto",
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
    if (mutation.isPending || disabledReason) {
      return;
    }
    mutation.mutate();
  }

  return (
    <main className="page research-launch-page">
      <PageHeader
        eyebrow="02 Research Launcher"
        title="Build a research dossier"
        description="Choose the asset, market lens, analyst desk, and runtime profile before creating research artifacts. This flow stays inside the research boundary and never places live orders."
        action={
          <HeaderStats
            stats={[
              {
                icon: <Coins aria-hidden size={14} />,
                label: "Target",
                tone: normalizedSymbol ? "primary" : "risk",
                value: normalizedSymbol || "n/a",
              },
              {
                icon: <Radar aria-hidden size={14} />,
                label: "Market",
                tone: marketType === "perp" ? "warning" : "constructive",
                value: marketType,
              },
              {
                icon: <CalendarDays aria-hidden size={14} />,
                label: "Date",
                tone: "warning",
                value: analysisDate,
              },
              {
                icon: <Brain aria-hidden size={14} />,
                label: "Analysts",
                meta: selectedProfile.label,
                value: analysts.length,
              },
            ]}
          />
        }
      />

      <form className="research-launch-form" onSubmit={submit}>
        <BentoGrid className="research-launch-grid">
          <Panel
            className="span-7 emphasis launch-target-panel"
            title="Research target"
            description="Start with the instrument and the market lens. Presets are shortcuts, not locked templates."
          >
            <div className="launch-target-stack">
              <label className="label launch-symbol-label">
                Symbol
                <input
                  className="input launch-symbol-input"
                  value={symbol}
                  onChange={(event) =>
                    setSymbol(event.target.value.toUpperCase())
                  }
                  placeholder="BTC/USDT"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>

              <div className="symbol-chip-row" aria-label="Common symbols">
                {symbolPresets.map((preset) => (
                  <button
                    className={`symbol-chip${normalizedSymbol === preset ? " active" : ""}`}
                    key={preset}
                    type="button"
                    onClick={() => setSymbol(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <div className="launch-choice-grid" aria-label="Market type">
                {marketOptions.map((option) => (
                  <button
                    aria-pressed={marketType === option.value}
                    className={`launch-choice-card${marketType === option.value ? " active" : ""}`}
                    key={option.value}
                    type="button"
                    onClick={() => setMarketType(option.value)}
                  >
                    <span className="launch-choice-kicker">{option.meta}</span>
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>

              <label className="label launch-date-field">
                Analysis date
                <input
                  className="input"
                  type="date"
                  value={analysisDate}
                  onChange={(event) => setAnalysisDate(event.target.value)}
                  required
                />
              </label>
            </div>
          </Panel>

          <Panel
            className="span-5 launch-profile-panel"
            title="Runtime profile"
            description="Pick the tradeoff before the API creates a job."
          >
            <div className="launch-profile-list" aria-label="Runtime profile">
              {profileOptions.map((option) => (
                <button
                  aria-pressed={profile === option.value}
                  className={`launch-profile-card${profile === option.value ? " active" : ""}`}
                  key={option.value}
                  type="button"
                  onClick={() => setProfile(option.value)}
                >
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  <span className="badge primary">{option.meta}</span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel
            className="span-7 launch-analyst-panel"
            title="Analyst desk"
            description="Every selected module contributes evidence before the manager synthesizes the thesis."
          >
            <div className="launch-analyst-grid">
              {analystOptions.map((analyst) => {
                const checked = analysts.includes(analyst.value);
                return (
                  <label
                    className={`launch-analyst-card${checked ? " active" : ""}`}
                    key={analyst.value}
                  >
                    <div className="launch-analyst-card-header">
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
                    <span>{analyst.description}</span>
                    <small>
                      {checked
                        ? "Included in debate"
                        : "Excluded from this run"}
                    </small>
                  </label>
                );
              })}
            </div>
          </Panel>

          <Panel
            className="span-5 emphasis launch-summary-panel"
            title="Run preview"
            description="Confirm the shape of the job before launching."
          >
            <div className="launch-summary-card">
              <div className="launch-summary-symbol">
                <span>Target</span>
                <strong>{normalizedSymbol || "No symbol"}</strong>
              </div>
              <div className="launch-summary-grid">
                <div>
                  <span>Market</span>
                  <strong>{marketType}</strong>
                </div>
                <div>
                  <span>Profile</span>
                  <strong>{selectedProfile.value}</strong>
                </div>
                <div>
                  <span>Date</span>
                  <strong>{analysisDate}</strong>
                </div>
                <div>
                  <span>Modules</span>
                  <strong>{analysts.length}/4</strong>
                </div>
              </div>
            </div>

            <div className="launch-checklist" aria-label="Pre-flight checklist">
              <PreflightItem
                ready={Boolean(normalizedSymbol)}
                label="Symbol is defined"
              />
              <PreflightItem
                ready={analysts.length > 0}
                label="At least one analyst is active"
              />
              <PreflightItem
                ready={Boolean(analysisDate)}
                label="Analysis date is locked"
              />
            </div>

            <div className="callout launch-safety-callout">
              <ShieldCheck aria-hidden size={16} />
              <div>
                <strong>Research-only boundary</strong>
                <p>
                  Creates a run, evidence artifacts, and thesis output. It does
                  not execute trades.
                </p>
              </div>
            </div>
          </Panel>

          <Panel
            className="span-12 launch-action-panel"
            title="Launch action"
            description="The next screen shows pipeline progress, generated artifacts, data quality, and debate output."
          >
            <div className="launch-action-content">
              <div
                className="launch-outcome-list"
                aria-label="Expected outputs"
              >
                <span>
                  <CheckCircle2 aria-hidden size={15} /> Thesis result
                </span>
                <span>
                  <Gauge aria-hidden size={15} /> Data quality
                </span>
                <span>
                  <Brain aria-hidden size={15} /> Agent debate
                </span>
                <span>
                  <Radar aria-hidden size={15} /> Signal snapshot
                </span>
              </div>
              <div className="launch-submit-stack">
                <div className="top-strip-meta">
                  <span className="badge primary">{auth.workspaceId}</span>
                  <span className="badge">{auth.mode}</span>
                  <span className="badge constructive">research-only</span>
                </div>
                {selectedAnalystLabels.length ? (
                  <span className="small muted">
                    Desk: {selectedAnalystLabels.join(" / ")}
                  </span>
                ) : null}
                {disabledReason ? (
                  <div className="badge warning">
                    <AlertTriangle aria-hidden size={13} />
                    {disabledReason}
                  </div>
                ) : null}
                {mutation.isError ? (
                  <div className="badge risk">
                    {errorMessage(mutation.error)}
                  </div>
                ) : null}
                <button
                  className="button primary launch-submit-button"
                  disabled={mutation.isPending || Boolean(disabledReason)}
                  type="submit"
                >
                  <Play aria-hidden size={16} />
                  {mutation.isPending
                    ? "Submitting research run"
                    : "Launch research run"}
                </button>
              </div>
            </div>
          </Panel>
        </BentoGrid>
      </form>
    </main>
  );
}

function PreflightItem({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className={`launch-checklist-item${ready ? " ready" : ""}`}>
      {ready ? (
        <CheckCircle2 aria-hidden size={15} />
      ) : (
        <AlertTriangle aria-hidden size={15} />
      )}
      <span>{label}</span>
    </div>
  );
}
