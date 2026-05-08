"""Show persisted observability / lifecycle rows from the local journal DB.

Does not run the graph — reads SQLite only.

Examples::

    python scripts/show_latest_journal_timeline.py
    python scripts/show_latest_journal_timeline.py --run-id run_a1b2c3
    python scripts/show_latest_journal_timeline.py --limit 30

When using CLI helpers instead::

    pip install -e .
    python -m cli.main journal list
    python -m cli.main journal timeline <run_id>

Journal path defaults to ``TRADINGAGENTS_JOURNAL_DB`` or
``DEFAULT_CONFIG["journal"]["db_path"]``.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Allow `python scripts/show_latest_journal_timeline.py` without editable install.
_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.services.journal_service import JournalService, resolve_journal_db_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--run-id",
        help="Research run id; defaults to the most recently started run.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=40,
        help="Maximum timeline rows to print.",
    )
    args = parser.parse_args()

    path = resolve_journal_db_path(DEFAULT_CONFIG)
    print(f"journal_db={path}")

    journal = JournalService(DEFAULT_CONFIG)
    run_id = args.run_id
    if not run_id:
        runs = journal.list_research_runs(limit=1)
        if not runs:
            print("No research runs in this journal.")
            return
        run_id = runs[0].id
        print(f"latest_run_id={run_id} symbol={runs[0].symbol} timeframe={runs[0].timeframe}")

    events = journal.list_timeline_events(research_run_id=run_id, limit=args.limit)
    if not events:
        print(f"No timeline events for run_id={run_id}.")
        return

    for ev in events:
        raw_payload = json.dumps(ev.payload, ensure_ascii=False, sort_keys=True)
        preview = raw_payload[:160]
        suffix = "…" if len(raw_payload) > 160 else ""
        print(f"{ev.created_at.isoformat()}  {ev.event_type}")
        print(f"    msg: {ev.message}")
        print(f"    payload: {preview}{suffix}")
        print()


if __name__ == "__main__":
    main()
