# AI Output Language Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a careful end-to-end language override for AI-generated research output, from web launch form through API job contract into `apps/ai-service` runtime config.

**Architecture:** `apps/ai-service` remains the source of truth for language defaults through `output_language` in `config/default.toml`, `DEFAULT_CONFIG`, env overrides, and prompt injection. The API and web add only a per-run optional override named `output_language`; no UI-wide i18n framework is introduced in this phase. The engine persists the chosen language in run events for traceability while preserving existing behavior when no language is supplied.

**Tech Stack:** Python 3.11+, Pydantic, pytest, NestJS, class-validator, Node test runner, React, Zod, pnpm workspace, Turbo.

---

## Scope

This plan covers AI output language only:

- Analyst reports and final manager decision can be generated in the selected language.
- Internal reasoning/debate behavior remains unchanged; current `get_language_instruction(config)` already avoids adding language tokens for English.
- Existing default remains `English`.
- The first UI choices are `English` and `Vietnamese`; backend accepts any non-blank language string so existing CLI custom-language behavior stays compatible.

This plan does not add full web interface translation, date/number localization, translated navigation labels, user language preferences, or database migrations.

## File Structure

- Modify `apps/ai-service/luna_workstation/engine/schemas.py`
  - Add optional `output_language` to the stable Python engine request contract.
  - Validate that supplied language strings are non-blank after trimming.

- Modify `apps/ai-service/luna_workstation/engine/runner.py`
  - Thread `request.output_language` into `ConfigLoader.load(... cli_overrides=...)`.
  - Add `output_language` to started/completed event payloads so runs are auditable.

- Modify `apps/ai-service/tests/test_engine_contract.py`
  - Prove request validation accepts `Vietnamese`.
  - Prove `_load_config()` applies the override.
  - Prove dry-run event payloads record the chosen language.

- Modify `apps/api/src/database/journal.types.ts`
  - Add optional `output_language` to the worker-facing TypeScript `EngineRunRequest`.

- Modify `apps/api/src/research-runs/dto/create-research-run.dto.ts`
  - Accept optional non-blank `output_language`.

- Modify `apps/api/src/research-runs/research-runs.service.ts`
  - Forward the DTO language to the engine request.
  - Include language in active job event payloads for queue-state visibility.

- Modify `apps/api/src/contracts/openapi.generated.ts`
  - Add `output_language` to `EngineRunRequest` and `CreateResearchRunRequest` schemas.
  - This repo currently keeps the generated contract checked in; update it consistently with the DTO and frontend client.

- Modify `apps/api/test/api-contract.test.ts`
  - Validate whitelist behavior accepts `output_language`.
  - Validate `ResearchRunsService.create()` enqueues a request with the same language.

- Modify `apps/web/src/schemas/research-run.ts`
  - Add optional `output_language` validation.

- Modify `apps/web/src/pages/ResearchRunFormPage.tsx`
  - Add an output language selector to the launch form.
  - Include the chosen language in the create request and confirmation preview.

- Modify `apps/web/src/services/generated/api-client.ts`
  - Add `output_language` to generated client request types to keep TypeScript aligned with OpenAPI.

- Modify `apps/web/test/research-run-form-page.test.ts`
  - Source-inspection tests confirm the form sends the selected language and shows it in the preview.

- Modify `apps/ai-service/config/local.example.toml`
  - Document a local Vietnamese override.

- Modify `apps/ai-service/README.md`
  - Add a short operator note for default env/config language and per-run override behavior.

---

### Task 1: Python Engine Contract And Config Override

**Files:**
- Modify: `apps/ai-service/tests/test_engine_contract.py`
- Modify: `apps/ai-service/luna_workstation/engine/schemas.py`
- Modify: `apps/ai-service/luna_workstation/engine/runner.py`

- [ ] **Step 1: Write failing tests for Python engine language handling**

Add these tests near the other `EngineRunRequest` tests in `apps/ai-service/tests/test_engine_contract.py`:

```python
def test_engine_request_accepts_output_language_override():
    request = EngineRunRequest.model_validate(
        {
            "run_id": "run_language_contract",
            "workspace_id": "workspace_1",
            "symbol": "BTC/USDT",
            "asset_class": "crypto",
            "analysis_date": "2026-05-12",
            "analysts": ["market"],
            "output_language": " Vietnamese ",
        }
    )

    assert request.output_language == "Vietnamese"


def test_engine_request_rejects_blank_output_language():
    try:
        EngineRunRequest.model_validate(
            {
                "run_id": "run_blank_language",
                "workspace_id": "workspace_1",
                "symbol": "BTC/USDT",
                "asset_class": "crypto",
                "analysis_date": "2026-05-12",
                "analysts": ["market"],
                "output_language": "   ",
            }
        )
    except ValueError as exc:
        assert "output_language must not be blank" in str(exc)
    else:
        raise AssertionError("blank output_language should fail validation")


def test_engine_runner_maps_output_language_to_config_overrides():
    loader = _CapturingConfigLoader()
    request = EngineRunRequest.model_validate(
        {
            "run_id": "run_language_override",
            "workspace_id": "workspace_1",
            "symbol": "BTC/USDT",
            "asset_class": "crypto",
            "analysis_date": "2026-05-12",
            "analysts": ["market"],
            "output_language": "Vietnamese",
        }
    )

    config = EngineRunner(config_loader=loader)._load_config(request)

    assert config["output_language"] == "Vietnamese"
    assert config["_engine"]["output_language"] == "Vietnamese"
```

Extend `test_engine_runner_dry_run_persists_contract_events` request payload with:

```python
"output_language": "Vietnamese",
```

Then extend the event assertions in the same test:

```python
assert events[0].payload["output_language"] == "Vietnamese"
assert events[1].payload["output_language"] == "Vietnamese"
```

- [ ] **Step 2: Run Python contract tests and confirm they fail for the expected reason**

Run:

```bash
pnpm --filter @lunaperception/ai-service test -- tests/test_engine_contract.py -q
```

Expected before implementation:

```text
FAILED tests/test_engine_contract.py::test_engine_request_accepts_output_language_override
FAILED tests/test_engine_contract.py::test_engine_runner_maps_output_language_to_config_overrides
```

The failure should mention missing `output_language` attribute or missing `output_language` key.

- [ ] **Step 3: Add `output_language` to the Python engine schema**

In `apps/ai-service/luna_workstation/engine/schemas.py`, update `EngineRunRequest`:

```python
class EngineRunRequest(BaseModel):
    """Stable JSON request accepted by ``lunacrypto engine run``."""

    run_id: str | None = None
    workspace_id: str
    symbol: str
    asset_class: str = "crypto"
    market_type: str = "spot"
    analysis_date: date
    analysts: list[str] = Field(default_factory=lambda: ["market", "news"])
    config_profile: str | None = "default"
    exchange: str | None = None
    output_language: str | None = None
    dry_run: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)
```

Add this validator below `_not_blank`:

```python
    @field_validator("output_language")
    @classmethod
    def _output_language_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        if not clean:
            raise ValueError("output_language must not be blank")
        return clean
```

- [ ] **Step 4: Thread `output_language` into engine config and events**

In `apps/ai-service/luna_workstation/engine/runner.py`, update `_load_config()` after `overrides` is created:

```python
        if request.output_language:
            overrides["output_language"] = request.output_language
            overrides["_engine"]["output_language"] = request.output_language
```

In `_start_run()`, add this payload field to the `journal.add_run_event(..., "run.started", ...)` payload:

```python
                "output_language": request.output_language,
```

In `_complete_dry_run()`, add this payload field to the dry-run completion payload:

```python
                "output_language": request.output_language,
```

In the successful non-dry-run completion event payload, add:

```python
                    "output_language": request.output_language,
```

Do not change prompt logic in this task; `get_language_instruction(config=config)` already consumes `config["output_language"]`.

- [ ] **Step 5: Run Python tests and verify pass**

Run:

```bash
pnpm --filter @lunaperception/ai-service test -- tests/test_engine_contract.py -q
```

Expected:

```text
passed
```

- [ ] **Step 6: Commit Python contract changes**

Run:

```bash
git add apps/ai-service/tests/test_engine_contract.py apps/ai-service/luna_workstation/engine/schemas.py apps/ai-service/luna_workstation/engine/runner.py
git commit -m "feat(ai-service): accept per-run output language"
```

---

### Task 2: API DTO, Job Request, And OpenAPI Contract

**Files:**
- Modify: `apps/api/test/api-contract.test.ts`
- Modify: `apps/api/src/database/journal.types.ts`
- Modify: `apps/api/src/research-runs/dto/create-research-run.dto.ts`
- Modify: `apps/api/src/research-runs/research-runs.service.ts`
- Modify: `apps/api/src/contracts/openapi.generated.ts`

- [ ] **Step 1: Write failing API contract tests**

In `apps/api/test/api-contract.test.ts`, add this test near the existing create-research-run DTO validation tests:

```ts
test('create research run dto accepts optional output language', async () => {
  const dto = await validateCreateResearchRun({
    workspace_id: 'workspace_a',
    symbol: 'BTC/USDT',
    analysis_date: '2026-05-12',
    analysts: ['market'],
    output_language: 'Vietnamese',
  });

  assert.equal(dto.output_language, 'Vietnamese');
});
```

Add this service-level test near other `ResearchRunsService.create()` tests:

```ts
test('research run creation forwards output language to engine request', async () => {
  const { jobs, researchRuns } = buildHarness();

  const response = await researchRuns.create(
    {
      workspace_id: 'workspace_a',
      symbol: 'BTC/USDT',
      analysis_date: '2026-05-12',
      analysts: ['market'],
      output_language: 'Vietnamese',
    },
    'user_1',
    'workspace_a',
  );
  const request = await jobs.getJobRequest(response.job_id);

  assert.equal(request?.output_language, 'Vietnamese');
});
```

Add this OpenAPI assertion near the existing OpenAPI contract assertions:

```ts
test('openapi create research run schema exposes output language', () => {
  const schema = openApiDocument.components.schemas.CreateResearchRunRequest;

  assert.equal(
    schema.properties.output_language.type,
    'string',
  );
  assert.equal(
    schema.properties.output_language.minLength,
    1,
  );
});
```

- [ ] **Step 2: Run API tests and confirm expected failures**

Run:

```bash
pnpm --filter @lunaperception/api test
```

Expected before implementation:

```text
FAIL create research run dto accepts optional output language
FAIL research run creation forwards output language to engine request
FAIL openapi create research run schema exposes output language
```

The first failure should come from `forbidNonWhitelisted`; the second should show `output_language` missing from the enqueued request.

- [ ] **Step 3: Add `output_language` to API request types**

In `apps/api/src/database/journal.types.ts`, update `EngineRunRequest`:

```ts
export interface EngineRunRequest {
  run_id: string;
  workspace_id: string;
  symbol: string;
  asset_class: string;
  market_type: 'spot' | 'perp';
  analysis_date: string;
  analysts: string[];
  config_profile: string;
  exchange?: string | null;
  output_language?: string | null;
  dry_run: boolean;
  metadata: JsonRecord;
}
```

- [ ] **Step 4: Add DTO validation**

In `apps/api/src/research-runs/dto/create-research-run.dto.ts`, add the field after `exchange?: string;`:

```ts
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Matches(/\S/, { message: 'output_language must not be blank' })
  output_language?: string;
```

- [ ] **Step 5: Forward language in `ResearchRunsService.create()`**

In `apps/api/src/research-runs/research-runs.service.ts`, add this field to the `request: EngineRunRequest` object:

```ts
        output_language: normalizeOptional(dto.output_language) ?? null,
```

In `jobEvents()`, add this field to `basePayload`:

```ts
    output_language: request.output_language ?? null,
```

- [ ] **Step 6: Update checked-in OpenAPI schema**

In `apps/api/src/contracts/openapi.generated.ts`, update `EngineRunRequest.properties` and `CreateResearchRunRequest.properties` with:

```ts
          output_language: { type: 'string', minLength: 1 },
```

Do not add `output_language` to either schema's `required` array.

- [ ] **Step 7: Run API tests and verify pass**

Run:

```bash
pnpm --filter @lunaperception/api test
```

Expected:

```text
pass
```

- [ ] **Step 8: Commit API contract changes**

Run:

```bash
git add apps/api/test/api-contract.test.ts apps/api/src/database/journal.types.ts apps/api/src/research-runs/dto/create-research-run.dto.ts apps/api/src/research-runs/research-runs.service.ts apps/api/src/contracts/openapi.generated.ts
git commit -m "feat(api): forward output language to research engine"
```

---

### Task 3: Web Request Schema, Client Type, And Launch Form

**Files:**
- Modify: `apps/web/test/research-run-form-page.test.ts`
- Modify: `apps/web/src/schemas/research-run.ts`
- Modify: `apps/web/src/services/generated/api-client.ts`
- Modify: `apps/web/src/pages/ResearchRunFormPage.tsx`

- [ ] **Step 1: Write failing web source-inspection tests**

Add this test to `apps/web/test/research-run-form-page.test.ts`:

```ts
test('research run form sends the selected output language', () => {
  const source = readFileSync(
    new URL('../src/pages/ResearchRunFormPage.tsx', import.meta.url),
    'utf8',
  );
  const schemaSource = readFileSync(
    new URL('../src/schemas/research-run.ts', import.meta.url),
    'utf8',
  );
  const clientSource = readFileSync(
    new URL('../src/services/generated/api-client.ts', import.meta.url),
    'utf8',
  );

  assert.equal(source.includes('languageOptions'), true);
  assert.equal(source.includes('const [outputLanguage, setOutputLanguage]'), true);
  assert.equal(source.includes('output_language: outputLanguage'), true);
  assert.equal(source.includes('<span>Output language</span>'), true);
  assert.equal(schemaSource.includes('output_language'), true);
  assert.equal(clientSource.includes('output_language?: string | null'), true);
});
```

- [ ] **Step 2: Run web tests and confirm expected failure**

Run:

```bash
pnpm --filter @lunaperception/web test
```

Expected before implementation:

```text
FAIL research run form sends the selected output language
```

- [ ] **Step 3: Add schema validation**

In `apps/web/src/schemas/research-run.ts`, add the field after `exchange`:

```ts
  output_language: z.string().trim().min(1).optional(),
```

- [ ] **Step 4: Update generated API client types**

In `apps/web/src/services/generated/api-client.ts`, update both request shapes.

For `EngineRunRequest`, add:

```ts
  output_language?: string | null;
```

For `CreateResearchRunRequest`, add:

```ts
  output_language?: string | null;
```

- [ ] **Step 5: Add language options and state to the form**

In `apps/web/src/pages/ResearchRunFormPage.tsx`, add this constant after `analystOptions`:

```tsx
const languageOptions = [
  { value: "English", label: "English" },
  { value: "Vietnamese", label: "Vietnamese" },
];
```

Inside `ResearchRunFormPage()`, add state after `profile`:

```tsx
  const [outputLanguage, setOutputLanguage] = useState("English");
```

- [ ] **Step 6: Include language in create request**

In the `researchRunRequestSchema.parse({ ... })` object, add:

```tsx
          output_language: outputLanguage,
```

- [ ] **Step 7: Add a compact language selector**

In the first `Panel` after the analysis-date label, add:

```tsx
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
```

This uses existing `label` and `input` classes so no new CSS is required.

- [ ] **Step 8: Show language in launch preview**

In the confirmation grid, add this item after `Profile`:

```tsx
              <div>
                <span>Output language</span>
                <strong>{outputLanguage}</strong>
              </div>
```

- [ ] **Step 9: Run web tests and typecheck**

Run:

```bash
pnpm --filter @lunaperception/web test
pnpm --filter @lunaperception/web typecheck
```

Expected:

```text
pass
```

- [ ] **Step 10: Commit web changes**

Run:

```bash
git add apps/web/test/research-run-form-page.test.ts apps/web/src/schemas/research-run.ts apps/web/src/services/generated/api-client.ts apps/web/src/pages/ResearchRunFormPage.tsx
git commit -m "feat(web): choose research output language"
```

---

### Task 4: Config And Operator Documentation

**Files:**
- Modify: `apps/ai-service/config/local.example.toml`
- Modify: `apps/ai-service/README.md`

- [ ] **Step 1: Add local config example**

In `apps/ai-service/config/local.example.toml`, add this near the existing runtime defaults before the first TOML section:

```toml
# Optional report language override for all local CLI/engine runs.
# Per-run API requests can still override this value.
# output_language = "Vietnamese"
```

- [ ] **Step 2: Add README operator note**

In `apps/ai-service/README.md`, add this section near existing configuration guidance:

```markdown
### Output Language

The AI service default output language is configured with `output_language` in
`config/default.toml` and can be overridden locally in `config/local.toml`:

```toml
output_language = "Vietnamese"
```

Operators can also set `TRADINGAGENTS_OUTPUT_LANGUAGE=Vietnamese`.
The web/API research launch flow may send a per-run `output_language`; that
request-level value takes precedence over default and local config. Internal
agent debate remains English to preserve reasoning quality, while analyst
reports and final decision output use the selected language.
```

- [ ] **Step 3: Commit docs/config notes**

Run:

```bash
git add apps/ai-service/config/local.example.toml apps/ai-service/README.md
git commit -m "docs(ai-service): document output language configuration"
```

---

### Task 5: End-To-End Verification

**Files:**
- No new files.
- Verify all modified areas.

- [ ] **Step 1: Run focused test suites**

Run:

```bash
pnpm --filter @lunaperception/ai-service test -- tests/test_engine_contract.py -q
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web test
pnpm --filter @lunaperception/web typecheck
```

Expected:

```text
pass
```

- [ ] **Step 2: Run repository-level checks**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected:

```text
pass
```

If `pnpm test` is too slow for the active machine, keep the focused suite results and record that full-suite execution was deferred with the exact failing or timed-out command output.

- [ ] **Step 3: Manual dry-run contract check**

Create a temporary request file under `apps/ai-service`:

```json
{
  "run_id": "run_language_manual_check",
  "workspace_id": "workspace_manual",
  "symbol": "BTC/USDT",
  "asset_class": "crypto",
  "market_type": "spot",
  "analysis_date": "2026-05-12",
  "analysts": ["market"],
  "config_profile": "default",
  "output_language": "Vietnamese",
  "dry_run": true,
  "metadata": {
    "source": "manual-language-check"
  }
}
```

Run:

```bash
cd apps/ai-service
node scripts/python.cjs -m cli.main engine run --request ./.codex-language-check.json
```

Expected JSON includes:

```json
{
  "run_id": "run_language_manual_check",
  "workspace_id": "workspace_manual",
  "status": "completed"
}
```

Remove the temporary file after the check:

```bash
Remove-Item -LiteralPath apps/ai-service/.codex-language-check.json
```

- [ ] **Step 4: Review diff for scope control**

Run:

```bash
git diff --stat
git diff -- apps/ai-service apps/api apps/web
```

Expected:

```text
Only files listed in this plan changed.
No unrelated formatting churn.
No secrets or concrete API keys added.
No full web i18n framework introduced.
```

- [ ] **Step 5: Final commit if previous task commits were skipped**

If execution did not commit per task, commit all scoped changes:

```bash
git add apps/ai-service apps/api apps/web
git commit -m "feat: integrate research output language"
```

---

## Risk Notes

- The safest default is unchanged: no request language means `English`.
- The API should not translate or normalize custom language names beyond trimming and blank rejection; the AI prompt layer expects a human-readable language name.
- This feature changes generated text behavior only. It does not localize UI labels, timezones, validation errors, or persisted historical reports.
- `output_language` should not be stored in secrets or env-only config because per-run selection is user-facing and non-sensitive.
- If report quality drops in non-English output, add a future evaluator test around `get_language_instruction()` and prompt contracts rather than expanding this plan.

## Self-Review

Spec coverage:

- User wanted language integration with careful root config: covered by keeping `ai-service` default config as source of truth and adding request override.
- User mentioned AI service: covered by Python engine schema, config loader override, and event traceability.
- User mentioned Nx: repo inspection showed Turbo/pnpm, so the plan avoids inventing Nx config.
- User asked not to do superficial work: covered by contract tests at Python, API, and web layers plus full verification.

Placeholder scan:

- No task depends on an unspecified file.
- No task says to add generic validation without exact code.
- No task requires an undefined helper.

Type consistency:

- Field name is `output_language` in Python, API request JSON, OpenAPI, generated web client, and Zod schema.
- UI state is `outputLanguage` and maps explicitly to request `output_language`.
- Default value is `English`; per-run example is `Vietnamese`.

