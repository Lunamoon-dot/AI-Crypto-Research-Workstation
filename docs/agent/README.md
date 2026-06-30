# Agent Workflow Overview

Folder nay mo ta tung agent/node trong LunaCrypto research workflow: no nhan input gi, lam gi, output gi, guardrails nao dang duoc enforce, va code nam o dau.

## Workflow thu tu

1. Parallel analyst fan-out:
   - Market Analyst
   - Social Analyst
   - News Analyst
   - Onchain Analyst
2. Investment debate:
   - Bull Researcher
   - Bear Researcher
   - Research Manager
3. Setup planning:
   - Setup Planner
   - Spot Checks
   - Perp Checks
4. Risk debate:
   - Aggressive Analyst
   - Conservative Analyst
   - Neutral Analyst
5. Final decision and derived artifacts:
   - Portfolio Manager
   - Scenario Planner (short/mid/long horizon map)
   - Trade Thesis

`Trade Thesis` khong phai agent LLM rieng trong `agents/`; no la builder trong graph, nhung UI hien thi nhu mot node nen van co file rieng.

## Common runtime behavior

Workflow duoc wire trong `apps/ai-service/luna_workstation/graph/setup.py`.

- Cac analyst duoc chon chay song song tu `START`.
- Sau khi tat ca selected analyst xong, bull/bear debate moi bat dau.
- Bull/Bear debate lap theo conditional logic den khi Research Manager duoc goi.
- Setup Planner chay sau Research Manager.
- Risk debate chay sau Setup Planner.
- Portfolio Manager chot final trade decision, emits `final_trade_summary_json`, candidate metadata, va optional `scenario_continuity_handoff`.
- Scenario Planner chay sau Portfolio Manager, tao mot plan gom 3 horizon (`short_term`, `mid_term`, `long_term`), va duoc cau hinh `fail_open=True`, tuc la loi scenario khong lam fail toan run.
- Trade Thesis duoc build trong run completion tu `final_state` sau khi graph ket thuc.
- Research Continuity prior memory chi di vao Scenario Planner qua `scenario_continuity_handoff` do Portfolio Manager viet; Scenario Planner khong dung raw `latest_continuity_context`.

## Common analyst behavior

Bon analyst dau tien dung chung helper `create_analyst` va `make_analyst_runner`.

- Moi analyst co tool loop rieng, toi da 6 vong tool-call.
- Report raw duoc ghi vao state key rieng, vi du `market_report`, `news_report`.
- Sau report, system tao them structured `AgentOpinion` bang `create_analyst_opinion_builder`.
- `AgentOpinion` chi duoc dung report vua tao lam evidence; prompt yeu cau khong invent facts ngoai report.
- Neu structured opinion fail, system fallback sang `opinion_from_text`.

## File map

- [market-analyst.md](market-analyst.md)
- [social-analyst.md](social-analyst.md)
- [news-analyst.md](news-analyst.md)
- [onchain-analyst.md](onchain-analyst.md)
- [bull-researcher.md](bull-researcher.md)
- [bear-researcher.md](bear-researcher.md)
- [research-manager.md](research-manager.md)
- [setup-planner.md](setup-planner.md)
- [spot-checks.md](spot-checks.md)
- [perp-checks.md](perp-checks.md)
- [aggressive-analyst.md](aggressive-analyst.md)
- [conservative-analyst.md](conservative-analyst.md)
- [neutral-analyst.md](neutral-analyst.md)
- [portfolio-manager.md](portfolio-manager.md)
- [scenario-planner.md](scenario-planner.md)
- [trade-thesis.md](trade-thesis.md)
