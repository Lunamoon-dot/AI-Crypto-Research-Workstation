"""ThesesRepository aggregate for the SQLite journal."""

from __future__ import annotations

from .base import (
    AgentOpinion,
    RepositoryMixinBase,
    ResearchDebate,
    Scenario,
    TradeThesis,
    UserDecision,
    _chunks,
    _iso,
    _new_id,
    model_from_json,
    model_to_json,
)


class ThesesRepositoryMixin(RepositoryMixinBase):
    def save_agent_opinion(self, opinion: AgentOpinion, *, _conn=None) -> AgentOpinion:
        if not opinion.id:
            opinion.id = _new_id("opinion")
        self.store.execute(
            """
            INSERT INTO agent_opinions (
                id, research_run_id, debate_id, agent_name, role, stance,
                confidence, created_at, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                debate_id=excluded.debate_id,
                stance=excluded.stance,
                confidence=excluded.confidence,
                payload_json=excluded.payload_json
            """,
            (
                opinion.id,
                opinion.research_run_id,
                opinion.debate_id,
                opinion.agent_name,
                opinion.role,
                opinion.stance.value,
                opinion.confidence,
                _iso(opinion.created_at),
                model_to_json(opinion),
            ),
            _conn=_conn,
        )
        return opinion

    def save_agent_opinions(
        self, opinions: list[AgentOpinion], *, _conn=None
    ) -> list[AgentOpinion]:
        """Persist a batch of agent opinions in a single transaction.

        Avoids the N+1 connection-open pattern.  Falls back to individual
        saves when the batch is tiny.
        """
        if not opinions:
            return []
        if len(opinions) == 1:
            return [self.save_agent_opinion(opinions[0], _conn=_conn)]

        for opinion in opinions:
            if not opinion.id:
                opinion.id = _new_id("opinion")

        params_seq = [
            (
                opinion.id,
                opinion.research_run_id,
                opinion.debate_id,
                opinion.agent_name,
                opinion.role,
                opinion.stance.value,
                opinion.confidence,
                _iso(opinion.created_at),
                model_to_json(opinion),
            )
            for opinion in opinions
        ]

        def _execute(conn):
            conn.executemany(
                """
                INSERT INTO agent_opinions (
                    id, research_run_id, debate_id, agent_name, role, stance,
                    confidence, created_at, payload_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    debate_id=excluded.debate_id,
                    stance=excluded.stance,
                    confidence=excluded.confidence,
                    payload_json=excluded.payload_json
                """,
                params_seq,
            )

        if _conn is not None:
            _execute(_conn)
        else:
            with self.store.transaction() as conn:
                _execute(conn)
        return opinions

    def get_agent_opinion(self, opinion_id: str) -> AgentOpinion | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM agent_opinions WHERE id = ?", (opinion_id,)
        )
        return model_from_json(AgentOpinion, row["payload_json"]) if row else None

    def get_agent_opinions_by_ids(
        self, opinion_ids: list[str]
    ) -> dict[str, AgentOpinion]:
        """Batch-fetch multiple agent opinions by ID. Returns {id: AgentOpinion}."""
        if not opinion_ids:
            return {}
        placeholders = ", ".join(["?"] * len(opinion_ids))
        rows = self.store.fetchall(
            f"SELECT payload_json FROM agent_opinions WHERE id IN ({placeholders})",
            tuple(opinion_ids),
        )
        result: dict[str, AgentOpinion] = {}
        for row in rows:
            opinion = model_from_json(AgentOpinion, row["payload_json"])
            if opinion and opinion.id:
                result[opinion.id] = opinion
        return result

    def list_agent_opinions(
        self,
        *,
        research_run_id: str | None = None,
        debate_id: str | None = None,
        limit: int = 100,
    ) -> list[AgentOpinion]:
        if debate_id:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM agent_opinions
                WHERE debate_id = ?
                ORDER BY created_at
                LIMIT ?
                """,
                (debate_id, limit),
            )
        elif research_run_id:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM agent_opinions
                WHERE research_run_id = ?
                ORDER BY created_at
                LIMIT ?
                """,
                (research_run_id, limit),
            )
        else:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM agent_opinions
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            )
        return [model_from_json(AgentOpinion, row["payload_json"]) for row in rows]

    def save_debate(self, debate: ResearchDebate, *, _conn=None) -> ResearchDebate:
        if not debate.id:
            debate.id = _new_id("debate")
        self.store.execute(
            """
            INSERT INTO debates (
                id, research_run_id, symbol, consensus_stance, conflict_level,
                created_at, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                consensus_stance=excluded.consensus_stance,
                conflict_level=excluded.conflict_level,
                payload_json=excluded.payload_json
            """,
            (
                debate.id,
                debate.research_run_id,
                debate.symbol,
                debate.consensus_stance.value,
                debate.conflict_level.value,
                _iso(debate.created_at),
                model_to_json(debate),
            ),
            _conn=_conn,
        )
        return debate

    def get_debate(self, debate_id: str) -> ResearchDebate | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM debates WHERE id = ?", (debate_id,)
        )
        return model_from_json(ResearchDebate, row["payload_json"]) if row else None

    def save_thesis(self, thesis: TradeThesis, *, _conn=None) -> TradeThesis:
        if not thesis.id:
            thesis.id = _new_id("thesis")
        self.store.execute(
            """
            INSERT INTO trade_theses (
                id, workspace_id, research_run_id, symbol, direction, setup_type,
                confidence, created_at, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                workspace_id=excluded.workspace_id,
                research_run_id=excluded.research_run_id,
                direction=excluded.direction,
                confidence=excluded.confidence,
                payload_json=excluded.payload_json
            """,
            (
                thesis.id,
                thesis.workspace_id,
                thesis.research_run_id,
                thesis.symbol,
                thesis.direction.value,
                thesis.setup_type,
                thesis.confidence,
                _iso(thesis.created_at),
                model_to_json(thesis),
            ),
            _conn=_conn,
        )
        return thesis

    def get_thesis(
        self, thesis_id: str, *, workspace_id: str | None = None
    ) -> TradeThesis | None:
        if workspace_id:
            row = self.store.fetchone(
                "SELECT payload_json FROM trade_theses WHERE id = ? AND workspace_id = ?",
                (thesis_id, workspace_id),
            )
        else:
            row = self.store.fetchone(
                "SELECT payload_json FROM trade_theses WHERE id = ?", (thesis_id,)
            )
        return model_from_json(TradeThesis, row["payload_json"]) if row else None

    def get_theses_by_ids(
        self, thesis_ids: list[str], *, workspace_id: str | None = None
    ) -> dict[str, TradeThesis]:
        """Batch-fetch theses to avoid N+1 queries in evaluation analytics."""
        if not thesis_ids:
            return {}
        result: dict[str, TradeThesis] = {}
        for chunk in _chunks(thesis_ids):
            placeholders = ",".join("?" for _ in chunk)
            workspace_filter = ""
            params: tuple[object, ...] = tuple(chunk)
            if workspace_id:
                workspace_filter = " AND workspace_id = ?"
                params = (*params, workspace_id)
            rows = self.store.fetchall(
                f"""
                SELECT payload_json FROM trade_theses
                WHERE id IN ({placeholders}){workspace_filter}
                """,
                params,
            )
            for row in rows:
                thesis = model_from_json(TradeThesis, row["payload_json"])
                if thesis and thesis.id:
                    result[thesis.id] = thesis
        return result

    def list_theses(
        self, limit: int = 20, *, workspace_id: str = "local"
    ) -> list[TradeThesis]:
        rows = self.store.fetchall(
            """
            SELECT payload_json FROM trade_theses
            WHERE workspace_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (workspace_id, limit),
        )
        return [model_from_json(TradeThesis, row["payload_json"]) for row in rows]

    def find_thesis_by_id(
        self, thesis_id: str, *, workspace_id: str | None = None
    ) -> TradeThesis | None:
        return self.get_thesis(thesis_id, workspace_id=workspace_id)

    def save_scenario(self, scenario: Scenario, *, _conn=None) -> Scenario:
        if not scenario.id:
            scenario.id = _new_id("scenario")
        self.store.execute(
            """
            INSERT INTO scenarios (
                id, thesis_id, probability_band, suggested_user_action, payload_json
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                probability_band=excluded.probability_band,
                suggested_user_action=excluded.suggested_user_action,
                payload_json=excluded.payload_json
            """,
            (
                scenario.id,
                scenario.thesis_id,
                scenario.probability_band.value,
                scenario.suggested_user_action,
                model_to_json(scenario),
            ),
            _conn=_conn,
        )
        return scenario

    def save_scenarios(
        self, scenarios: list[Scenario], *, _conn=None
    ) -> list[Scenario]:
        """Persist a batch of scenarios in a single transaction.

        Avoids the N+1 connection-open pattern of calling :meth:`save_scenario`
        in a loop.  Falls back to individual saves when the batch is tiny.
        """
        if not scenarios:
            return []
        if len(scenarios) == 1:
            return [self.save_scenario(scenarios[0], _conn=_conn)]

        for scenario in scenarios:
            if not scenario.id:
                scenario.id = _new_id("scenario")

        params_seq = [
            (
                scenario.id,
                scenario.thesis_id,
                scenario.probability_band.value,
                scenario.suggested_user_action,
                model_to_json(scenario),
            )
            for scenario in scenarios
        ]

        def _execute(conn):
            conn.executemany(
                """
                INSERT INTO scenarios (
                    id, thesis_id, probability_band, suggested_user_action, payload_json
                )
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    probability_band=excluded.probability_band,
                    suggested_user_action=excluded.suggested_user_action,
                    payload_json=excluded.payload_json
                """,
                params_seq,
            )

        if _conn is not None:
            _execute(_conn)
        else:
            with self.store.transaction() as conn:
                _execute(conn)
        return scenarios

    def get_scenario(self, scenario_id: str) -> Scenario | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM scenarios WHERE id = ?", (scenario_id,)
        )
        return model_from_json(Scenario, row["payload_json"]) if row else None

    def list_scenarios(
        self,
        *,
        thesis_id: str,
        limit: int = 20,
        workspace_id: str | None = None,
    ) -> list[Scenario]:
        workspace_join = ""
        workspace_filter = ""
        params: tuple[object, ...] = (thesis_id,)
        if workspace_id:
            workspace_join = (
                "JOIN trade_theses ON trade_theses.id = scenarios.thesis_id"
            )
            workspace_filter = "AND trade_theses.workspace_id = ?"
            params = (*params, workspace_id)
        rows = self.store.fetchall(
            f"""
            SELECT scenarios.payload_json FROM scenarios
            {workspace_join}
            WHERE scenarios.thesis_id = ?
            {workspace_filter}
            ORDER BY scenarios.rowid
            LIMIT ?
            """,
            (*params, limit),
        )
        return [model_from_json(Scenario, row["payload_json"]) for row in rows]

    def list_scenarios_by_thesis_ids(
        self,
        thesis_ids: list[str],
        *,
        limit_per_thesis: int = 20,
        workspace_id: str | None = None,
    ) -> dict[str, list[Scenario]]:
        """Batch-fetch scenarios grouped by thesis id."""
        unique_ids = list(
            dict.fromkeys(thesis_id for thesis_id in thesis_ids if thesis_id)
        )
        if not unique_ids or limit_per_thesis <= 0:
            return {}

        result: dict[str, list[Scenario]] = {thesis_id: [] for thesis_id in unique_ids}
        for chunk in _chunks(unique_ids):
            placeholders = ",".join("?" for _ in chunk)
            workspace_join = ""
            workspace_filter = ""
            params: tuple[object, ...] = tuple(chunk)
            if workspace_id:
                workspace_join = (
                    "JOIN trade_theses ON trade_theses.id = scenarios.thesis_id"
                )
                workspace_filter = "AND trade_theses.workspace_id = ?"
                params = (*params, workspace_id)
            rows = self.store.fetchall(
                f"""
                SELECT thesis_id, payload_json
                FROM (
                    SELECT
                        scenarios.thesis_id AS thesis_id,
                        scenarios.payload_json AS payload_json,
                        ROW_NUMBER() OVER (
                            PARTITION BY scenarios.thesis_id
                            ORDER BY scenarios.rowid
                        ) AS row_num
                    FROM scenarios
                    {workspace_join}
                    WHERE scenarios.thesis_id IN ({placeholders})
                    {workspace_filter}
                )
                WHERE row_num <= ?
                ORDER BY thesis_id, row_num
                """,
                (*params, limit_per_thesis),
            )
            for row in rows:
                scenario = model_from_json(Scenario, row["payload_json"])
                key = row["thesis_id"]
                if scenario:
                    result.setdefault(key, []).append(scenario)
        return result

    def save_user_decision(self, decision: UserDecision, *, _conn=None) -> UserDecision:
        if not decision.id:
            decision.id = _new_id("decision")
        self.store.execute(
            """
            INSERT INTO user_decisions (
                id, thesis_id, action, decided_at, user_notes, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                action=excluded.action,
                user_notes=excluded.user_notes,
                payload_json=excluded.payload_json
            """,
            (
                decision.id,
                decision.thesis_id,
                decision.action.value,
                _iso(decision.decided_at),
                decision.user_notes,
                model_to_json(decision),
            ),
            _conn=_conn,
        )
        return decision
