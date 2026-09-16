"""Machine-only command entrypoint for the Python engine contract."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from luna_workstation import engine
from luna_workstation.engine.market_validation import validate_market_data


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return int(args.handler(args) or 0)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m luna_workstation.engine",
        description="Machine-only LunaCrypto Python engine contract.",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    run = subcommands.add_parser("run", help="Run a structured engine request.")
    run.add_argument("--request", "-r", type=Path, required=True)
    run.set_defaults(handler=_run)

    evaluate = subcommands.add_parser(
        "evaluate",
        help="Evaluate one thesis from a structured request.",
    )
    evaluate.add_argument("--request", "-r", type=Path, required=True)
    evaluate.set_defaults(handler=_evaluate)

    schema = subcommands.add_parser("schema", help="Emit JSON schemas.")
    schema.set_defaults(handler=_schema)

    validate_market = subcommands.add_parser(
        "validate-market",
        help="Validate market data availability before queuing research.",
    )
    validate_market.add_argument("--symbol", required=True)
    validate_market.add_argument("--analysis-date", required=True)
    validate_market.add_argument("--asset-class", default="crypto")
    validate_market.add_argument("--market-type", default="perp")
    validate_market.add_argument("--exchange")
    validate_market.add_argument("--profile")
    validate_market.set_defaults(handler=_validate_market)

    return parser


def _run(args: argparse.Namespace) -> int:
    result = engine.run_engine_request_file(args.request)
    _print_json(result.model_dump(mode="json"))
    return 0 if result.status in {"completed", "completed_degraded"} else 1


def _evaluate(args: argparse.Namespace) -> int:
    result = engine.run_evaluate_request_file(args.request)
    _print_json(result.model_dump(mode="json"))
    return 1 if result.error_type else 0


def _schema(_args: argparse.Namespace) -> int:
    _print_json(
        {
            "request": engine.EngineRunRequest.model_json_schema(),
            "result": engine.EngineRunResult.model_json_schema(),
            "evaluate_request": engine.EngineEvaluateRequest.model_json_schema(),
            "evaluate_result": engine.EngineEvaluateResult.model_json_schema(),
        }
    )
    return 0


def _validate_market(args: argparse.Namespace) -> int:
    _print_json(
        validate_market_data(
            symbol=args.symbol,
            analysis_date=args.analysis_date,
            asset_class=args.asset_class,
            market_type=args.market_type,
            exchange=args.exchange,
            profile=args.profile,
        )
    )
    return 0


def _print_json(data: object) -> None:
    print(json.dumps(data, ensure_ascii=False))


__all__ = ["main"]
