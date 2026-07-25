import asyncio

import httpx

from src.config import DEFAULT_CONCURRENT_SCENARIOS
from src.llm.client import LLMClient
from src.core.conversation import ConversationEngine
from src.core.judge import Judge
from src.core.resolver import Resolver
from src.tools.simulator import ToolSimulator
from src.rag.client import RAGClient
from src.context.builder import ContextBuilder
from src.scoring.calculator import compute_iteration_score


# Defaults for the champion/challenger gate. Overridable via config.
DEFAULT_PASS_THRESHOLD = 0.7
DEFAULT_REGRESSION_MARGIN = 0.05
DEFAULT_PLATEAU_PATIENCE = 3
DEFAULT_CRITICAL_SECTIONS = ["guardrails"]
DEFAULT_CRITICAL_TAGS = [
    "sensitive_data", "guardrails", "claims", "quote", "tax", "pricing", "number_handling",
]


class EventBus:
    def __init__(self, callback_url=None):
        self.callback_url = callback_url
        self._listeners = []

    async def emit(self, event_type, data):
        event = {"event_type": event_type, "data": data}

        if self.callback_url:
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    await client.post(self.callback_url, json=event)
            except Exception:
                pass

        for queue in self._listeners:
            await queue.put(event)

    def subscribe(self):
        q = asyncio.Queue()
        self._listeners.append(q)
        return q

    def unsubscribe(self, q):
        if q in self._listeners:
            self._listeners.remove(q)


class EvalRunner:
    def __init__(self, eval_id, config, callback_url=None):
        self.eval_id = eval_id
        self.config = config
        self.event_bus = EventBus(callback_url)
        self._stopped = False

        self.llm_client = LLMClient(
            base_url=config.get("llm_base_url"),
            model=config.get("llm_model"),
            api_key=config.get("llm_api_key"),
        )

        rag_client = None
        rag_config = config.get("rag")
        if rag_config and rag_config.get("enabled"):
            rag_client = RAGClient(
                server_url=rag_config["server_url"],
                collection_name=rag_config["collection_name"],
                search_type=rag_config.get("search_type", "keyword"),
                top_k=rag_config.get("top_k", 3),
                alpha=rag_config.get("alpha", 0),
                rerank=rag_config.get("rerank", False),
            )

        tool_simulator = None
        if config.get("tools_enabled"):
            enabled_tools = config.get("enabled_tools", [
                "end_call", "voicemail_detected", "warm_transfer_call",
                "switch_agent", "search_knowledge_base", "send_whatsapp_template",
                "date_calculator", "handle_call_screening", "irrelevant_interruption",
            ])
            tool_simulator = ToolSimulator(enabled_tools, rag_client)

        self.conversation_engine = ConversationEngine(
            self.llm_client, tool_simulator, rag_client
        )
        self.judge = Judge(self.llm_client)
        self.resolver = Resolver(self.llm_client)

        self.context_builder = ContextBuilder() if config.get("dynamic_context_enabled") else None
        self.context_data = config.get("context_data")

    def stop(self):
        self._stopped = True

    # ----- helpers -------------------------------------------------------

    def _scenario_name(self, scenario):
        return scenario.get("name") or scenario.get("test_id", "unknown")

    def _is_critical(self, scenario):
        """A scenario is must-pass if explicitly flagged, or its section/tags are in the
        configured critical sets. Breaking a passing critical case forces a revert."""
        if scenario.get("critical") is True:
            return True
        sections = set(self.config.get("critical_sections") or DEFAULT_CRITICAL_SECTIONS)
        tags_crit = set(self.config.get("critical_tags") or DEFAULT_CRITICAL_TAGS)
        if scenario.get("section") in sections:
            return True
        if set(scenario.get("tags") or []) & tags_crit:
            return True
        return False

    def _diff_results(self, champion, challenger, critical_names, pass_threshold, margin):
        """Compare per-scenario composite scores between champion and challenger.

        Returns (regressed, fixed). A previously-passing case counts as regressed only when
        it crosses below the pass threshold AND the drop exceeds the noise margin."""
        regressed, fixed = [], []
        for name, before in champion.items():
            after = challenger.get(name, before)
            was_passing = before >= pass_threshold
            now_passing = after >= pass_threshold
            if was_passing and not now_passing and (before - after) >= margin:
                regressed.append({
                    "scenario": name,
                    "before": round(before, 4),
                    "after": round(after, 4),
                    "critical": name in critical_names,
                })
            elif (not was_passing) and now_passing:
                fixed.append({
                    "scenario": name,
                    "before": round(before, 4),
                    "after": round(after, 4),
                })
        return regressed, fixed

    async def _run_scenarios(self, prompt, scenario_list, concurrent):
        semaphore = asyncio.Semaphore(concurrent)

        async def run_one(scenario):
            async with semaphore:
                scenario_type = self._detect_type(scenario)
                if scenario_type == "single_turn":
                    return await self.conversation_engine.run_single_turn(prompt, scenario)
                elif scenario_type == "multi_turn":
                    return await self.conversation_engine.run_multi_turn(prompt, scenario)
                else:
                    return await self.conversation_engine.run_simulated(prompt, scenario)

        tasks = [run_one(s) for s in scenario_list]
        return await asyncio.gather(*tasks, return_exceptions=False)

    async def _run_and_judge(self, test_prompt, judge_prompt, scenario_list, concurrent, iteration):
        """Run every scenario against `test_prompt`, judge each against `judge_prompt`,
        emitting scenario_complete events. Returns the judged results list."""
        scenario_results = await self._run_scenarios(test_prompt, scenario_list, concurrent)

        judged_results = []
        for i, result in enumerate(scenario_results):
            if self._stopped:
                break
            judged = await self.judge.evaluate(result, judge_prompt)
            judged_results.append(judged)

            await self.event_bus.emit("scenario_complete", {
                "eval_id": self.eval_id,
                "iteration": iteration,
                "scenario_name": judged["scenario_name"],
                "composite_score": judged["composite_score"],
                "scenario_index": i + 1,
                "total_scenarios": len(scenario_results),
            })

        return judged_results

    def _detect_type(self, scenario):
        explicit = scenario.get("type")
        if explicit:
            return explicit
        if "question" in scenario:
            return "single_turn"
        if "turns" in scenario:
            return "multi_turn"
        return "simulated"

    # ----- main loop -----------------------------------------------------

    async def run(self, system_prompt, scenarios):
        max_iterations = self.config.get("max_iterations", 5)
        quality_threshold = self.config.get("quality_threshold", 0.9)
        concurrent = self.config.get("concurrent_scenarios", DEFAULT_CONCURRENT_SCENARIOS)
        pass_threshold = self.config.get("scenario_pass_threshold", DEFAULT_PASS_THRESHOLD)
        regression_margin = self.config.get("regression_margin", DEFAULT_REGRESSION_MARGIN)
        plateau_patience = self.config.get("plateau_patience", DEFAULT_PLATEAU_PATIENCE)

        scenario_list = scenarios.get("scenarios", scenarios) if isinstance(scenarios, dict) else scenarios
        included = set(self.config.get("included_scenarios") or [])
        excluded = set(self.config.get("excluded_scenarios") or [])
        if included:
            scenario_list = [
                s for s in scenario_list
                if (s.get("name") or s.get("test_id")) in included
            ]
        if excluded:
            scenario_list = [
                s for s in scenario_list
                if (s.get("name") or s.get("test_id")) not in excluded
            ]

        critical_names = {self._scenario_name(s) for s in scenario_list if self._is_critical(s)}

        def build_full(prompt):
            if self.context_builder and self.context_data:
                return self.context_builder.build(prompt, self.context_data)
            return prompt

        # ---- baseline: evaluate the initial prompt as champion v0 ----
        await self.event_bus.emit("iteration_start", {
            "eval_id": self.eval_id,
            "iteration": 0,
            "total_iterations": max_iterations,
            "phase": "baseline",
        })

        champion_prompt = system_prompt
        champion_judged = await self._run_and_judge(
            build_full(champion_prompt), champion_prompt, scenario_list, concurrent, 0
        )
        champion_results = {r["scenario_name"]: r["composite_score"] for r in champion_judged}
        champion_score = compute_iteration_score(list(champion_results.values()))

        prompt_versions = [{
            "version": 0,
            "prompt": champion_prompt,
            "score": champion_score,
            "changes": "Initial prompt",
            "status": "baseline",
        }]
        attempt_history = []

        await self.event_bus.emit("iteration_complete", {
            "eval_id": self.eval_id,
            "iteration": 0,
            "score": champion_score,
            "champion_score": champion_score,
            "accepted": True,
            "scenario_results": champion_judged,
        })

        version_counter = 0
        attempts_run = 0
        consecutive_reverts = 0
        revert_history = []   # all reverted attempts since the last accept; fed back to the coach
        final_status = "completed"

        if champion_score >= quality_threshold:
            await self.event_bus.emit("threshold_met", {
                "eval_id": self.eval_id,
                "score": champion_score,
                "iteration": 0,
            })
        else:
            for attempt in range(1, max_iterations + 1):
                if self._stopped:
                    break
                attempts_run = attempt

                await self.event_bus.emit("iteration_start", {
                    "eval_id": self.eval_id,
                    "iteration": attempt,
                    "total_iterations": max_iterations,
                })

                # Anti-stall rung 1: after any revert, ask the coach for the smallest surgical fix.
                surgical = consecutive_reverts >= 1

                challenger_prompt, changes, diagnosis, strategy, edits = await self.resolver.improve(
                    champion_prompt, champion_judged, attempt,
                    revert_history=revert_history, surgical=surgical,
                )
                if self._stopped:
                    break

                challenger_judged = await self._run_and_judge(
                    build_full(challenger_prompt), challenger_prompt, scenario_list, concurrent, attempt
                )
                challenger_results = {r["scenario_name"]: r["composite_score"] for r in challenger_judged}
                challenger_score = compute_iteration_score(list(challenger_results.values()))

                regressed, fixed = self._diff_results(
                    champion_results, challenger_results, critical_names, pass_threshold, regression_margin
                )
                critical_regressions = [r for r in regressed if r["critical"]]

                # Regression-strict gate: accept only if the mean rises AND nothing regresses.
                # Any critical regression is a hard block (subsumed here, kept explicit).
                mean_improved = challenger_score > champion_score + 1e-9
                accept = mean_improved and not regressed and not critical_regressions

                version_counter += 1

                if accept:
                    champion_prompt = challenger_prompt
                    champion_judged = challenger_judged
                    champion_results = challenger_results
                    champion_score = challenger_score
                    self.resolver.record_accepted(changes)
                    consecutive_reverts = 0
                    revert_history = []   # streak broken — coach starts fresh from the new champion

                    prompt_versions.append({
                        "version": version_counter,
                        "prompt": challenger_prompt,
                        "score": challenger_score,
                        "changes": changes,
                        "status": "accepted",
                        "fix_strategy": strategy,
                        "fixed": fixed,
                        "edits": edits,
                    })
                    attempt_history.append({
                        "attempt": attempt, "outcome": "accepted",
                        "score": challenger_score, "fixed": fixed, "changes": changes,
                    })

                    await self.event_bus.emit("prompt_improved", {
                        "eval_id": self.eval_id,
                        "version": version_counter,
                        "changes": changes,
                        "score": challenger_score,
                        "accepted": True,
                        "fixed": fixed,
                        "edits": edits,
                    })
                else:
                    consecutive_reverts += 1
                    if critical_regressions:
                        reason = "critical_regression"
                    elif regressed:
                        reason = "regression"
                    else:
                        reason = "no_improvement"

                    revert_history.append({
                        "attempt": attempt,
                        "changes": changes,
                        "score_before": champion_score,
                        "score_after": challenger_score,
                        "regressed": regressed,
                        "reason": reason,
                    })

                    prompt_versions.append({
                        "version": version_counter,
                        "prompt": challenger_prompt,
                        "score": challenger_score,
                        "changes": changes,
                        "status": "reverted",
                        "reason": reason,
                        "regressed": regressed,
                        "diagnosis": diagnosis,
                        "fix_strategy": strategy,
                        "edits": edits,
                    })
                    attempt_history.append({
                        "attempt": attempt, "outcome": "reverted", "reason": reason,
                        "score": challenger_score, "regressed": regressed, "changes": changes,
                    })

                    await self.event_bus.emit("prompt_reverted", {
                        "eval_id": self.eval_id,
                        "version": version_counter,
                        "reason": reason,
                        "regressed": regressed,
                        "champion_score": champion_score,
                        "challenger_score": challenger_score,
                        "diagnosis": diagnosis,
                        "edits": edits,
                    })

                await self.event_bus.emit("iteration_complete", {
                    "eval_id": self.eval_id,
                    "iteration": attempt,
                    "score": champion_score,
                    "champion_score": champion_score,
                    "challenger_score": challenger_score,
                    "accepted": accept,
                    "scenario_results": champion_judged,
                })

                if accept and champion_score >= quality_threshold:
                    await self.event_bus.emit("threshold_met", {
                        "eval_id": self.eval_id,
                        "score": champion_score,
                        "iteration": attempt,
                    })
                    break

                # Anti-stall rung 2: if nothing has been accepted for `plateau_patience`
                # attempts in a row, stop early rather than burning the budget. The remaining
                # failures are likely a model-capability ceiling or conflicting scenarios.
                if consecutive_reverts >= plateau_patience:
                    final_status = "converged"
                    stubborn = sorted(
                        [r for r in champion_judged if r.get("composite_score", 0) < pass_threshold],
                        key=lambda r: r.get("composite_score", 0),
                    )
                    await self.event_bus.emit("converged", {
                        "eval_id": self.eval_id,
                        "champion_score": champion_score,
                        "consecutive_reverts": consecutive_reverts,
                        "stubborn_cases": [
                            {"scenario": r["scenario_name"], "score": r.get("composite_score", 0)}
                            for r in stubborn
                        ],
                        "message": (
                            f"No accepted improvement for {consecutive_reverts} attempts. "
                            "Remaining failures look like a capability ceiling or conflicting "
                            "scenarios — stopping and returning the best prompt found."
                        ),
                    })
                    break

        result = {
            "eval_id": self.eval_id,
            "final_score": champion_score,
            "iterations_run": attempts_run,
            "prompt_versions": prompt_versions,
            "scenario_results": champion_judged,
            "best_prompt": champion_prompt,
            "attempt_history": attempt_history,
            "status": "stopped" if self._stopped else final_status,
        }

        await self.event_bus.emit("eval_complete", {
            "eval_id": self.eval_id,
            **result,
        })

        return result
