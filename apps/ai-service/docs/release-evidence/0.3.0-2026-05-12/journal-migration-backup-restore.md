# Journal Migration, Backup, And Restore Evidence
Date: 2026-05-11T19:47:33.726430+00:00
Source DB: C:\Users\dell\.luna_workstation\cache\research_journal.sqlite
Runtime DB copies are outside the repo: C:\Users\dell\TradingAgents-release-evidence-runtime\0.3.0-2026-05-12\journal-clean
Source exists: True
Source SHA256 before: 2F5A1FBC6B69388945DE1F97BFA9BFA1A0E2C399FA5F0AC9DCE351522FAFF98E
Migration copy SHA256 before: 2F5A1FBC6B69388945DE1F97BFA9BFA1A0E2C399FA5F0AC9DCE351522FAFF98E

## Migrate copied journal
Command: python -m cli.main journal migrate
Exit code: 0
```text
Journal migrated: 
C:\Users\dell\TradingAgents-release-evidence-runtime\0.3.0-2026-05-12\journal-c
lean\migration-copy.sqlite
C:\Users\dell\TradingAgents\.venv\Lib\site-packages\langgraph\checkpoint\serde\encrypted.py:5: LangChainPendingDeprecationWarning: The default value of `allowed_objects` will change in a future version. Pass an explicit value (e.g., allowed_objects='messages' or allowed_objects='core') to suppress this warning.
  from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
```
Migration copy SHA256 after: 0DE9A949392FCD42CA8938174B98DF7FE3203C01820D4C8C75FDBB2E5474BDE8
Source SHA256 after migration-on-copy: 2F5A1FBC6B69388945DE1F97BFA9BFA1A0E2C399FA5F0AC9DCE351522FAFF98E

## Schema check on migrated copy
DB: C:\Users\dell\TradingAgents-release-evidence-runtime\0.3.0-2026-05-12\journal-clean\migration-copy.sqlite
```text
user_version 2
integrity_check ok
table_count 17
index_count 54
research_runs_columns id,symbol,asset_class,timeframe,status,started_at,completed_at,market_snapshot_id,signal_snapshot_id,debate_id,thesis_id,user_decision_id,outcome_review_id,payload_json,deep_think_model,quick_think_model,llm_provider,config_hash
```
Exit code: 0

## Journal list on migrated copy
Command: python -m cli.main journal list --limit 3
Exit code: 0
```text
                                 Research Runs                                 
┌────────────────┬───────────────┬───────────┬────────────────┬───────────────┐
│ ID             │ Symbol        │ Status    │ Started        │ Thesis        │
├────────────────┼───────────────┼───────────┼────────────────┼───────────────┤
│ run_3837db807b │ ETH/USDT:USDT │ completed │ 2026-05-09T16… │ thesis_cf227… │
│ 044f87a21350b6 │               │           │                │               │
│ 25a2b374       │               │           │                │               │
└────────────────┴───────────────┴───────────┴────────────────┴───────────────┘
C:\Users\dell\TradingAgents\.venv\Lib\site-packages\langgraph\checkpoint\serde\encrypted.py:5: LangChainPendingDeprecationWarning: The default value of `allowed_objects` will change in a future version. Pass an explicit value (e.g., allowed_objects='messages' or allowed_objects='core') to suppress this warning.
  from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
```

## Timeline on migrated copy
Command: python scripts/show_latest_journal_timeline.py --limit 3
Exit code: 0
```text
journal_db=C:\Users\dell\TradingAgents-release-evidence-runtime\0.3.0-2026-05-12\journal-clean\migration-copy.sqlite
latest_run_id=run_3837db807b044f87a21350b625a2b374 symbol=ETH/USDT:USDT timeframe=2026-05-07
2026-05-09T16:07:01.031515+00:00  run.started
    msg: Research run started (ETH/USDT:USDT)
    payload: {"asset_class": "crypto", "checkpoint_enabled": false, "deep_think_llm": "deepseek-v4-pro", "event": "research_run_started", "llm_provider": "deepseek", "quick_…

2026-05-09T16:07:04.568795+00:00  provider.call
    msg: Data provider get_crypto_ohlcv [ccxt] success
    payload: {"asset_class": "crypto", "category": "crypto_ohlcv", "duration_ms": 3533.74, "event": "data_provider_call", "method": "get_crypto_ohlcv", "run_id": "run_3837db…

2026-05-09T16:07:04.710929+00:00  provider.call
    msg: Data provider get_crypto_funding_rate_history [ccxt] success
    payload: {"asset_class": "crypto", "category": "crypto_onchain", "duration_ms": 132.53, "event": "data_provider_call", "method": "get_crypto_funding_rate_history", "run_…

```

## Restore copy
Restore DB: C:\Users\dell\TradingAgents-release-evidence-runtime\0.3.0-2026-05-12\journal-clean\restore-copy.sqlite
Restore SHA256: E6BEC4C5ECBD8EAEE76F587E99A80EF9AA559F7798C4F43C6948D33A46E3FC56

## Journal list on restored copy
Command: python -m cli.main journal list --limit 3
Exit code: 0
```text
                                 Research Runs                                 
┌────────────────┬───────────────┬───────────┬────────────────┬───────────────┐
│ ID             │ Symbol        │ Status    │ Started        │ Thesis        │
├────────────────┼───────────────┼───────────┼────────────────┼───────────────┤
│ run_3837db807b │ ETH/USDT:USDT │ completed │ 2026-05-09T16… │ thesis_cf227… │
│ 044f87a21350b6 │               │           │                │               │
│ 25a2b374       │               │           │                │               │
└────────────────┴───────────────┴───────────┴────────────────┴───────────────┘
C:\Users\dell\TradingAgents\.venv\Lib\site-packages\langgraph\checkpoint\serde\encrypted.py:5: LangChainPendingDeprecationWarning: The default value of `allowed_objects` will change in a future version. Pass an explicit value (e.g., allowed_objects='messages' or allowed_objects='core') to suppress this warning.
  from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
```

## Schema check on restored copy
DB: C:\Users\dell\TradingAgents-release-evidence-runtime\0.3.0-2026-05-12\journal-clean\restore-copy.sqlite
```text
user_version 2
integrity_check ok
table_count 17
index_count 54
research_runs_columns id,symbol,asset_class,timeframe,status,started_at,completed_at,market_snapshot_id,signal_snapshot_id,debate_id,thesis_id,user_decision_id,outcome_review_id,payload_json,deep_think_model,quick_think_model,llm_provider,config_hash
```
Exit code: 0

## Exit Summary
migrate=0 schema=0 list=0 timeline=0 restore_list=0 restore_schema=0
