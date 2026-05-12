"""EvaluationsRepository aggregate for the SQLite journal."""

from __future__ import annotations

from .base import (
    OutcomeReview,
    RepositoryMixinBase,
    ThesisEvaluation,
    _iso,
    _new_id,
    model_from_json,
    model_to_json,
)


class EvaluationsRepositoryMixin(RepositoryMixinBase):
    def save_thesis_evaluation(self, evaluation: ThesisEvaluation) -> ThesisEvaluation:
        if not evaluation.id:
            evaluation.id = _new_id("evaluation")
        self.store.execute(
            """
            INSERT INTO thesis_evaluations (
                id, thesis_id, symbol, evaluated_at, evaluation_start,
                evaluation_end, result, invalidated, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                result=excluded.result,
                invalidated=excluded.invalidated,
                payload_json=excluded.payload_json
            """,
            (
                evaluation.id,
                evaluation.thesis_id,
                evaluation.symbol,
                _iso(evaluation.evaluated_at),
                evaluation.evaluation_start.isoformat(),
                evaluation.evaluation_end.isoformat(),
                evaluation.result.value,
                1 if evaluation.invalidated else 0,
                model_to_json(evaluation),
            ),
        )
        return evaluation

    def get_thesis_evaluation(self, evaluation_id: str) -> ThesisEvaluation | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM thesis_evaluations WHERE id = ?", (evaluation_id,)
        )
        return model_from_json(ThesisEvaluation, row["payload_json"]) if row else None

    def list_thesis_evaluations(
        self,
        *,
        thesis_id: str | None = None,
        symbol: str | None = None,
        limit: int = 100,
    ) -> list[ThesisEvaluation]:
        conditions = []
        params: list[object] = []
        if thesis_id:
            conditions.append("thesis_id = ?")
            params.append(thesis_id)
        if symbol:
            conditions.append("symbol = ?")
            params.append(symbol)
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = self.store.fetchall(
            f"""
            SELECT payload_json FROM thesis_evaluations
            {where_clause}
            ORDER BY evaluated_at DESC
            LIMIT ?
            """,
            (*params, limit),
        )
        return [model_from_json(ThesisEvaluation, row["payload_json"]) for row in rows]

    def save_outcome_review(
        self, review: OutcomeReview, *, _conn=None
    ) -> OutcomeReview:
        if not review.id:
            review.id = _new_id("outcome")
        self.store.execute(
            """
            INSERT INTO outcome_reviews (
                id, thesis_id, result, reviewed_at, invalidated, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                result=excluded.result,
                invalidated=excluded.invalidated,
                payload_json=excluded.payload_json
            """,
            (
                review.id,
                review.thesis_id,
                review.result.value,
                _iso(review.reviewed_at),
                1 if review.invalidated else 0,
                model_to_json(review),
            ),
            _conn=_conn,
        )
        return review

    def get_outcome_review(self, review_id: str) -> OutcomeReview | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM outcome_reviews WHERE id = ?", (review_id,)
        )
        return model_from_json(OutcomeReview, row["payload_json"]) if row else None

    def list_outcome_reviews(
        self,
        *,
        thesis_id: str | None = None,
        limit: int = 100,
    ) -> list[OutcomeReview]:
        if thesis_id:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM outcome_reviews
                WHERE thesis_id = ?
                ORDER BY reviewed_at DESC
                LIMIT ?
                """,
                (thesis_id, limit),
            )
        else:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM outcome_reviews
                ORDER BY reviewed_at DESC
                LIMIT ?
                """,
                (limit,),
            )
        return [model_from_json(OutcomeReview, row["payload_json"]) for row in rows]
