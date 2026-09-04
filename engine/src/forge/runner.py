"""ForgeRunner — the tiered optimization loop (design R1–R8 + Revision 2).

Per iteration (tiered evaluation, Fix 2):
  - CHEAP (per candidate): the targeted problem's detector + regression on previously-solved
    problems only. ~3–6 probes, not the whole matrix.
  - ON ACCEPT: full matrix re-run.
  - MILESTONE (every K accepts): 300–500 stress sims.
  - ON ACCEPT / v0 baseline: deepeval metrics (CallEvaluator best-of-N) on a probe sample.

Acceptance (Fix 10): accept iff targeted→Y AND no previously-solved regresses AND composite
drop ≤ margin. Matrix is primary; composite is a guard.

Gate (Fix 4): solved% over the SNAPSHOT denominator of APPLICABLE, has_detector problems;
`~` never counts; filter_territory is excluded (human-only). New problems found by stress are
tracked but don't move the current % (require a human re-baseline).

Layer routing + escalation (R5): coach may edit the campaign layer freely; a low-confidence
shared-layer fix is parked (awaiting_human) and the loop continues with other problems.

State is emitted as events; the backend persists them into the forge_* tables.
"""
from __future__ import annotations

import asyncio

import httpx

from src.config import DEFAULT_MAX_LLM_CONCURRENCY
from src.llm.client import LLMClient
from src.core.conversation import ConversationEngine
from src.tools.simulator import ToolSimulator
from src.tools import parser as tparse
from src.forge import toolchecks as tchecks
from src.analysis.evaluator import CallEvaluator
from src.forge import merge as fmerge
from src.forge import combos as fcombo
from src.forge import detectors as fdet
from src.forge import coach as fcoach
from src.forge import stress as fstress
from src.forge import verify as fverify
from src.forge.coach import Coach, apply_standalone_edits, apply_layer_edits
from src.forge.scorer import score_probe

# deepeval-metric-verdicted problems: the metric score IS the detector. The mapping
# lives in detectors.py beside every other detector registry — this module must not
# name a problem id (see tests/test_no_problem_ids.py).
METRIC_PROBLEMS = fdet.METRIC_DETECTORS


class EventBus:
    def __init__(self, callback_url=None):
        self.callback_url = callback_url
        self._listeners = []

    async def emit(self, event_type, data):
        event = {"event_type": event_type, "data": {"run_id": data.get("run_id"), **data}}
        if self.callback_url:
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    await client.post(self.callback_url, json=event)
            except Exception:
                pass
        for q in self._listeners:
            await q.put(event)

    def subscribe(self):
        q = asyncio.Queue()
        self._listeners.append(q)
        return q

    def unsubscribe(self, q):
        if q in self._listeners:
            self._listeners.remove(q)


def _pooled_tool_calling(sims):
    """Total VALID tool calls / total attempts across every conversation.

    A conversation-level median answers "what does a typical call look like?";
    the question that matters for tools is "does this agent ever fail to act?".
    One leaked end_call in fifteen calls must move the number — with a median it
    doesn't move until half the calls fail. Returns None when nothing was attempted
    anywhere (nothing to judge), which keeps the metric out of arena averages.
    """
    valid = attempts = 0
    for sim in (sims or []):
        for c in (sim.get("tool_calls") or []):
            attempts += 1
            if not str(c.get("result", "")).startswith("Unknown function"):
                valid += 1
        attempts += len(sim.get("tool_leaks") or [])   # spoken, never executed
    return round(100.0 * valid / attempts, 1) if attempts else None


def _pooled_from_probe_results(results):
    """Same pooling for the optimizer path, where score_probe already returned the
    per-rollout tool records and any spoken-tool leaks."""
    valid = attempts = 0
    for r in (results or []):
        for calls in (r.get("all_tool_calls") or []):
            for c in (calls or []):
                attempts += 1
                if not str(c.get("result", "")).startswith("Unknown function"):
                    valid += 1
        attempts += len(r.get("spoken_tool_leaks") or [])
    return round(100.0 * valid / attempts, 1) if attempts else None


def _wrap(markdown, direction, lead_status, lead=None):
    """Assemble the system prompt in PREFIX-CACHE order: the big STATIC blocks first,
    the tiny per-call dynamic block LAST.

    vLLM matches its prefix/KV cache token-by-token from position 0. With the
    lead header on top, every conversation diverged within ~15 tokens and paid a
    full prefill of the whole prompt; with it at the bottom, all conversations of
    a run share one cached prefix and only the short tail is prefilled.

    NOTE this is deliberately NOT production's full 10-block layout (see
    docs/FORGE_COMBO_MATRIX.md, "KNOWN, ACCEPTED divergence"). The LEAD INFORMATION
    block is enriched per combo; no other block is added.
    """
    lines = []
    if lead and lead.get("name"):
        lines.append(f"Customer Name: {lead['name']}")
    lines.append(f"Call Direction: {direction}")
    lines.append(f"Lead Status: {lead_status}")
    if lead and lead.get("followup_reason"):
        lines.append(f"Reason for follow-up: {lead['followup_reason']}")
    lead_block = "\n".join(lines)
    return (f"**AGENT INSTRUCTIONS:**\n{markdown}\n\n"
            f"**CALL TRANSFER CAPABILITY:**\nTransfer to the team for a callback.\n\n"
            f"**LEAD INFORMATION:**\n{lead_block}")


class ForgeRunner:
    def __init__(self, run_id, config, callback_url=None):
        self.run_id = run_id
        self.config = config or {}
        self.bus = EventBus(callback_url)
        self._stopped = False
        self._cur_version = 0  # stamped onto stored sims

        # AGENT model = the LLM under test (arena contestants override llm_*).
        # JUDGE model = fixed (judge_* keys, default env Gemma) — it also plays the
        # simulated customer, so every contestant faces the same lead and the same
        # scorer; only the agent varies, which keeps arena scores comparable.
        self.agent_llm = LLMClient(
            base_url=config.get("llm_base_url"),
            model=config.get("llm_model"),
            api_key=config.get("llm_api_key"),
            params=config.get("llm_params"),
        )
        self.judge_llm = LLMClient(
            base_url=config.get("judge_base_url"),
            model=config.get("judge_model"),
            api_key=config.get("judge_api_key"),
        )
        self.llm = self.judge_llm  # coach/mining/aux calls run on the fixed judge
        # Core four (end_call, voicemail_detected, handle_call_screening,
        # date_calculator) are always on inside ToolSimulator — this list is the
        # GATED extras, mirroring production's available_tools metadata.
        tools = ToolSimulator(config.get("enabled_tools") or [
            "warm_transfer_call", "search_knowledge_base", "send_whatsapp_template",
        ]) if config.get("tools_enabled", True) else None
        self.engine = ConversationEngine(self.agent_llm, tools, None, user_llm=self.judge_llm)
        self.evaluator = CallEvaluator(self.judge_llm)
        self.coach = Coach(self.judge_llm)

    def stop(self):
        self._stopped = True

    async def _run_tool_checks(self, system_prompt, greeting, only=None):
        """One scripted conversation per enabled tool (x2 phrasings): does the model
        actually CALL the tool when the situation demands it? Emits each conversation
        as a stored sim (kind='toolcheck') and returns the per-tool roll-up."""
        sim = self.engine.tool_simulator
        if not sim:
            return {}
        import uuid as _uuid
        enabled = list(getattr(sim, "enabled_tools", []) or [])
        if only:
            enabled = [t for t in enabled if t in set(only)]
        plan = tchecks.checks_for(enabled)
        results = []
        total = len(plan)
        for i, (tool, variant, lines, note) in enumerate(plan):
            if self._stopped:
                break
            sim.reset_conversation()
            try:
                convo, ended, meta = await fdet._drive(
                    self.engine.llm, system_prompt, greeting, lines, tools_on=True, tool_sim=sim)
            except Exception as e:
                await self.bus.emit("iteration_note", {"run_id": self.run_id, "attempt": 0,
                                    "note": f"tool check {tool} errored: {str(e)[:80]}"})
                continue
            calls = (meta or {}).get("tool_calls") or []
            leaks = (meta or {}).get("tool_leaks") or []
            v = tchecks.verdict(tool, calls, leaks)
            results.append((tool, v))
            uid = f"{self.run_id[:8]}-tchk-{tool[:12]}-{variant}-{_uuid.uuid4().hex[:5]}"
            await self.bus.emit("sim_recorded", {
                "run_id": self.run_id, "sim_uid": uid, "kind": "toolcheck",
                "probe": f"{tool} · {note}", "idx": variant, "version": self._cur_version,
                "ended": ended is not None,
                "transcript": fdet.convo_to_transcript(convo, meta),
                "tool_calls": calls, "tool_leaks": leaks,
                "tool_summary": {**self._tool_summary(calls, leaks, [tool]), "check_verdict": v,
                                 "check_tool": tool},
            })
            await self.bus.emit("progress", {"run_id": self.run_id, "phase": "tool_checks",
                                             "done": i + 1, "total": total, "probe": tool,
                                             "verdict": v})
        return tchecks.roll_up(results)

    async def _fix_tool_calls(self, mode, champion, tool_checks, sp, greeting,
                              direction, lead_status, max_fixes=3):
        """Coach the prompt until the failing tools actually FIRE.

        A tool check that fails is the cleanest possible optimization target: the
        situation is scripted, the desired action is unambiguous, and the proven
        lever is already written down (toolchecks.TOOL_LEVERS). So for each failing
        tool we hand the coach the failure + the lever, apply its edit, and RE-RUN
        that tool's checks — keeping the edit only if the tool starts firing.
        Returns (champion, tool_checks, applied_fixes).
        """
        applied = []
        for tool, roll in tchecks.failing(tool_checks)[:max_fixes]:
            if self._stopped:
                break
            problem = tchecks.as_coach_problem(tool, roll)
            await self.bus.emit("iteration_note", {
                "run_id": self.run_id, "attempt": 0,
                "note": f"coaching {tool}: {roll.get('verdict')} ({roll.get('called', 0)}/{roll.get('n', 0)} phrasings)"})
            try:
                decision = await self.coach.propose(
                    mode=mode, problem=problem,
                    current_prompt=(champion.get("blob") if mode == "standalone" else None),
                    layers=champion.get("layers"),
                    guidance=("This is a TOOL-CALLING failure, not a wording problem. The fix must make "
                              "the model actually invoke the tool in that situation. Apply the lever."))
            except Exception as e:
                await self.bus.emit("iteration_note", {"run_id": self.run_id, "attempt": 0,
                                    "note": f"coach errored on {tool}: {str(e)[:80]}"})
                continue
            if decision.get("escalate") or decision.get("needs_human"):
                continue                      # shared-layer edits stay human-gated
            cand, n_applied = self._apply_fix(mode, champion, decision)
            if not n_applied:
                continue
            csp, ccfg, cgreet = self._build_prompt(mode, cand, direction, lead_status)
            after = await self._run_tool_checks(csp, cgreet, only=[tool])
            before_v = (roll or {}).get("verdict")
            after_v = (after.get(tool) or {}).get("verdict")
            kept = after_v == tchecks.CALLED
            await self.bus.emit("iteration_note", {
                "run_id": self.run_id, "attempt": 0,
                "note": (f"{tool}: {before_v} -> {after_v} — "
                         + ("edit KEPT" if kept else "edit reverted, tool still not firing"))})
            if kept:
                champion = cand
                tool_checks = {**tool_checks, tool: after[tool]}
                sp, greeting = csp, cgreet
                applied.append({"tool": tool, "from": before_v, "to": after_v,
                                "summary": decision.get("changes_summary"),
                                "edits": decision.get("edits")})
        return champion, tool_checks, applied, sp, greeting

    def _tool_summary(self, calls, leaks, expected=None):
        """Per-conversation tool verdict: offered / fired / leaked / unknown / missed."""
        offered = (list(getattr(self.engine.tool_simulator, "enabled_tools", []) or [])
                   if self.engine.tool_simulator else [])
        return tparse.summarize(offered, calls, leaks, expected)

    async def _coach_guidance(self, spec):
        """The operator's live guidance for this run.

        The engine receives `spec` once at dispatch, but the guidance panel is edited
        WHILE the run is going — so re-read it from the backend before each proposal and
        fall back to whatever the spec was launched with."""
        fallback = spec.get("coach_guidance") or ""
        url = self.bus.callback_url
        if not url:
            return fallback
        base = url.split("/api/")[0]
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                r = await client.get(f"{base}/api/internal/forge/{self.run_id}/coach-guidance")
                if r.status_code == 200:
                    return (r.json() or {}).get("coach_guidance") or fallback
        except Exception:
            pass          # a guidance fetch must never be able to kill a run
        return fallback

    # ---- prompt building ----------------------------------------------------
    def _build_prompt(self, mode, champion, direction, lead_status, lead=None,
                      greeting_override=None):
        """Return (system_prompt, config_for_scorer, greeting)."""
        if mode == "layered":
            rows = []
            for lt in ("universal", "vertical", "campaign"):
                layer = champion["layers"].get(lt)
                if not layer:
                    continue
                oks = champion.get("override_keys", {}).get(lt, [])
                # production allows N prompt rows per layer type; accept a list too
                for one in (layer if isinstance(layer, list) else [layer]):
                    if one:
                        rows.append({"prompt_type": lt, "prompt": one, "override_keys": oks})
            addons = champion["layers"].get("addon") or []
            res = fmerge.assemble_for_forge(rows, addons, call_direction=direction, lead_status=lead_status)
            # a human-authored greeting for a combo the prompt could not serve
            greeting = greeting_override or res["greeting"]
            return (_wrap(res["markdown"], direction, lead_status, lead),
                    res["merged_full"], greeting)
        # standalone
        blob = champion["blob"]
        if isinstance(blob, dict):
            # a structured editable_config — render a readable system prompt, score on the dict
            md = fmerge.render_markdown(blob)
            return _wrap(md, direction, lead_status, lead), blob, (greeting_override or "")
        return _wrap(str(blob), direction, lead_status, lead), {}, (greeting_override or "")

    def _apply_fix(self, mode, champion, decision):
        """Apply the coach's edits run-local. Returns (new_champion, applied)."""
        import copy
        champ = copy.deepcopy(champion)
        edits = decision.get("edits") or []
        if mode == "layered":
            # HARD WRITE-LOCK: campaign is the ONLY writable layer. Universal/vertical
            # proposals must have escalated before reaching here — refuse as belt-and-braces.
            if decision.get("layer_for_fix", "campaign") != "campaign":
                return champ, 0
            new_layer, applied = apply_layer_edits(champ["layers"].get("campaign", {}), edits)
            champ["layers"]["campaign"] = new_layer
            return champ, applied
        blob = champ["blob"]
        base = fmerge.render_markdown(blob) if isinstance(blob, dict) else str(blob)
        new_blob, applied = apply_standalone_edits(base, edits)
        champ["blob"] = new_blob
        return champ, applied

    # ---- run-then-grade detector pipeline -----------------------------------
    # PHASE A generates EVERY conversation first (each stored + emitted live);
    # PHASE B grades the stored archive; verdicts carry sim_uids + reasons so the
    # UI can prove every N with the actual exchange.
    async def _generate_sims(self, system_prompt, greeting, problem_ids, votes, kind):
        import uuid as _uuid
        convo_pids = [pid for pid in problem_ids if fdet.scenario_for(pid) is not None]
        sims = []  # {sim_uid, pid, idx, convo, ended}
        total = len(convo_pids) * votes
        done = 0
        sem = asyncio.Semaphore(8)

        async def one(pid, k):
            async with sem:
                if self._stopped:
                    return None
                try:
                    # vote k uses variant k — different phrasing of the same situation
                    convo, ended, meta = await fdet.drive_scenario(
                        self.engine, system_prompt, greeting, pid, variant=k)
                except Exception as e:
                    convo, ended, meta = [("A", greeting or ""), ("L", f"[generation error: {str(e)[:60]}]")], None, {}
                uid = f"{self.run_id[:8]}-{kind[:4]}-{pid}-{k}-{_uuid.uuid4().hex[:6]}"
                return {"sim_uid": uid, "pid": pid, "idx": k, "convo": convo, "ended": ended,
                        "meta": meta, "tool_calls": (meta or {}).get("tool_calls") or []}

        tasks = [one(pid, k) for pid in convo_pids for k in range(votes)]
        n_errors = 0
        for fut in asyncio.as_completed(tasks):
            sim = await fut
            if sim is None:
                continue
            if any("[generation error" in (c or "") for _r, c in sim["convo"]):
                n_errors += 1
            sims.append(sim)
            done += 1
            await self.bus.emit("sim_recorded", {
                "run_id": self.run_id, "sim_uid": sim["sim_uid"], "kind": kind,
                "problem_id": sim["pid"], "idx": sim["idx"], "version": self._cur_version,
                "ended": sim["ended"] is not None,
                "transcript": fdet.convo_to_transcript(sim["convo"], sim.get("meta")),
                "tool_calls": sim.get("tool_calls") or [],
            })
            await self.bus.emit("progress", {"run_id": self.run_id,
                                             "phase": "confirm_convos" if kind == "deep_confirm" else "conversations",
                                             "done": done, "total": total, "problem_id": sim["pid"]})
        # CIRCUIT BREAKER: a failing endpoint (403 key limit, dead host, ...) must abort
        # loudly — never let the judge grade a pile of empty conversations.
        if total >= 6 and n_errors / max(1, len(sims)) > 0.5:
            first_err = next((c for sim in sims for _r, c in sim["convo"] if "[generation error" in (c or "")), "")
            raise RuntimeError(f"endpoint failing: {n_errors}/{len(sims)} conversations errored — {first_err[:180]}")
        return sims

    async def _grade_matrix_sims(self, system_prompt, sims, problem_ids, votes, kind):
        """Grade per-problem scenario conversations (the tiered coaching path).

        Distinct from _grade_sims below, which sweeps EVERY problem across a finished
        dataset. Do not merge the names: both are live and they take different arguments
        (see tests/test_no_duplicate_methods.py)."""
        judge = self.judge_llm
        out = {}
        graded = 0
        total = len(sims)
        by_pid = {}
        for sim in sims:
            by_pid.setdefault(sim["pid"], []).append(sim)
        # Judge CONCURRENTLY. Generation has always run 8 at a time; grading ran one at a
        # time, so a 93-conversation matrix was 93 serial judge calls — 42 of the first
        # 50 minutes of a real run. gather() keeps the results in sim order, so the
        # evidence quoted for a problem stays deterministic.
        sem = asyncio.Semaphore(DEFAULT_MAX_LLM_CONCURRENCY)

        async def _judge_one(pid, sim):
            nonlocal graded
            async with sem:
                if self._stopped:
                    return sim, False, "stopped", None
                # an errored/empty conversation is UNGRADEABLE — always a fail with the
                # real reason, never a judged pass on a blank transcript.
                if (any("[generation error" in (c or "") for _r, c in sim["convo"])
                        or not any(r == "A" and (c or "").strip() for r, c in sim["convo"][1:])) \
                        and sim["ended"] is None:
                    ok, reason, fturn = False, "generation error — no agent reply", None
                else:
                    try:
                        ok, reason, fturn = await fdet.grade_sim(pid, sim["convo"], sim["ended"], judge,
                                                                 system_prompt=system_prompt)
                    except Exception as e:
                        ok, reason, fturn = False, f"grade_err {str(e)[:40]}", None
                graded += 1
                await self.bus.emit("sims_graded", {"run_id": self.run_id, "sims": [{
                    "sim_uid": sim["sim_uid"], "verdict": "pass" if ok else "fail",
                    "reason": reason, "failing_turn": fturn}]})
                await self.bus.emit("progress", {"run_id": self.run_id, "phase": "judging",
                                                 "done": graded, "total": total, "problem_id": pid,
                                                 "verdict": "pass" if ok else "fail"})
                return sim, bool(ok), reason, fturn

        for pid, group in by_pid.items():
            if self._stopped:
                break
            results, uids, fails = [], [], []
            ordered = sorted(group, key=lambda x: x["idx"])
            for sim, ok, reason, fturn in await asyncio.gather(*(_judge_one(pid, s) for s in ordered)):
                results.append(bool(ok))
                uids.append(sim["sim_uid"])
                if not ok:
                    fails.append({"sim_uid": sim["sim_uid"], "reason": reason, "failing_turn": fturn})
            passes = sum(results)
            n = len(results)
            ev = (fails[0]["reason"] if fails else "ok")
            out[pid] = {"verdict": fdet.verdict_from_votes(passes, n), "passes": passes, "votes": n,
                        "evidence": f"{passes}/{n} {ev}", "sim_uids": uids, "fails": fails[:5]}
        # prompt-structure problems: judged once against the prompt text (deterministic)
        for pid in problem_ids:
            if pid in fdet.PROMPT_JUDGE_DETECTORS and pid not in out:
                ok, ev, _ft = await fdet._prompt_judge(judge, system_prompt, fdet.PROMPT_JUDGE_DETECTORS[pid])
                passes = votes if ok else 0
                out[pid] = {"verdict": fdet.verdict_from_votes(passes, votes), "passes": passes,
                            "votes": votes, "evidence": ev, "sim_uids": [], "source": "prompt_text",
                            "fails": ([] if ok else [{"sim_uid": None, "reason": ev, "failing_turn": None}])}
        return out

    async def _run_matrix(self, system_prompt, greeting, problem_ids, votes, kind="detector"):
        """Run-then-grade over the problem set: generate all conversations, then grade."""
        sims = await self._generate_sims(system_prompt, greeting, problem_ids, votes, kind)
        return await self._grade_matrix_sims(system_prompt, sims, problem_ids, votes, kind)

    async def _deep_confirm(self, system_prompt, greeting, statuses, pids, confirm_votes):
        """A problem may only be declared SOLVED after ~confirm_votes simulations pass at
        >=90% (3/3 proves nothing). Same run-then-grade shape, kind=deep_confirm."""
        pids = [pid for pid in pids if fdet.scenario_for(pid) is not None]
        if not pids:
            return
        res = await self._run_matrix(system_prompt, greeting, pids, confirm_votes, kind="deep_confirm")
        for pid, r in res.items():
            statuses[pid] = r

    def _solved_pct(self, statuses, denominator):
        if not denominator:
            return 100.0
        solved = sum(1 for pid in denominator if statuses.get(pid, {}).get("verdict") == "Y")
        return round(solved / len(denominator) * 100, 1)

    async def _deepeval_from_sims(self, sims, config_for_scorer, direction):
        """SINGLE-PASS metrics: evaluate the SAME stored scenario conversations —
        no extra probe conversations are generated. Returns (composite, sections,
        metrics, latency) aggregated by median across the sims."""

        def _rows(sim):
            # sims carry either scripted convo tuples (+meta) or raw transcript rows
            if sim.get("transcript") is not None:
                return sim["transcript"]
            return fdet.convo_to_transcript(sim["convo"], sim.get("meta"))

        results = []
        usable = [sim for sim in sims
                  if any(t.get("role") in ("agent", "agent_end") and (t.get("content") or "").strip()
                         for t in _rows(sim)) or sim["ended"] is not None]
        for k, sim in enumerate(usable):
            if self._stopped:
                break
            lines = []
            for t in _rows(sim):
                c = (t.get("content") or "").strip()
                if not c:
                    continue
                lines.append(("Agent: " if t.get("role") in ("agent", "agent_end") else "User: ") + c)
            call = {
                "editable_config": config_for_scorer or {},
                "transcript": "\n".join(lines),
                "call_direction": direction,
                "available_tools": (list(getattr(self.engine.tool_simulator, "enabled_tools", []) or [])
                                    if self.engine.tool_simulator else []),
                "tool_events": [{"name": n} for n in (sim.get("fired") or ([]))] or
                               ([{"name": "end_call"}] if sim["ended"] else []),
            }
            try:
                res = await self.evaluator.evaluate(call)
            except Exception as e:
                res = {"composite_score": None, "sections": {}, "metrics": {},
                       "gated_reason": f"score_error: {str(e)[:80]}"}
            if isinstance(res.get("metrics"), dict):
                # tool_calling is CODE-COMPUTED call QUALITY, not volume. A call is BAD if:
                #  - unknown/unavailable tool (hallucinated)
                #  - identical duplicate within the same conversation (spam loop)
                #  - voicemail_detected after the "machine" already spoke like a human
                #  - a tool name SPOKEN instead of called (recovered by the parser) — the
                #    model believed it acted; nothing executed
                calls = sim.get("tool_calls") or []
                leaks = sim.get("tool_leaks") or []
                summ = self._tool_summary(calls, leaks, sim.get("expected_tools"))
                if summ["attempts"] == 0:
                    res["metrics"]["tool_calling"] = None  # nothing attempted -> not judgeable
                else:
                    user_turns = sum(1 for t in (sim.get("transcript") or [])
                                     if t.get("role") == "user" and (t.get("content") or "").strip())
                    seen, good = set(), 0
                    for t in calls:
                        key = (t.get("name"), str(t.get("args")))
                        if str(t.get("result", "")).startswith("Unknown function"):
                            pass                     # hallucinated tool
                        elif key in seen:
                            pass                     # duplicate spam
                        elif t.get("name") == "voicemail_detected" and user_turns >= 2:
                            pass                     # a talking human is not a voicemail
                        else:
                            good += 1
                        seen.add(key)
                    res["metrics"]["tool_calling"] = round(100.0 * good / summ["attempts"], 1)
                    res["tool_summary"] = summ
            results.append(res)
            await self.bus.emit("progress", {"run_id": self.run_id, "phase": "deepeval",
                                             "done": k + 1, "total": len(usable),
                                             "probe": str(sim.get("pid") or sim.get("probe") or "?")})
        comps = [r["composite_score"] for r in results if r.get("composite_score") is not None]
        composite = round(sum(comps) / len(comps), 1) if comps else None

        # MEAN, not median: `composite` above is the mean of the per-conversation
        # composites, so a median breakdown cannot add up to the headline it explains.
        # Median also hides a split result — 7 conversations at 20 and 8 at 80 reads as
        # 80, when what a caller actually gets is 52.
        def _agg_mean(key):
            keys = set()
            for r in results:
                keys.update((r.get(key) or {}).keys())
            out = {}
            for k2 in keys:
                if key == "sections":
                    vals = [(r.get(key) or {}).get(k2, {}).get("score") for r in results]
                else:
                    vals = [(r.get(key) or {}).get(k2) for r in results]
                vals = [v for v in vals if isinstance(v, (int, float))]
                out[k2] = round(sum(vals) / len(vals), 1) if vals else None
            # tool_calling is CODE-COMPUTED, so a 0 is a real failed call, not judge
            # noise — median would discard exactly the signal that matters. Pool it:
            # total valid calls / total attempts across the run, weighting each
            # conversation by how much tool work it actually did.
            if key == "metrics":
                out["tool_calling"] = _pooled_tool_calling(usable)
            return out

        # latency straight from the stored per-turn meta
        lat_all, tok_all, lat_detail, ttft_all = [], [], [], []
        long_turns, n_text = 0, 0
        for sim in usable:
            turns = []
            tr = _rows(sim)
            for t in tr:
                if t["role"] in ("agent", "agent_end") and t.get("latency_ms") is not None:
                    turns.append({"ms": t["latency_ms"], "ttft_ms": t.get("ttft_ms"),
                                  "tokens": t.get("tokens"),
                                  "text": (t.get("content") or "")[:110]})
                    lat_all.append(t["latency_ms"])
                    if t.get("ttft_ms") is not None:
                        ttft_all.append(t["ttft_ms"])
                    if t.get("tokens") is not None:
                        tok_all.append(t["tokens"])
                    full = (t.get("content") or "").strip()
                    if full:
                        n_text += 1
                        import re as _re
                        sents = [x for x in _re.split(r"[.!?]+", full) if x.strip()]
                        if len(full.split()) > 40 or len(sents) > 2:
                            long_turns += 1
            if turns:
                lat_detail.append({"probe": str(sim.get("pid") or sim.get("probe") or "?"), "turns": turns})
        latency = None
        if lat_all:
            svals = sorted(lat_all)
            pick = lambda q: svals[min(len(svals) - 1, int(q * (len(svals) - 1)))]
            latency = {"avg_ms": round(sum(lat_all) / len(lat_all), 1),
                       "p50_ms": round(pick(0.50), 1), "p99_ms": round(pick(0.99), 1),
                       "n_turns": len(lat_all), "detail": lat_detail,
                       # TTFT — time to the FIRST token, what a caller actually waits for
                       "ttft_avg_ms": round(sum(ttft_all) / len(ttft_all), 1) if ttft_all else None,
                       "ttft_p50_ms": (lambda v: round(v[min(len(v)-1, int(0.5*(len(v)-1)))], 1))(sorted(ttft_all)) if ttft_all else None,
                       "tokens_avg": round(sum(tok_all) / len(tok_all), 1) if tok_all else None,
                       "long_turn_pct": round(100.0 * long_turns / n_text, 1) if n_text else None}
        return composite, _agg_mean("sections"), _agg_mean("metrics"), latency

    async def _deepeval_sample(self, prompt_bundle, probes, direction, best_of_n):
        # Category-DIVERSE sample: one probe per distinct category (positive, objection,
        # trust, vulnerable, channel, ...) instead of the first N in dataset order —
        # otherwise an all-positive head biases the soft judged metrics toward pleasant
        # sloppiness and away from disciplined correctness.
        seen_cats, sample = set(), []
        for pr in probes:
            cat = pr.get("category") or "uncategorized"
            if cat not in seen_cats:
                seen_cats.add(cat)
                sample.append(pr)
            if len(sample) >= 6:
                break
        for pr in probes:  # top up if fewer than 5 categories exist
            if len(sample) >= 5:
                break
            if pr not in sample:
                sample.append(pr)
        results = []
        for k, probe in enumerate(sample):
            if self._stopped:
                break
            avail = list(getattr(self.engine.tool_simulator, "enabled_tools", []) or []) \
                if self.engine.tool_simulator else []
            r = await score_probe(self.engine, self.evaluator, prompt_bundle, probe,
                                  direction=direction, n=best_of_n, available_tools=avail)
            results.append(r)
            import uuid as _uuid
            pname = str(probe.get("id") or probe.get("name") or "?")
            for ti, tr in enumerate(r.get("all_transcripts") or []):
                await self.bus.emit("sim_recorded", {
                    "run_id": self.run_id, "kind": "deepeval", "probe": pname, "idx": ti,
                    "version": self._cur_version, "ended": None,
                    "sim_uid": f"{self.run_id[:8]}-deep-{k}-{ti}-{_uuid.uuid4().hex[:6]}",
                    "transcript": tr or [],
                    "tool_calls": (r.get("all_tool_calls") or [[]])[ti] if ti < len(r.get("all_tool_calls") or []) else [],
                })
            await self.bus.emit("progress", {"run_id": self.run_id, "phase": "deepeval",
                                             "done": k + 1, "total": len(sample),
                                             "probe": pname})
        comps = [r["composite"] for r in results if r["composite"] is not None]
        composite = round(sum(comps) / len(comps), 1) if comps else None

        # Aggregate per-section / per-metric MEANS across the sampled probes so the
        # results page can render the full quality breakdown, and so that breakdown is
        # computed the same way as the composite it explains (see _agg_mean above).
        def _agg(key):
            keys = set()
            for r in results:
                keys |= set((r.get(key) or {}).keys())
            out = {}
            for k in keys:
                vals = [r[key][k] for r in results if (r.get(key) or {}).get(k) is not None]
                out[k] = round(sum(vals) / len(vals), 1) if vals else None
            # see _pooled_tool_calling: median hides real tool failures
            if key == "metrics":
                pooled = _pooled_from_probe_results(results)
                if pooled is not None or "tool_calling" in out:
                    out["tool_calling"] = pooled
            return out

        # ---- per-turn LLM latency (foundation: engage-voice-agents per-turn metrics) ----
        lat_all = []
        lat_detail = []
        tok_all = []
        ttft_all = []      # exact completion tokens per agent turn
        long_turns = 0    # verbosity: turns breaking the voice rule (>40 words / >2 sentences)
        n_text_turns = 0
        for pr, r in zip(sample, results):
            turns = []
            for t in (r.get("representative_transcript") or []):
                if t.get("role") == "agent" and t.get("latency_ms") is not None:
                    turns.append({"ms": t["latency_ms"], "ttft_ms": t.get("ttft_ms"),
                                  "tokens": t.get("tokens"),
                                  "text": (t.get("content") or "")[:110]})
                    lat_all.append(t["latency_ms"])
                    if t.get("ttft_ms") is not None:
                        ttft_all.append(t["ttft_ms"])
                    if t.get("tokens") is not None:
                        tok_all.append(t["tokens"])
                    full = (t.get("content") or "").strip()
                    if full:
                        n_text_turns += 1
                        import re as _re
                        sents = [s for s in _re.split(r"[.!?]+", full) if s.strip()]
                        if len(full.split()) > 40 or len(sents) > 2:
                            long_turns += 1
            if turns:
                lat_detail.append({"probe": str(pr.get("id") or "?"), "turns": turns})
        latency = None
        if lat_all:
            svals = sorted(lat_all)
            pick = lambda q: svals[min(len(svals) - 1, int(q * (len(svals) - 1)))]
            latency = {"avg_ms": round(sum(lat_all) / len(lat_all), 1),
                       "p50_ms": round(pick(0.50), 1), "p99_ms": round(pick(0.99), 1),
                       "n_turns": len(lat_all), "detail": lat_detail,
                       # TTFT — time to the FIRST token, what a caller actually waits for
                       "ttft_avg_ms": round(sum(ttft_all) / len(ttft_all), 1) if ttft_all else None,
                       "ttft_p50_ms": (lambda v: round(v[min(len(v)-1, int(0.5*(len(v)-1)))], 1))(sorted(ttft_all)) if ttft_all else None,
                       # verbosity = the model-tendency yapping signal (p39), computed in
                       # code from full transcripts — same idea as prompt_lab length_check.py
                       "tokens_avg": round(sum(tok_all) / len(tok_all), 1) if tok_all else None,
                       "long_turn_pct": round(100.0 * long_turns / n_text_turns, 1) if n_text_turns else None}

        return composite, results, _agg("section_scores"), _agg("metrics"), latency

    async def _dataset_grade_and_finish(self, sims0, problem_defs, denominator, sp, cfg,
                                        direction, gate_pct, config_payload, greeting,
                                        tool_checks=None):
        """GRADE stored dataset conversations + metrics + emit v0 + run_complete.
        Called by run() after generation, and by regrade() with a different judge —
        the conversations are never re-run, only the judging."""
        statuses, base_composite, base_sections, base_metrics, base_latency, _usable = \
            await self._grade_sims(sims0, problem_defs, denominator, sp, cfg, direction)
        await self.bus.emit("version_recorded", {
            "run_id": self.run_id, "version": 0, "status": "baseline", "tier": "baseline",
            "statuses": _ser(statuses), "composite": base_composite, "stress": None,
            "tool_checks": tool_checks or {},
            "section_scores": base_sections, "metrics": base_metrics, "latency": base_latency,
            "solved_pct": self._solved_pct(statuses, denominator),
            "config_json": config_payload,
            "merged_markdown": sp, "greeting": greeting,
        })
        final = "llm_complete" if self._solved_pct(statuses, denominator) >= gate_pct else "converged_below_gate"
        await self.bus.emit("run_complete", {
            "run_id": self.run_id, "status": final,
            "solved_pct": self._solved_pct(statuses, denominator), "final_version": 0, "parked": [],
        })
        return {"status": final, "solved_pct": self._solved_pct(statuses, denominator), "version": 0}

    async def _combo_finish(self, combo_results, all_sims, problem_defs, denominator,
                            gate_pct, config_payload, matrix, alloc, tool_checks):
        """Roll the per-combo scorecards into ONE run result.

        A problem counts as solved overall only if it never occurred in ANY combo — the
        pooled view is the AND of the combos, which is the same rule the gate uses. The
        gate itself requires EVERY combo to independently reach gate_pct, so one weak
        stage cannot be averaged away by five strong ones."""
        pooled = {}
        for pid in denominator:
            per = []
            for cr in combo_results:
                st = (cr["statuses"] or {}).get(pid)
                if st:
                    per.append((cr["key"], st))
            if not per:
                continue
            failing = [(k, st) for k, st in per if st.get("verdict") != "Y"]
            first = per[0][1]
            pooled[pid] = {
                "verdict": "Y" if not failing else "N",
                "passes": sum(int(st.get("passes") or 0) for _k, st in per),
                "votes": sum(int(st.get("votes") or 0) for _k, st in per),
                "evidence": (f"not observed in any of {len(per)} combos" if not failing
                             else f"occurred in {len(failing)}/{len(per)} combos: "
                                  + ", ".join(k for k, _st in failing[:4])),
                "sim_uids": [u for _k, st in (failing or per) for u in (st.get("sim_uids") or [])][:6],
                "fails": [f for _k, st in failing for f in (st.get("fails") or [])][:5],
                "by_combo": {k: st.get("verdict") for k, st in per},
            }
            if not first:
                pooled[pid]["evidence"] = "no verdict"

        scored = [cr for cr in combo_results if cr["n_sims"]]
        n_convos = sum(cr["n_sims"] for cr in scored) or 1
        def _wmean(field):
            vals = [(cr[field], cr["n_sims"]) for cr in scored
                    if isinstance(cr.get(field), (int, float))]
            return round(sum(v * w for v, w in vals) / sum(w for _v, w in vals), 1) if vals else None

        overall_pct = self._solved_pct(pooled, denominator)
        failing_combos = [cr["key"] for cr in scored if not cr["passed"]]
        # EVERY combo must pass — see docs/FORGE_COMBO_MATRIX.md
        final = "llm_complete" if (scored and not failing_combos) else "converged_below_gate"

        await self.bus.emit("version_recorded", {
            "run_id": self.run_id, "version": 0, "status": "baseline", "tier": "baseline",
            "statuses": _ser(pooled), "composite": _wmean("composite"), "stress": None,
            "tool_checks": tool_checks or {},
            "section_scores": None, "metrics": None,
            "latency": None,
            "solved_pct": overall_pct,
            "config_json": config_payload,
            "merged_markdown": None, "greeting": None,
            "combos": combo_results,
            "combo_matrix": {"stages": matrix.get("stages"), "allocation": alloc},
        })
        await self.bus.emit("run_complete", {
            "run_id": self.run_id, "status": final, "solved_pct": overall_pct,
            "final_version": 0, "parked": [],
            "failing_combos": failing_combos,
            "n_combos": len(scored), "n_conversations": n_convos,
        })
        return {"status": final, "solved_pct": overall_pct, "version": 0,
                "combos": [{"key": cr["key"], "solved_pct": cr["solved_pct"],
                            "passed": cr["passed"]} for cr in scored],
                "failing_combos": failing_combos}

    async def _grade_sims(self, sims0, problem_defs, denominator, sp, cfg, direction,
                          combo_key=None):
        """Sweep every problem for OCCURRENCE across a finished set of conversations, then
        compute the metrics from those same conversations. Returns
        (statuses, composite, sections, metrics, latency, usable). Emits no version — the
        caller decides whether this is a whole run or one combo of a cross-product."""
        # ---- 2. problem sweep over the finished conversations ----
        usable = [sim for sim in sims0
                  if any(t.get("role") == "agent" and (t.get("content") or "").strip()
                         for t in sim["transcript"])]
        convos = [(sim, fdet.transcript_to_convo(sim["transcript"])) for sim in usable]
        sweep_pids = [pid for pid in denominator
                      if pid not in METRIC_PROBLEMS and pid not in fdet.PROMPT_JUDGE_DETECTORS]
        statuses = {}
        total_checks = len(sweep_pids) * len(convos)
        done_checks = 0
        # Same reason as _grade_matrix_sims: one judge call at a time turns a dataset
        # sweep into (problems x conversations) serial LLM round-trips.
        sweep_sem = asyncio.Semaphore(DEFAULT_MAX_LLM_CONCURRENCY)

        async def _sweep_one(pid, behaviour, sim, convo):
            """-> (occurred, reason, failing_turn, unjudged, unexercised)"""
            nonlocal done_checks
            # detectors.py owns the pid -> checker mapping; the runner only asks
            # which KIND of checker is registered, so renumbering never breaks it.
            if pid in fdet.SIM_CHECKERS:
                ok, reason, fturn = fdet.SIM_CHECKERS[pid](sim, convo)
                occurred, unj, unex = not ok, 0, 0
            elif pid in fdet.MECHANICAL_CHECKERS:
                ok, reason, fturn = fdet.MECHANICAL_CHECKERS[pid](convo, None)
                occurred, unj, unex = not ok, 0, 0
            else:
                async with sweep_sem:
                    try:
                        occurred, arose, reason, fturn = await fdet.observe_problem(
                            self.judge_llm, behaviour, convo)
                        # The dataset never created the situation. Absence of evidence is
                        # not evidence of absence — this conversation proves nothing about
                        # the problem and must not be banked as a clean pass.
                        unj, unex = 0, (0 if arose else 1)
                    except fdet.JudgeError as e:
                        # NOT clean and NOT failed: this conversation was not judged.
                        occurred, reason, fturn = False, f"unjudged: {e}", None
                        unj, unex = 1, 0
            done_checks += 1
            await self.bus.emit("progress", {"run_id": self.run_id, "phase": "judging",
                                             "done": done_checks, "total": total_checks,
                                             "problem_id": pid, "combo": combo_key})
            return occurred, reason, fturn, unj, unex

        for pid in sweep_pids:
            if self._stopped:
                break
            behaviour = (problem_defs.get(pid) or {}).get("behaviour") or pid
            fails = []
            unjudged = 0          # judge unreadable — proof of nothing, counted as neither
            unexercised = 0       # the situation never arose — also proof of nothing
            swept = await asyncio.gather(
                *(_sweep_one(pid, behaviour, sim, convo) for sim, convo in convos))
            for (sim, _convo), (occurred, reason, fturn, unj, unex) in zip(convos, swept):
                unjudged += unj
                unexercised += unex
                if occurred:
                    fails.append({"sim_uid": sim["sim_uid"], "reason": reason, "failing_turn": fturn})
            # Only conversations that were judged AND actually exercised the behaviour
            # can support a "solved" verdict.
            n = len(convos) - unjudged - unexercised
            clean = max(0, n - len(fails))
            # An occurrence is proof, whatever else happened. Without one, "solved" needs
            # at least one conversation that really tested the behaviour; otherwise the
            # honest verdict is unknown, not a pass.
            verdict = "N" if fails else ("~" if n <= 0 else "Y")
            skipped = ", ".join(p for p in (
                f"{unjudged} unjudged" if unjudged else "",
                f"{unexercised} never exercised" if unexercised else "") if p)
            tail = f" ({skipped})" if skipped else ""
            why = ""
            if verdict == "~":
                why = ("never exercised — no conversation created this situation"
                       if unexercised and not unjudged
                       else f"judge unreadable on all {unjudged} conversations"
                       if unjudged and not unexercised
                       else f"no usable verdict — {skipped}")
            statuses[pid] = {
                "verdict": verdict,
                "passes": clean, "votes": n,
                "evidence": (why if verdict == "~"
                             else f"{clean}/{n} not observed in any conversation{tail}" if not fails
                             else f"{clean}/{n} — occurred in {len(fails)}: {fails[0]['reason']}{tail}"),
                "sim_uids": [f["sim_uid"] for f in fails] or [sim["sim_uid"] for sim, _c in convos[:3]],
                "fails": fails[:5],
            }
        # prompt-text problems still checked (free, no conversations)
        for pid in denominator:
            if pid in fdet.PROMPT_JUDGE_DETECTORS and pid not in statuses:
                ok, ev, _ft = await fdet._prompt_judge(self.judge_llm, sp, fdet.PROMPT_JUDGE_DETECTORS[pid])
                statuses[pid] = {"verdict": "Y" if ok else "N", "passes": 1 if ok else 0, "votes": 1,
                                 "evidence": ev, "sim_uids": [], "fails": [] if ok else
                                 [{"sim_uid": None, "reason": ev, "failing_turn": None}]}

        # ---- 3. metrics from the SAME conversations ----
        base_composite, base_sections, base_metrics, base_latency = \
            await self._deepeval_from_sims(usable, cfg, direction)
        self._fold_metrics(statuses, base_metrics, denominator)
        return (statuses, base_composite, base_sections, base_metrics, base_latency, usable)

    async def regrade(self, spec):
        """RE-JUDGE stored conversations with THIS runner's judge — zero model calls
        to the contestant. spec: {sims, problems, denominator, system_prompt,
        config_for_scorer, direction, gate_pct, config_payload, greeting}."""
        problem_defs = {p["id"]: p for p in spec.get("problems", [])}
        denominator = list(spec.get("denominator") or [])
        sims0 = [{"sim_uid": x.get("sim_uid"), "pid": None, "probe": x.get("probe"),
                  "idx": x.get("idx"), "transcript": x.get("transcript") or [],
                  "tool_calls": x.get("tool_calls") or [],
                  "fired": [t.get("name") for t in (x.get("tool_calls") or []) if t.get("name")],
                  "ended": bool(x.get("ended"))} for x in (spec.get("sims") or [])]
        await self.bus.emit("run_start", {"run_id": self.run_id, "mode": "standalone",
                                          "denominator": denominator, "n_problems": len(denominator),
                                          "regrade": True})
        return await self._dataset_grade_and_finish(
            sims0, problem_defs, denominator,
            spec.get("system_prompt") or "", spec.get("config_for_scorer") or {},
            spec.get("direction") or "outbound", float(spec.get("gate_pct", 95)),
            spec.get("config_payload") or {}, spec.get("greeting") or "",
            tool_checks=spec.get("tool_checks") or {})

    # ---- main loop ----------------------------------------------------------
    async def run(self, spec):
        mode = spec.get("mode", "standalone")
        direction = spec.get("direction", "outbound")
        lead_status = spec.get("lead_status", "fresh")
        scoring = spec.get("scoring", {})

        # ---- build probes from the dataset (authored personas, or mined-from-real) ----
        probes = list(spec.get("probes") or [])
        dataset = spec.get("dataset") or {}
        if not probes and dataset.get("kind") == "real" and dataset.get("transcripts"):
            from src.forge.miner import mine_personas
            mined = await mine_personas(self.llm, dataset["transcripts"],
                                        vertical=spec.get("vertical"),
                                        max_personas=int(dataset.get("max_personas", 25)))
            probes = mined.get("personas", [])
            await self.bus.emit("probes_ready", {"run_id": self.run_id, "probes": probes,
                                                 "source": "real", "n": len(probes)})
        elif not probes and dataset.get("personas"):
            probes = dataset["personas"]
            await self.bus.emit("probes_ready", {"run_id": self.run_id, "probes": probes,
                                                 "source": "authored", "n": len(probes)})
        best_of_n = int(scoring.get("best_of_n", 3))
        votes = int(scoring.get("votes", 3))                      # SCREEN votes (cheap)
        confirm_votes = int(scoring.get("confirm_votes", 50))     # deep-confirm sims per solved claim
        gate_pct = float(scoring.get("gate_pct", 95.0))
        stress_target = int(scoring.get("stress_target", 120))
        milestone_every = int(scoring.get("milestone_every", 2))
        max_iterations = int(scoring.get("max_iterations", 12))
        patience = int(scoring.get("plateau_patience", 3))
        margin = float(scoring.get("composite_margin", 3.0))

        # applicable problems = provided defs, filtered to has_detector + a real detector
        # (scripted OR stress-signal) + not filter_territory. Stress-only problems (e.g.
        # p18 deadlock-loop) count toward the gate via their at-scale signals.
        problem_defs = {p["id"]: p for p in spec.get("problems", [])}
        targetable = set(fdet.available_problem_ids())      # scripted detectors the coach can iterate on
        avail = targetable | fstress.SIGNAL_PIDS | set(METRIC_PROBLEMS)  # + stress- and metric-verdicted
        denominator = [pid for pid, p in problem_defs.items()
                       if p.get("has_detector") and pid in avail and not p.get("filter_territory")]

        champion = spec.get("champion")  # {blob} or {layers, override_keys}
        await self.bus.emit("run_start", {"run_id": self.run_id, "mode": mode,
                                          "denominator": denominator, "n_problems": len(denominator)})

        # ---- v0 baseline: identical full pipeline BEFORE any coaching (honest before/after) ----
        sp, cfg, greeting = self._build_prompt(mode, champion, direction, lead_status)
        bundle = {"system_prompt": sp, "config": cfg, "greeting": greeting}
        single_pass = bool(scoring.get("single_pass"))
        if single_pass:
            # DATASET MODE across the FULL CROSS-PRODUCT of call direction x lead_status.
            # Every persona is replayed in every combo; nothing is judged until all the
            # conversations of a combo finish; then every problem is checked FOR
            # OCCURRENCE inside them. Per-combo scorecards + a pooled overall, and the
            # gate requires EVERY combo to pass. See docs/FORGE_COMBO_MATRIX.md.
            import uuid as _uuid

            matrix = fcombo.build_matrix(mode, champion,
                                         default_direction=direction,
                                         default_lead_status=lead_status)
            resolved = fcombo.apply_resolutions(matrix, spec.get("combo_resolutions"))
            if resolved["blocked"]:
                # HUMAN GATE: the whole run halts. The prompt cannot serve these combos and
                # guessing would test a prompt production never sends. The human writes the
                # missing content (or rules on a fallback/skip), and it is ALSO handed to the
                # coach as a problem to fix, so the optimized prompt ends up containing it.
                await self.bus.emit("human_gate", {
                    "run_id": self.run_id, "reason": "invalid_combos",
                    "blocked": resolved["blocked"],
                    "stages": matrix["stages"],
                    "message": (f"{len(resolved['blocked'])} combo(s) cannot be served by this "
                                f"prompt. The run is halted until you rule on them."),
                })
                await self.bus.emit("run_complete", {
                    "run_id": self.run_id, "status": "needs_human_combo",
                    "solved_pct": None, "final_version": 0, "parked": [],
                })
                return {"status": "needs_human_combo", "blocked": resolved["blocked"]}

            combos = resolved["combos"]
            alloc = fcombo.plan(len(probes), len(combos))
            if alloc["capped"]:
                # never truncate silently — say exactly what was dropped
                await self.bus.emit("iteration_note", {
                    "run_id": self.run_id, "attempt": 0,
                    "note": (f"cap {alloc['cap']}: {len(combos)} combos x {len(probes)} personas "
                             f"= {len(combos) * len(probes)} conversations. Reduced to "
                             f"{alloc['per_combo']} personas per combo ({alloc['total']} total); "
                             f"{alloc['dropped']} personas dropped."),
                })
            await self.bus.emit("combo_matrix", {
                "run_id": self.run_id, "stages": matrix["stages"],
                "combos": combos, "allocation": alloc,
            })

            use_probes = probes[:alloc["per_combo"]]
            grand_total = alloc["total"]
            done_all = 0
            combo_results = []
            all_sims = []
            n_errors = 0

            # tool-capability checks run ONCE per run (prompt-level, not stage-level)
            tool_checks = {}

            for ci, combo in enumerate(combos):
                if self._stopped:
                    break
                cdir, cstatus = combo["direction"], combo["lead_status"]
                csp, ccfg, cgreeting = self._build_prompt(
                    mode, champion, cdir, cstatus,
                    greeting_override=combo.get("greeting_override"))
                if not tool_checks and scoring.get("tool_checks", True):
                    tool_checks = await self._run_tool_checks(csp, cgreeting)
                    # fix_tools defaults OFF here: single-pass is observation — an arena
                    # that silently rewrites a contestant's prompt isn't comparing LLMs.
                    if tchecks.failing(tool_checks) and scoring.get("fix_tools", False):
                        champion, tool_checks, _tf, csp, cgreeting = \
                            await self._fix_tool_calls(mode, champion, tool_checks,
                                                       csp, cgreeting, cdir, cstatus)

                await self.bus.emit("iteration_note", {
                    "run_id": self.run_id, "attempt": 0,
                    "note": (f"combo {ci + 1}/{len(combos)} — {combo['key']}: "
                             f"{len(use_probes)} conversations"),
                })

                sims_c = []
                for i2, probe in enumerate(use_probes):
                    if self._stopped:
                        break
                    # the lead block AND the greeting are synthesized per combo, so a
                    # followup call carries a follow-up reason and the agent always knows
                    # the customer's name (production substitutes <name> before speaking).
                    lead = fcombo.lead_profile(probe, cdir, cstatus)
                    sp_c, _cfg2, _g2 = self._build_prompt(
                        mode, champion, cdir, cstatus, lead=lead,
                        greeting_override=combo.get("greeting_override"))
                    scenario = {
                        "name": str(probe.get("id") or f"sim-{i2}"),
                        "greeting": fcombo.substitute_name(cgreeting or "", lead["name"]),
                        "call_direction": cdir,
                        "user_persona": probe.get("persona") or probe.get("user_persona") or "",
                        "max_turns": int(probe.get("max_turns", 10)),
                    }
                    try:
                        res = await self.engine.run_simulated(sp_c, scenario)
                    except Exception as e:
                        res = {"transcript": [{"role": "user", "content": f"[generation error: {str(e)[:100]}]"}],
                               "tool_calls": []}
                    tr = res.get("transcript") or []
                    if any("[generation error" in (t.get("content") or "") for t in tr) \
                            or not any(t.get("role") == "agent" and (t.get("content") or "").strip() for t in tr):
                        n_errors += 1
                    fired = [tc.get("name") for tc in (res.get("tool_calls") or []) if tc.get("name")]
                    sim = {"sim_uid": f"{self.run_id[:8]}-d{ci}-{i2}-{_uuid.uuid4().hex[:6]}",
                           "pid": None, "probe": scenario["name"], "idx": i2,
                           "combo": combo["key"], "direction": cdir, "lead_status": cstatus,
                           "transcript": tr, "fired": fired,
                           "tool_calls": res.get("tool_calls") or [],
                           "tool_leaks": res.get("tool_leaks") or [],
                           "expected_tools": probe.get("expected_tools") or [],
                           "ended": "end_call" in fired}
                    sims_c.append(sim)
                    all_sims.append(sim)
                    done_all += 1
                    await self.bus.emit("sim_recorded", {
                        "run_id": self.run_id, "sim_uid": sim["sim_uid"], "kind": "dataset",
                        "probe": sim["probe"], "idx": i2, "version": 0,
                        "combo": combo["key"], "direction": cdir, "lead_status": cstatus,
                        "ended": sim["ended"], "transcript": tr,
                        "tool_calls": sim["tool_calls"],
                        "tool_leaks": sim["tool_leaks"],
                        "tool_summary": self._tool_summary(sim["tool_calls"], sim["tool_leaks"],
                                                           sim.get("expected_tools")),
                    })
                    await self.bus.emit("progress", {"run_id": self.run_id, "phase": "conversations",
                                                     "done": done_all, "total": grand_total,
                                                     "combo": combo["key"], "probe": sim["probe"]})

                if grand_total >= 3 and n_errors / max(1, len(all_sims)) > 0.5:
                    first_err = next((t.get("content") for sim in all_sims for t in sim["transcript"]
                                      if "[generation error" in (t.get("content") or "")), "")
                    raise RuntimeError(f"endpoint failing: {n_errors}/{len(all_sims)} conversations errored — {str(first_err)[:180]}")

                statuses_c, comp_c, sect_c, met_c, lat_c, _usable = await self._grade_sims(
                    sims_c, problem_defs, denominator, csp, ccfg, cdir, combo_key=combo["key"])
                pct_c = self._solved_pct(statuses_c, denominator)
                combo_results.append({
                    "key": combo["key"], "direction": cdir, "lead_status": cstatus,
                    "resolution": combo.get("resolution"),
                    "n_sims": len(sims_c), "statuses": _ser(statuses_c),
                    "composite": comp_c, "section_scores": sect_c, "metrics": met_c,
                    "latency": lat_c, "solved_pct": pct_c, "passed": pct_c >= gate_pct,
                })
                await self.bus.emit("combo_scored", {
                    "run_id": self.run_id, "combo": combo["key"], "solved_pct": pct_c,
                    "composite": comp_c, "passed": pct_c >= gate_pct, "n_sims": len(sims_c),
                })

            return await self._combo_finish(
                combo_results, all_sims, problem_defs, denominator, gate_pct,
                (champion.get("layers") if mode == "layered" else {"blob": champion.get("blob")}),
                matrix, alloc, tool_checks)

        base_tool_checks = {}
        tool_fixes = []
        if scoring.get("tool_checks", True):
            base_tool_checks = await self._run_tool_checks(sp, greeting)
            # the endings lesson, generalised: a failing tool check is the cleanest fix
            # target there is — scripted situation, unambiguous action, proven lever.
            # Coach it now so the matrix and sims run against a prompt whose tools fire.
            if tchecks.failing(base_tool_checks) and scoring.get("fix_tools", True):
                champion, base_tool_checks, tool_fixes, sp, greeting = \
                    await self._fix_tool_calls(mode, champion, base_tool_checks,
                                               sp, greeting, direction, lead_status)
        statuses = await self._run_matrix(sp, greeting, denominator, votes)
        # SOLVED needs proof at scale: deep-confirm every screen-Y before it counts.
        screen_ys = [pid for pid in denominator
                     if statuses.get(pid, {}).get("verdict") == "Y" and pid in targetable]
        await self.bus.emit("iteration_note", {"run_id": self.run_id, "attempt": 0,
                            "note": f"deep-confirming {len(screen_ys)} screen-passes at {confirm_votes} sims each"})
        await self._deep_confirm(sp, greeting, statuses, screen_ys, confirm_votes)
        async def _stress_beat(done, total):
            await self.bus.emit("progress", {"run_id": self.run_id, "phase": "stress",
                                             "done": done, "total": total})

        async def _stress_sim(idx, name, res):
            import uuid as _uuid
            await self.bus.emit("sim_recorded", {
                "run_id": self.run_id, "kind": "stress", "probe": name, "idx": idx,
                "version": self._cur_version, "ended": bool(res.get("tool_calls")),
                "sim_uid": f"{self.run_id[:8]}-strs-{idx}-{_uuid.uuid4().hex[:6]}",
                "transcript": res.get("transcript") or [],
                "tool_calls": res.get("tool_calls") or [],
            })
        stress0 = await fstress.run_stress(self.engine, sp, greeting, probes, direction=direction,
                                           target=stress_target, on_progress=_stress_beat,
                                           on_sim=_stress_sim)
        self._fold_stress(statuses, stress0, problem_defs, denominator)
        base_composite, _, base_sections, base_metrics, base_latency = await self._deepeval_sample(bundle, probes, direction, best_of_n)
        self._fold_metrics(statuses, base_metrics, denominator)
        await self.bus.emit("version_recorded", {
            "run_id": self.run_id, "version": 0, "status": "baseline", "tier": "baseline",
            "statuses": _ser(statuses), "composite": base_composite, "stress": stress0.get("metrics"),
            "tool_checks": base_tool_checks, "tool_fixes": tool_fixes,
            "section_scores": base_sections, "metrics": base_metrics, "latency": base_latency,
            "solved_pct": self._solved_pct(statuses, denominator),
            # v0 carries the starting prompt so export/diff/review always have a base.
            "config_json": (champion.get("layers") if mode == "layered" else {"blob": champion.get("blob")}),
            "merged_markdown": sp, "greeting": greeting,
        })

        version = 0
        self._cur_version = 0
        consecutive_reverts = 0
        parked = set()
        park_reason = {}          # pid -> WHY it is not solved, for the report
        attempts_by_pid = {}      # pid -> how many candidate edits it has cost
        pending_regressions = {}  # pid -> problems its last fix broke, to reconcile on retry
        # A problem gets a bounded number of tries and is then retired WITH A REASON.
        # Before this, the worst-open problem was re-picked every iteration, so a run
        # could spend its entire budget failing the same fix (test 234: p1 three times,
        # breaking p20 every time) while 25 other problems were never attempted once.
        max_attempts_pp = int(scoring.get("max_attempts_per_problem", 2))
        revert_history = []
        accepts = 0
        last_targets = None
        final_status = "converged_below_gate"

        if self._solved_pct(statuses, denominator) >= gate_pct:
            final_status = "llm_complete"
        else:
            for attempt in range(1, max_iterations + 1):
                if self._stopped:
                    final_status = "stopped"
                    break
                # pick worst open problem (N before ~), skipping parked/escalated and
                # stress-only problems (the coach can only iterate on scripted detectors;
                # stress-only verdicts refresh at milestones)
                open_probs = [pid for pid in denominator
                              if statuses.get(pid, {}).get("verdict") != "Y"
                              and pid not in parked and pid in targetable]
                open_probs.sort(key=lambda pid: 0 if statuses.get(pid, {}).get("verdict") == "N" else 1)
                if not open_probs:
                    final_status = "llm_complete" if self._solved_pct(statuses, denominator) >= gate_pct \
                        else "awaiting_human" if parked else "converged_below_gate"
                    break
                # HRPO-style: cluster open problems by shared root cause so one surgical
                # edit can address the whole cluster; fall back to the single worst problem.
                targets = [open_probs[0]]
                if len(open_probs) > 1:
                    clusters = await self.coach.cluster_failures([
                        {"id": pid, "behaviour": problem_defs[pid].get("behaviour", ""),
                         "evidence": statuses.get(pid, {}).get("evidence", "")}
                        for pid in open_probs])
                    if clusters:
                        targets = clusters[0]["problem_ids"][:3]
                target = targets[0]
                # Its last attempt fixed `target` but broke these. Hand the coach BOTH so
                # it has to satisfy them together — retrying the target alone just walks
                # into the same regression (p1 "stop capitulating" vs p20 "end on a hard
                # no" are in genuine tension and must be solved as one edit).
                for reg in pending_regressions.get(target, []):
                    if reg not in targets and reg in problem_defs:
                        targets.append(reg)
                pdef = problem_defs[target]
                cluster_label = "+".join(targets)
                # patience guards against thrashing on ONE thing; moving to a new target
                # is progress, so the counter restarts with it
                if last_targets != tuple(targets):
                    consecutive_reverts = 0
                last_targets = tuple(targets)
                await self.bus.emit("iteration_start", {"run_id": self.run_id, "attempt": attempt,
                                                        "targeted_problem": cluster_label})

                # Standalone: the coach must see the SAME rendered text its replace-edits
                # will be applied against (a dict blob renders to markdown at apply time).
                coach_blob = None
                if mode != "layered":
                    b = champion.get("blob")
                    coach_blob = fmerge.render_markdown(b) if isinstance(b, dict) else b
                merged_problem = {
                    "id": cluster_label,
                    "behaviour": " | ".join(problem_defs[t].get("behaviour", "") for t in targets),
                    "evidence": " | ".join(str(statuses.get(t, {}).get("evidence", ""))[:90] for t in targets),
                    "layer_for_fix": pdef.get("layer_for_fix"),
                    "lever": (" || ".join(filter(None, (problem_defs[t].get("winning_lever") for t in targets))))[:1400],
                    # worked examples for every clustered problem; the coach budgets them
                    "references": [r for t in targets
                                   for r in (problem_defs[t].get("references") or [])],
                }
                decision = await self.coach.propose(
                    mode=mode,
                    problem=merged_problem,
                    current_prompt=coach_blob,
                    layers=(champion.get("layers") if mode == "layered" else None),
                    revert_history=revert_history,
                    # re-read EVERY iteration: the operator types into the guidance panel
                    # while the run is going, and the next proposal must already obey it
                    guidance=await self._coach_guidance(spec),
                )

                # escalation -> park the whole cluster & continue
                if decision.get("needs_human"):
                    parked.update(targets)
                    await self.bus.emit("escalation_raised", {
                        "run_id": self.run_id, "version": version, "problem_id": cluster_label,
                        "question": decision.get("escalation_question") or f"Which layer should fix '{cluster_label}'?",
                        "options": decision.get("escalation_options") or ["universal", "vertical", "campaign"],
                        "rationale": decision.get("rationale", ""),
                    })
                    continue

                # Placement audit (anti-smuggling): a campaign edit that is really a generic
                # universal/vertical-class rule goes to the human instead of being applied —
                # otherwise the write-locked shared layers get bypassed via campaign pollution.
                if mode == "layered":
                    audit = await self.coach.audit_placement(decision.get("edits"))
                    if audit and audit.get("placement") in ("universal", "vertical")                             and float(audit.get("confidence", 0) or 0) >= 0.7:
                        parked.update(targets)
                        rule_txt = "; ".join(
                            str(e.get("text") or e.get("value") or "")[:120]
                            for e in (decision.get("edits") or []) if (e.get("text") or e.get("value")))[:300]
                        await self.bus.emit("escalation_raised", {
                            "run_id": self.run_id, "version": version, "problem_id": cluster_label,
                            "question": (f"Placement audit: the coach wrote a rule that looks "
                                         f"{audit['placement']}-class: \"{rule_txt}\". Universal/vertical are "
                                         f"human-only — place it there yourself, or allow a campaign-local override?"),
                            "options": ["apply in campaign", f"hold for {audit['placement']}"],
                            "rationale": audit.get("reason", ""),
                        })
                        continue

                # GENERALISATION GUARD: an edit that quotes the probe's own words is a
                # detector fix, not a behaviour fix — it turns the row green and leaves
                # the bug for every caller who phrases it differently. Bounce it back
                # with the reason so the next attempt states the principle instead.
                leak = None
                for t in targets:
                    sc = fdet.scenario_for(t)
                    if sc and (leak := fcoach.probe_leak(decision.get("edits"), sc[0])):
                        break
                if leak:
                    consecutive_reverts += 1
                    revert_history.append({
                        "attempt": attempt, "changes": decision.get("changes_summary", ""),
                        "reason": "keyed to the test wording",
                        "detail": (f'the edit quoted the probe verbatim ("{leak}"). Write the RULE '
                                   "that covers every phrasing of this situation, never the words "
                                   "the test happens to use."),
                        "regressed": []})
                    for t in targets:
                        attempts_by_pid[t] = attempts_by_pid.get(t, 0) + 1
                        if attempts_by_pid[t] >= max_attempts_pp:
                            parked.add(t)
                            park_reason[t] = (f"{attempts_by_pid[t]} attempts, all keyed to the test "
                                              "wording rather than the underlying rule")
                    await self.bus.emit("iteration_note", {
                        "run_id": self.run_id, "attempt": attempt,
                        "note": f"rejected — edit quoted the probe verbatim (\"{leak}\")"})
                    continue

                cand, applied = self._apply_fix(mode, champion, decision)
                if applied == 0:
                    parked.update(targets)  # coach couldn't produce an applicable edit; park the cluster
                    await self.bus.emit("iteration_note", {
                        "run_id": self.run_id, "attempt": attempt,
                        "note": f"no applicable edit for {target}",
                        "coach_summary": decision.get("changes_summary", ""),
                        "coach_ops": [e.get("op") for e in (decision.get("edits") or [])],
                        "layer_for_fix": decision.get("layer_for_fix"),
                    })
                    continue

                version += 1
                self._cur_version = version
                csp, ccfg, cgreet = self._build_prompt(mode, cand, direction, lead_status)

                # CHEAP tier: targeted detector + regression on previously-solved.
                # Only scripted-detector problems can be re-tested here — stress-only ones
                # (untestable per-candidate) must not be miscounted as regressions.
                solved_before = [pid for pid in denominator
                                 if statuses.get(pid, {}).get("verdict") == "Y" and pid in targetable]
                cheap_ids = targets + solved_before
                cheap = await self._run_matrix(csp, cgreet, cheap_ids, votes)
                t_screen_ys = [t for t in targets if cheap.get(t, {}).get("verdict") == "Y"]
                target_v = "Y" if t_screen_ys else cheap.get(target, {}).get("verdict")
                regressed = [pid for pid in solved_before if cheap.get(pid, {}).get("verdict") != "Y"]

                accept = bool(t_screen_ys) and not regressed
                verify_res = None
                deep_ys = []
                if accept:
                    # the screen said Y — prove each claimed fix at scale before promotion
                    deep = {}
                    await self._deep_confirm(csp, cgreet, deep, t_screen_ys, confirm_votes)
                    deep_ys = [t for t in t_screen_ys if deep.get(t, {}).get("verdict") == "Y"]
                    for t in t_screen_ys:
                        cheap[t] = deep.get(t, cheap.get(t, {}))
                    if not deep_ys:
                        accept = False
                if accept:
                    vid = deep_ys[0]
                    verify_res = await fverify.verify_fix(
                        self.engine, csp, {"id": vid, "behaviour": problem_defs[vid].get("behaviour", "")},
                        greeting=cgreet, k=int(scoring.get("verify_k", 3)))
                    if not verify_res.get("holds"):
                        accept = False

                if not accept:
                    consecutive_reverts += 1
                    reason = "regression" if regressed else ("verify_failed" if verify_res else "no_improvement")
                    revert_history.append({"attempt": attempt, "changes": decision.get("changes_summary", ""),
                                           "reason": reason, "regressed": regressed})
                    if regressed:
                        pending_regressions[target] = regressed
                    for t in targets:
                        attempts_by_pid[t] = attempts_by_pid.get(t, 0) + 1
                        if attempts_by_pid[t] >= max_attempts_pp:
                            parked.add(t)
                            park_reason[t] = (
                                f"{attempts_by_pid[t]} fix attempts, all reverted — last one "
                                + (f"broke {', '.join(regressed)}" if regressed
                                   else "was refuted by the adversarial verifier" if verify_res
                                   else "did not move the problem"))
                    await self.bus.emit("version_recorded", {
                        "run_id": self.run_id, "version": version, "status": "reverted", "tier": "candidate",
                        "targeted_problem": cluster_label, "layer_for_fix": decision.get("layer_for_fix"),
                        "reason": reason, "regressed": regressed, "edits": decision.get("edits"),
                        "changes_summary": decision.get("changes_summary"), "verify": verify_res,
                        "diagnosis": decision.get("fix_strategy"),
                    })
                    if consecutive_reverts >= patience:
                        final_status = "converged_below_gate"
                        break
                    continue

                # ACCEPT: promote, full matrix, milestone stress, deepeval
                champion = cand
                consecutive_reverts = 0
                revert_history = []
                for t in targets:
                    pending_regressions.pop(t, None)
                accepts += 1
                new_statuses = await self._run_matrix(csp, cgreet, denominator, votes)
                # carry forward stress-only verdicts the matrix can't re-test
                for pid in denominator:
                    if pid not in new_statuses and pid in statuses:
                        new_statuses[pid] = statuses[pid]
                # any fresh screen-Y (not previously deep-confirmed) must prove itself at scale
                fresh_ys = [pid for pid in denominator if pid in targetable
                            and new_statuses.get(pid, {}).get("verdict") == "Y"
                            and not (statuses.get(pid, {}).get("verdict") == "Y"
                                     and statuses.get(pid, {}).get("votes", 0) >= 10)]
                await self._deep_confirm(csp, cgreet, new_statuses, fresh_ys, confirm_votes)
                statuses = new_statuses
                if accepts % milestone_every == 0:
                    st = await fstress.run_stress(self.engine, csp, cgreet, probes, direction=direction,
                                                  target=stress_target, on_progress=_stress_beat,
                                                  on_sim=_stress_sim)
                    self._fold_stress(statuses, st, problem_defs, denominator)
                bundle = {"system_prompt": csp, "config": ccfg, "greeting": cgreet}
                composite, _, sect_scores, metric_scores, lat_scores = await self._deepeval_sample(bundle, probes, direction, best_of_n)
                self._fold_metrics(statuses, metric_scores, denominator)

                await self.bus.emit("version_recorded", {
                    "run_id": self.run_id, "version": version, "status": "accepted", "tier": "accepted",
                    "targeted_problem": cluster_label, "layer_for_fix": decision.get("layer_for_fix"),
                    "edits": decision.get("edits"), "changes_summary": decision.get("changes_summary"),
                    "how_solved": decision.get("how_solved"), "verify": verify_res,
                    "section_scores": sect_scores, "metrics": metric_scores, "latency": lat_scores,
                    "statuses": _ser(statuses), "composite": composite,
                    "solved_pct": self._solved_pct(statuses, denominator),
                    "config_json": (champion.get("layers") if mode == "layered" else {"blob": champion.get("blob")}),
                    "merged_markdown": csp, "greeting": cgreet,
                })

                if self._solved_pct(statuses, denominator) >= gate_pct:
                    final_status = "llm_complete"
                    break

        solved_pct = self._solved_pct(statuses, denominator)
        unsolved = self._unsolved_reasons(statuses, denominator, targetable, parked, park_reason,
                                          attempts_by_pid, max_iterations)
        if final_status == "converged_below_gate" and parked:
            final_status = "awaiting_human"
        await self.bus.emit("run_complete", {
            "run_id": self.run_id, "status": final_status, "solved_pct": solved_pct,
            "final_version": version, "parked": list(parked),
            # Every problem that is not solved says WHY. A run that stops short must
            # account for the gap problem by problem, not just report a percentage.
            "unsolved": unsolved,
            "champion": (champion.get("layers") if mode == "layered" else {"blob": champion.get("blob")}),
        })
        return {"status": final_status, "solved_pct": solved_pct, "version": version,
                "unsolved": unsolved}

    @staticmethod
    def _unsolved_reasons(statuses, denominator, targetable, parked, park_reason,
                          attempts_by_pid, max_iterations):
        """One plain-language reason per unsolved problem, in priority order.

        The categories are what a human needs in order to act: `retry_budget` and
        `iteration_budget` mean spend more compute; `regression` and `refuted` mean the
        fix is genuinely hard; `not_exercised` means the DATASET is at fault, not the
        prompt; `no_detector` means we never had a way to test it here."""
        out = {}
        for pid in denominator:
            st = statuses.get(pid) or {}
            verdict = st.get("verdict")
            if verdict == "Y":
                continue
            ev = str(st.get("evidence") or "")
            if pid in park_reason:
                cat = ("regression" if "broke" in park_reason[pid]
                       else "refuted" if "refuted" in park_reason[pid] else "retry_budget")
                why = park_reason[pid]
            elif pid in parked:
                cat, why = "needs_you", "escalated to you — the coach would not decide this alone"
            elif verdict == "~" and "never exercised" in ev:
                cat, why = "not_exercised", ev
            elif verdict == "~":
                cat, why = "unknown", ev or "no usable verdict"
            elif pid not in targetable:
                cat, why = "no_detector", (ev or "no scripted detector — verdict comes from at-scale signals only")
            elif not attempts_by_pid.get(pid):
                cat, why = "iteration_budget", (
                    f"never attempted — the run used its {max_iterations}-iteration budget on "
                    "higher-priority problems. Raise max_iterations to reach this one.")
            else:
                cat, why = "in_progress", f"{attempts_by_pid[pid]} attempt(s) so far, still failing"
            out[pid] = {"verdict": verdict, "category": cat, "why": why,
                        "attempts": attempts_by_pid.get(pid, 0), "evidence": ev[:160]}
        return out

    def _fold_metrics(self, statuses, metrics, denominator):
        """Fold deepeval metric scores into problem verdicts (runs at the deepeval tier:
        baseline + accepted versions). >=85 = Y, <70 = N, between = ~. A None score
        (e.g. Faithfulness with no KB) leaves the problem untested — it then sits outside
        the solved%% only if it never gets a verdict at all."""
        rank = {"N": 0, "~": 1, "Y": 2}
        for pid, key in METRIC_PROBLEMS.items():
            if pid not in denominator:
                continue
            v = (metrics or {}).get(key)
            if v is None:
                continue
            verdict = "Y" if v >= 85 else ("N" if v < 70 else "~")
            prev = statuses.get(pid, {}).get("verdict")
            # a metric may only CONFIRM or WORSEN a scripted verdict, never upgrade it —
            # e.g. faithfulness=100 must not overrule a probe that caught invented figures.
            if prev in rank and rank[verdict] > rank[prev]:
                continue
            statuses[pid] = {"verdict": verdict, "evidence": f"deepeval {key} = {v}", "passes": 0, "votes": 0}

    def _fold_stress(self, statuses, stress_res, problem_defs, denominator):
        """Merge stress SIGNALS into statuses for problems in the denominator (Fix 4:
        discovery is independent of the coach). A stress 'N' marks the problem present."""
        for pid, sig in (stress_res.get("signals") or {}).items():
            if pid in denominator:
                # stress is authoritative for its own problems; only downgrade to N, never fake a Y
                if sig == "N":
                    statuses[pid] = {"verdict": "N", "evidence": "stress: present at scale", "passes": 0, "votes": 0}
                elif pid not in statuses:
                    statuses[pid] = {"verdict": sig, "evidence": "stress: clean", "passes": 0, "votes": 0}


def _ser(statuses):
    # keep the proof fields (votes + sim links) — the report card and ProofPanel need them
    keep = ("verdict", "evidence", "passes", "votes", "sim_uids", "fails", "source")
    return {pid: {k: v.get(k) for k in keep if v.get(k) is not None} for pid, v in statuses.items()}
