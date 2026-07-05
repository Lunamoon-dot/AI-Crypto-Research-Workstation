import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Gauge,
  Play,
  Radar,
  ShieldCheck,
} from "lucide-react";
import {
  createResearchRun,
  getApiHealth,
  getJobStatus,
  type CreateResearchRunRequest,
} from "@/services/research-runs";
import { BentoGrid } from "@/components/research/bento";
import { Panel } from "@/components/research/panel";
import { isApiError } from "@/services/api-error";
import { errorMessage } from "@/services/client";
import { todayIsoDate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { researchRunRequestSchema } from "@/schemas/research-run";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";

type MarketType = "perp";

const marketOptions: Array<{
  value: MarketType;
  label: string;
  description: string;
  meta: string;
}> = [
  {
    value: "perp",
    label: "Perp desk",
    description:
      "Include derivatives context when the run needs leverage-sensitive signals.",
    meta: "funding aware",
  },
];

const analystOptions = [
  {
    value: "market",
    label: "Market",
    description:
      "Price structure, trend regime, volatility, and deterministic signal checks.",
    Icon: Gauge,
  },
  {
    value: "news",
    label: "News",
    description:
      "Catalysts, macro context, token-specific headlines, and source freshness.",
    Icon: Radar,
  },
  {
    value: "social",
    label: "Social",
    description:
      "Narrative pressure, attention shifts, and crowd-risk evidence.",
    Icon: Brain,
  },
  {
    value: "onchain",
    label: "On-chain",
    description:
      "Wallet activity, flows, supply movement, and chain-level anomalies.",
    Icon: ShieldCheck,
  },
];

const languageOptions = [
  { value: "English", label: "English" },
  { value: "Vietnamese", label: "Vietnamese" },
];

export function ResearchRunFormPage() {
  const auth = useWorkspaceStore();
  const navigate = useNavigate();
  const [symbol, setSymbol] = useState("BTC/USDT");
  const marketType: MarketType = "perp";
  const [analysisDate, setAnalysisDate] = useState(todayIsoDate());
  const [profile] = useState("default");
  const [outputLanguage, setOutputLanguage] = useState("English");
  const [analysts, setAnalysts] = useState<string[]>([
    "market",
    "news",
    "social",
    "onchain",
  ]);
  const [launchRetryReady, setLaunchRetryReady] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fixedWorkspaceSymbol = auth.fixedWorkspaceSymbol();
  const legacyMixedWorkspace = auth.isLegacyMixedWorkspace();
  const normalizedSymbol = symbol.trim().toUpperCase();
  const effectiveSymbol = fixedWorkspaceSymbol ?? normalizedSymbol;
  const selectedAnalystLabels = useMemo(
    () =>
      analystOptions
        .filter((analyst) => analysts.includes(analyst.value))
        .map((analyst) => analyst.label),
    [analysts],
  );
  const apiHealth = useQuery({
    queryKey: ["api-health", auth.mode, auth.workspaceId],
    queryFn: () => getApiHealth(auth),
    retry: true,
    retryDelay: 1000,
    refetchInterval: (query) =>
      query.state.status === "success" ? false : 1000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
  const apiReady = apiHealth.data?.status === "ok";
  const validationDisabledReason = legacyMixedWorkspace
    ? "Create a fixed-symbol workspace to run research"
    : !effectiveSymbol
      ? "Enter a symbol before launching."
      : analysts.length === 0
        ? "Select at least one analyst module."
        : "";
  const disabledReason = !apiReady
    ? "Backend is starting. Launch will unlock when API is ready."
    : validationDisabledReason;

  const mutation = useMutation({
    onMutate: () => {
      setLaunchRetryReady(false);
      setConfirmOpen(false);
    },
    mutationFn: (request: CreateResearchRunRequest) =>
      createResearchRunWithFreshHealth(request),
    onSuccess: (result) => {
      navigate(routes.researchRun(result.run_id, result.job_id));
    },
    onError: async (error, request) => {
      if (!isTransientLaunchError(error)) {
        setLaunchRetryReady(false);
        return;
      }
      const health = await apiHealth.refetch();
      const ready = health.data?.status === "ok";
      setLaunchRetryReady(ready);
      if (!ready || !request.run_id) {
        return;
      }
      try {
        const job = await getJobStatus(request.run_id, auth);
        navigate(routes.researchRun(job.run_id, job.id));
      } catch {
        // The POST may have failed before enqueue; leave the retry affordance visible.
      }
    },
  });

  function buildLaunchRequest(): CreateResearchRunRequest {
    return researchRunRequestSchema.parse({
      run_id: createClientRunId(),
      workspace_id: auth.workspaceId,
      symbol: fixedWorkspaceSymbol ?? normalizedSymbol,
      asset_class: "crypto",
      market_type: marketType,
      analysis_date: analysisDate,
      analysts,
      config_profile: profile,
      output_language: outputLanguage,
    });
  }

  async function createResearchRunWithFreshHealth(
    request: CreateResearchRunRequest,
  ) {
    if (!(await refetchApiReady())) {
      throw new Error("Backend is starting. Launch will unlock when API is ready.");
    }

    try {
      return await createResearchRun(request, auth);
    } catch (error) {
      if (!isTransientLaunchError(error) || !(await refetchApiReady())) {
        throw error;
      }
      return createResearchRun(request, auth);
    }
  }

  async function refetchApiReady(): Promise<boolean> {
    const health = await apiHealth.refetch();
    return health.data?.status === "ok";
  }

  useEffect(() => {
    if (!launchRetryReady || !mutation.isError || !apiReady) {
      return;
    }
    const timer = window.setTimeout(() => {
      mutation.reset();
      setLaunchRetryReady(false);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [apiReady, launchRetryReady, mutation]);

  function toggleAnalyst(value: string) {
    setAnalysts((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending || !apiReady || disabledReason) {
      return;
    }
    setConfirmOpen(true);
  }

  function approveLaunch() {
    if (mutation.isPending || !apiReady || disabledReason) {
      return;
    }
    mutation.mutate(buildLaunchRequest());
  }

  return (
    <main className="page research-launch-page">
      <form className="research-launch-form" onSubmit={submit}>
        <BentoGrid className="research-launch-grid">
          <Panel
            className="span-7 emphasis launch-target-panel"
            title="Research target"
            description="Start with the workspace instrument and the market lens."
          >
              <div className="launch-target-stack">
                <div className="launch-workspace-target">
                  <span>Workspace target</span>
                  <strong>
                    {fixedWorkspaceSymbol ??
                      (legacyMixedWorkspace ? "Legacy mixed" : normalizedSymbol || "No symbol")}
                  </strong>
                  <small>
                    {fixedWorkspaceSymbol
                      ? auth.workspace?.name ?? "Fixed-symbol workspace"
                      : legacyMixedWorkspace
                        ? "Create or switch to a fixed-symbol workspace."
                        : "Workspace metadata will lock this symbol after creation."}
                  </small>
                </div>

                {!fixedWorkspaceSymbol && !legacyMixedWorkspace ? (
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
                ) : null}

                <div className="launch-choice-grid" aria-label="Market type">
                  {marketOptions.map((option) => (
                    <button
                      aria-pressed={true}
                      className={`launch-choice-card${marketType === option.value ? " active" : ""}`}
                      key={option.value}
                      type="button"
                      disabled
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

                <label className="label launch-language-field">
                  Output language
                  <select
                    className="input"
                    value={outputLanguage}
                    onChange={(event) => setOutputLanguage(event.target.value)}
                  >
                    {languageOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </Panel>

          <Panel
            className="span-5 launch-analyst-panel"
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
                        <analyst.Icon size={23} strokeWidth={1.8} />
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
                    {launchRetryReady
                      ? "Launch failed while the API was restarting. API is ready; retry launch."
                      : errorMessage(mutation.error)}
                  </div>
                ) : null}
                <button
                  className="button primary launch-submit-button"
                  disabled={
                    mutation.isPending || !apiReady || Boolean(disabledReason)
                  }
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
      {confirmOpen ? (
        <div
          className="launch-confirm-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setConfirmOpen(false);
            }
          }}
        >
          <section
            aria-label="Run preview"
            aria-modal="true"
            className="launch-confirm-dialog"
            role="dialog"
          >
            <div className="launch-confirm-header">
              <div>
                <h2>Run preview</h2>
                <p>Verify the job inputs one more time before the API creates a run.</p>
              </div>
              <span className="badge primary">second check</span>
            </div>

            <div className="launch-confirm-target">
              <span>Target</span>
              <strong>{effectiveSymbol || "No symbol"}</strong>
            </div>

            <div className="launch-confirm-grid">
              <div>
                <span>Workspace</span>
                <strong>{auth.workspace?.name ?? auth.workspaceId}</strong>
              </div>
              <div>
                <span>Market</span>
                <strong>{marketType}</strong>
              </div>
              <div>
                <span>Date</span>
                <strong>{analysisDate}</strong>
              </div>
              <div>
                <span>Analysts</span>
                <strong>{selectedAnalystLabels.join(" / ")}</strong>
              </div>
              <div>
                <span>Profile</span>
                <strong>{profile}</strong>
              </div>
              <div>
                <span>Output language</span>
                <strong>{outputLanguage}</strong>
              </div>
              <div>
                <span>Boundary</span>
                <strong>research-only</strong>
              </div>
            </div>

            <div className="launch-confirm-checks">
              <PreflightItem
                ready={!legacyMixedWorkspace && Boolean(effectiveSymbol)}
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

            <div className="launch-confirm-actions">
              <button
                className="button ghost"
                onClick={() => setConfirmOpen(false)}
                type="button"
              >
                Decline
              </button>
              <button
                className="button primary"
                disabled={mutation.isPending || !apiReady || Boolean(disabledReason)}
                onClick={approveLaunch}
                type="button"
              >
                <CheckCircle2 aria-hidden size={16} />
                {mutation.isPending ? "Submitting" : "Accept"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
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

function isTransientLaunchError(error: unknown): boolean {
  if (!isApiError(error)) {
    return false;
  }
  if (error.code === "network_error") {
    return true;
  }
  if (error.status >= 500 && error.status <= 504) {
    return true;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("internal server error") ||
    message.includes("network error") ||
    message.includes("failed to fetch") ||
    message.includes("timeout")
  );
}

function createClientRunId(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `run_${uuid.replaceAll("-", "")}`;
}
