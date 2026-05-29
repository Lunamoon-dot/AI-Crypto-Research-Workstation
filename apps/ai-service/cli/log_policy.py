"""CLI log and report persistence policy.

The live TUI keeps raw model output in memory for display. Disk persistence is
stricter: use allowlisted record fields, cap persisted text, rotate append-only
logs, and require an explicit opt-in before saving raw LLM report sections.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
from typing import Any

from luna_workstation.observability import (
    redact_secrets,
    redact_tool_call_args,
)


DEFAULT_MESSAGE_PREVIEW_CHARS = 512
DEFAULT_REPORT_SECTION_CHARS = 20_000
DEFAULT_MAX_LOG_BYTES = 1_048_576
DEFAULT_MAX_ROTATED_LOGS = 3

_TRUE_VALUES = {"1", "true", "yes", "y", "on"}
_FALSE_VALUES = {"0", "false", "no", "n", "off"}
_RAW_OUTPUT_ENV_VARS = (
    "LUNACRYPTO_PERSIST_RAW_LLM_OUTPUT",
    "TRADINGAGENTS_PERSIST_RAW_LLM_OUTPUT",
)


@dataclass(frozen=True)
class CliPersistencePolicy:
    """Disk persistence limits for CLI run artifacts."""

    message_preview_chars: int = DEFAULT_MESSAGE_PREVIEW_CHARS
    max_report_section_chars: int = DEFAULT_REPORT_SECTION_CHARS
    max_log_bytes: int = DEFAULT_MAX_LOG_BYTES
    max_rotated_logs: int = DEFAULT_MAX_ROTATED_LOGS
    persist_raw_llm_output: bool = False

    @classmethod
    def from_config(
        cls, config: dict[str, Any] | None = None
    ) -> "CliPersistencePolicy":
        """Build policy from ``config["cli_logging"]`` plus env overrides."""
        raw_cfg = (config or {}).get("cli_logging", {})
        cfg = raw_cfg if isinstance(raw_cfg, dict) else {}

        raw_opt_in = cfg.get(
            "persist_raw_llm_output",
            cfg.get("raw_llm_output", False),
        )
        persist_raw = _coerce_bool(raw_opt_in, default=False)
        for env_name in _RAW_OUTPUT_ENV_VARS:
            if env_name in os.environ:
                persist_raw = _coerce_bool(
                    os.environ.get(env_name), default=persist_raw
                )
                break

        return cls(
            message_preview_chars=_positive_int(
                cfg.get("message_preview_chars"),
                DEFAULT_MESSAGE_PREVIEW_CHARS,
            ),
            max_report_section_chars=_positive_int(
                cfg.get("max_report_section_chars", cfg.get("report_section_chars")),
                DEFAULT_REPORT_SECTION_CHARS,
            ),
            max_log_bytes=_positive_int(
                cfg.get("max_log_bytes"),
                DEFAULT_MAX_LOG_BYTES,
            ),
            max_rotated_logs=_nonnegative_int(
                cfg.get("max_rotated_logs"),
                DEFAULT_MAX_ROTATED_LOGS,
            ),
            persist_raw_llm_output=persist_raw,
        )


def format_message_log_record(
    timestamp: str,
    message_type: Any,
    content: Any,
    *,
    policy: CliPersistencePolicy,
) -> str:
    """Return a JSONL message record with only allowlisted fields."""
    preview, truncated = _redacted_preview(content, policy.message_preview_chars)
    return _json_record(
        {
            "ts": str(timestamp),
            "event": "message",
            "message_type": _label(message_type),
            "content_preview": preview,
            "content_truncated": truncated,
        }
    )


def format_tool_call_log_record(
    timestamp: str,
    tool_name: Any,
    call_args: Any,
) -> str:
    """Return a JSONL tool-call record with raw args redacted by default."""
    if isinstance(call_args, dict):
        safe_args = redact_tool_call_args(kwargs=call_args)
    else:
        safe_args = redact_tool_call_args(args=(call_args,))

    return _json_record(
        {
            "ts": str(timestamp),
            "event": "tool_call",
            "tool_name": _label(tool_name),
            "tool_args": safe_args,
        }
    )


def write_log_line(path: Path, line: str, *, policy: CliPersistencePolicy) -> None:
    """Append one line to *path*, rotating before the configured size cap."""
    encoded_len = len((line + "\n").encode("utf-8"))
    if path.exists() and path.stat().st_size > 0:
        if path.stat().st_size + encoded_len > policy.max_log_bytes:
            rotate_log(path, max_rotated_logs=policy.max_rotated_logs)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def rotate_log(path: Path, *, max_rotated_logs: int) -> None:
    """Rotate ``path`` to ``path.1``, keeping at most *max_rotated_logs* files."""
    if max_rotated_logs <= 0:
        path.write_text("", encoding="utf-8")
        return

    oldest = _rotated_path(path, max_rotated_logs)
    if oldest.exists():
        oldest.unlink()

    for index in range(max_rotated_logs - 1, 0, -1):
        src = _rotated_path(path, index)
        if src.exists():
            src.replace(_rotated_path(path, index + 1))

    if path.exists():
        path.replace(_rotated_path(path, 1))


def report_section_filename(section_name: Any) -> str:
    """Return a conservative markdown filename for a report section."""
    label = _label(section_name, max_chars=80)
    safe = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in label)
    return f"{safe or 'report_section'}.md"


def render_report_section_for_disk(
    section_name: Any,
    content: Any,
    *,
    policy: CliPersistencePolicy,
) -> str:
    """Render one report section according to raw-output persistence policy."""
    raw_text = _content_to_text(content)
    redacted = str(redact_secrets(raw_text))
    digest = hashlib.sha256(raw_text.encode("utf-8", errors="replace")).hexdigest()
    metadata = {
        "section": _label(section_name),
        "raw_llm_output_persisted": policy.persist_raw_llm_output,
        "content_length_chars": len(raw_text),
        "content_sha256": digest,
    }

    if not policy.persist_raw_llm_output:
        return "\n".join(
            [
                "# Report Section Persistence",
                "",
                _json_record(metadata),
                "",
                "Raw LLM output persistence is disabled by CLI policy.",
                "Set cli_logging.persist_raw_llm_output=true to persist capped, redacted report text.",
            ]
        )

    capped, truncated = _cap_text(redacted, policy.max_report_section_chars)
    metadata["content_truncated"] = truncated
    return "\n".join(
        [
            "# Report Section",
            "",
            _json_record(metadata),
            "",
            capped,
        ]
    )


def _json_record(record: dict[str, Any]) -> str:
    return json.dumps(record, ensure_ascii=False, sort_keys=True, default=str)


def _rotated_path(path: Path, index: int) -> Path:
    return path.with_name(f"{path.name}.{index}")


def _content_to_text(content: Any) -> str:
    if isinstance(content, list):
        return "\n".join(str(item) for item in content)
    return str(content)


def _redacted_preview(content: Any, max_chars: int) -> tuple[str, bool]:
    text = str(redact_secrets(content)).replace("\r", " ").replace("\n", " ")
    return _cap_text(text, max_chars)


def _cap_text(text: str, max_chars: int) -> tuple[str, bool]:
    if len(text) <= max_chars:
        return text, False
    suffix = "...[truncated]"
    keep = max(0, max_chars - len(suffix))
    return f"{text[:keep]}{suffix}", True


def _label(value: Any, *, max_chars: int = 120) -> str:
    text = str(redact_secrets(value)).replace("\r", " ").replace("\n", " ").strip()
    capped, _truncated = _cap_text(text, max_chars)
    return capped


def _positive_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    if parsed <= 0:
        return default
    return parsed


def _nonnegative_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    if parsed < 0:
        return default
    return parsed


def _coerce_bool(value: Any, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    text = str(value).strip().lower()
    if text in _TRUE_VALUES:
        return True
    if text in _FALSE_VALUES:
        return False
    return default
