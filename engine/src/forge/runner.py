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

from src.llm.client import LLMClient
from src.core.conversation import ConversationEngine
from src.tools.simulator import ToolSimulator
from src.analysis.evaluator import CallEvaluator
from src.forge import merge as fmerge
from src.forge import detectors as fdet
from src.forge import stress as fstress
from src.forge import verify as fverify
from src.forge.coach import Coach, apply_standalone_edits, apply_layer_edits
from src.forge.scorer import score_probe

# deepeval-metric-verdicted problems: the metric score IS the detector.
METRIC_PROBLEMS = {"p40": "faithfulness", "p41": "self_consistency", "p42": "answer_relevancy"}


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


def _wrap(markdown, direction, lead_status):
    return (f"**LEAD INFORMATION:**\nCall Direction: {direction}\nLead Status: {lead_status}\n\n"
            f"**AGENT INSTRUCTIONS:**\n{markdown}\n\n"
            f"**CALL TRANSFER CAPABILITY:**\nTransfer to the team for a callback.")


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
            "warm_transfer_call", "search_knowledge_base",
        ]) if config.get("tools_enabled", True) else None
        self.engine = ConversationEngine(self.agent_llm, tools, None, user_llm=self.judge_llm)
        self.evaluator = CallEvaluator(self.judge_llm)
        self.coach = Coach(self.judge_llm)

    def stop(self):
        self._stopped = True

    # ---- prompt building ----------------------------------------------------
    def _build_prompt(self, mode, champion, direction, lead_status):
        """Return (system_prompt, config_for_scorer, greeting)."""
        if mode == "layered":
            rows = []
            for lt in ("universal", "vertical", "campaign"):
                layer = champion["layers"].get(lt)
                if layer:
                    rows.append({"prompt_type": lt, "prompt": layer,
                                 "override_keys": champion.get("override_keys", {}).get(lt, [])})
            addons = champion["layers"].get("addon") or []
            res = fmerge.assemble_for_forge(rows, addons, call_direction=direction, lead_status=lead_status)
            return _wrap(res["markdown"], direction, lead_status), res["merged_full"], res["greeting"]
        # standalone
        blob = champion["blob"]
        if isinstance(blob, dict):
            # a structured editable_config — render a readable system prompt, score on the dict
            md = fmerge.render_markdown(blob)
            return _wrap(md, direction, lead_status), blob, ""
        return _wrap(str(blob), direction, lead_status), {}, ""

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
                    convo, ended, meta = await fdet.drive_scenario(self.engine, system_prompt, greeting, pid)
                except Exception as e:
                    convo, ended, meta = [("A", greeting or ""), ("L", f"[generation error: {str(e)[:60]}]")], None, {}
                uid = f"{self.run_id[:8]}-{kind[:4]}-{pid}-{k}-{_uuid.uuid4().hex[:6]}"
                return {"sim_uid": uid, "pid": pid, "idx": k, "convo": convo, "ended": ended, "meta": meta}

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

    async def _grade_sims(self, system_prompt, sims, problem_ids, votes, kind):
        judge = self.judge_llm
        out = {}
        graded = 0
        total = len(sims)
        by_pid = {}
        for sim in sims:
            by_pid.setdefault(sim["pid"], []).append(sim)
        for pid, group in by_pid.items():
            if self._stopped:
                break
            results, uids, fails = [], [], []
            for sim in sorted(group, key=lambda x: x["idx"]):
                # an errored/empty conversation is UNGRADEABLE — always a fail with the
                # real reason, never a judged pass on a blank transcript.
                if (any("[generation error" in (c or "") for _r, c in sim["convo"])
                        or not any(r == "A" and (c or "").strip() for r, c in sim["convo"][1:]))                         and sim["ended"] is None:
                    ok, reason, fturn = False, "generation error — no agent reply", None
                else:
                    try:
                        ok, reason, fturn = await fdet.grade_sim(pid, sim["convo"], sim["ended"], judge,
                                                                 system_prompt=system_prompt)
                    except Exception as e:
                        ok, reason, fturn = False, f"grade_err {str(e)[:40]}", None
                results.append(bool(ok))
                uids.append(sim["sim_uid"])
                if not ok:
                    fails.append({"sim_uid": sim["sim_uid"], "reason": reason, "failing_turn": fturn})
                graded += 1
                await self.bus.emit("sims_graded", {"run_id": self.run_id, "sims": [{
                    "sim_uid": sim["sim_uid"], "verdict": "pass" if ok else "fail",
                    "reason": reason, "failing_turn": fturn}]})
                await self.bus.emit("progress", {"run_id": self.run_id, "phase": "judging",
                                                 "done": graded, "total": total, "problem_id": pid,
                                                 "verdict": "pass" if ok else "fail"})
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
                            "votes": votes, "evidence": f"{passes}/{votes} {ev}", "sim_uids": [],
                            "fails": ([] if ok else [{"sim_uid": None, "reason": ev, "failing_turn": None}])}
        return out

    async def _run_matrix(self, system_prompt, greeting, problem_ids, votes, kind="detector"):
        """Run-then-grade over the problem set: generate all conversations, then grade."""
        sims = await self._generate_sims(system_prompt, greeting, problem_ids, votes, kind)
        return await self._grade_sims(system_prompt, sims, problem_ids, votes, kind)

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
        import statistics as _st

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
            if not (sim.get("fired") or sim["ended"]) and isinstance(res.get("metrics"), dict):
                res["metrics"]["tool_calling"] = None  # nothing fired -> not judgeable
            results.append(res)
            await self.bus.emit("progress", {"run_id": self.run_id, "phase": "deepeval",
                                             "done": k + 1, "total": len(usable),
                                             "probe": str(sim.get("pid") or sim.get("probe") or "?")})
        comps = [r["composite_score"] for r in results if r.get("composite_score") is not None]
        composite = round(sum(comps) / len(comps), 1) if comps else None

        def _med(key):
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
                out[k2] = round(_st.median(vals), 1) if vals else None
            return out

        # latency straight from the stored per-turn meta
        lat_all, tok_all, lat_detail = [], [], []
        long_turns, n_text = 0, 0
        for sim in usable:
            turns = []
            tr = _rows(sim)
            for t in tr:
                if t["role"] in ("agent", "agent_end") and t.get("latency_ms") is not None:
                    turns.append({"ms": t["latency_ms"], "tokens": t.get("tokens"),
                                  "text": (t.get("content") or "")[:110]})
                    lat_all.append(t["latency_ms"])
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
                       "tokens_avg": round(sum(tok_all) / len(tok_all), 1) if tok_all else None,
                       "long_turn_pct": round(100.0 * long_turns / n_text, 1) if n_text else None}
        return composite, _med("sections"), _med("metrics"), latency

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
                })
            await self.bus.emit("progress", {"run_id": self.run_id, "phase": "deepeval",
                                             "done": k + 1, "total": len(sample),
                                             "probe": pname})
        comps = [r["composite"] for r in results if r["composite"] is not None]
        composite = round(sum(comps) / len(comps), 1) if comps else None

        # Aggregate per-section / per-metric medians across the sampled probes so the
        # results page can render the full quality breakdown, not just the composite.
        import statistics as _st

        def _agg(key):
            keys = set()
            for r in results:
                keys |= set((r.get(key) or {}).keys())
            out = {}
            for k in keys:
                vals = [r[key][k] for r in results if (r.get(key) or {}).get(k) is not None]
                out[k] = round(_st.median(vals), 1) if vals else None
            return out

        # ---- per-turn LLM latency (foundation: engage-voice-agents per-turn metrics) ----
        lat_all = []
        lat_detail = []
        tok_all = []      # exact completion tokens per agent turn
        long_turns = 0    # verbosity: turns breaking the voice rule (>40 words / >2 sentences)
        n_text_turns = 0
        for pr, r in zip(sample, results):
            turns = []
            for t in (r.get("representative_transcript") or []):
                if t.get("role") == "agent" and t.get("latency_ms") is not None:
                    turns.append({"ms": t["latency_ms"], "tokens": t.get("tokens"),
                                  "text": (t.get("content") or "")[:110]})
                    lat_all.append(t["latency_ms"])
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
                       # verbosity = the model-tendency yapping signal (p39), computed in
                       # code from full transcripts — same idea as prompt_lab length_check.py
                       "tokens_avg": round(sum(tok_all) / len(tok_all), 1) if tok_all else None,
                       "long_turn_pct": round(100.0 * long_turns / n_text_turns, 1) if n_text_turns else None}

        return composite, results, _agg("section_scores"), _agg("metrics"), latency

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
            # DATASET MODE (the user's spec, verbatim): X dataset personas -> X free
            # conversations for THIS model. Nothing is judged until all X finish. Then
            # every problem is checked FOR OCCURRENCE inside those conversations:
            # never appeared -> solved; appeared -> failed, that conversation is the proof.
            # Metrics are computed from the SAME conversations. No staged scenarios,
            # no retries, no confirmations, no stress. 4 LLMs x X = the whole fight.
            import uuid as _uuid
            X = len(probes)
            await self.bus.emit("iteration_note", {"run_id": self.run_id, "attempt": 0,
                                "note": f"dataset pass — {X} conversations, then problem sweep"})
            # ---- 1. ALL conversations first ----
            sims0 = []
            n_errors = 0
            for i2, probe in enumerate(probes):
                if self._stopped:
                    break
                scenario = {
                    "name": str(probe.get("id") or f"sim-{i2}"),
                    "greeting": greeting or "",
                    "call_direction": direction,
                    "user_persona": probe.get("persona") or probe.get("user_persona") or "",
                    "max_turns": int(probe.get("max_turns", 10)),
                }
                try:
                    res = await self.engine.run_simulated(sp, scenario)
                except Exception as e:
                    res = {"transcript": [{"role": "user", "content": f"[generation error: {str(e)[:100]}]"}],
                           "tool_calls": []}
                tr = res.get("transcript") or []
                if any("[generation error" in (t.get("content") or "") for t in tr)                         or not any(t.get("role") == "agent" and (t.get("content") or "").strip() for t in tr):
                    n_errors += 1
                fired = [tc.get("name") for tc in (res.get("tool_calls") or []) if tc.get("name")]
                sim = {"sim_uid": f"{self.run_id[:8]}-data-{i2}-{_uuid.uuid4().hex[:6]}",
                       "pid": None, "probe": scenario["name"], "idx": i2,
                       "transcript": tr, "fired": fired,
                       "ended": "end_call" in fired}
                sims0.append(sim)
                await self.bus.emit("sim_recorded", {
                    "run_id": self.run_id, "sim_uid": sim["sim_uid"], "kind": "dataset",
                    "probe": sim["probe"], "idx": i2, "version": 0,
                    "ended": sim["ended"], "transcript": tr,
                    "tool_calls": res.get("tool_calls") or [],
                })
                await self.bus.emit("progress", {"run_id": self.run_id, "phase": "conversations",
                                                 "done": i2 + 1, "total": X, "probe": sim["probe"]})
            if X >= 3 and n_errors / max(1, len(sims0)) > 0.5:
                first_err = next((t.get("content") for sim in sims0 for t in sim["transcript"]
                                  if "[generation error" in (t.get("content") or "")), "")
                raise RuntimeError(f"endpoint failing: {n_errors}/{len(sims0)} conversations errored — {str(first_err)[:180]}")

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
            for pid in sweep_pids:
                if self._stopped:
                    break
                behaviour = (problem_defs.get(pid) or {}).get("behaviour") or pid
                fails = []
                for sim, convo in convos:
                    if pid in fdet.MECHANICAL_CHECKERS:
                        ok, reason, fturn = fdet.MECHANICAL_CHECKERS[pid](convo, None)
                        occurred = not ok
                    else:
                        occurred, reason, fturn = await fdet.observe_problem(self.judge_llm, behaviour, convo)
                    if occurred:
                        fails.append({"sim_uid": sim["sim_uid"], "reason": reason, "failing_turn": fturn})
                    done_checks += 1
                    await self.bus.emit("progress", {"run_id": self.run_id, "phase": "judging",
                                                     "done": done_checks, "total": total_checks,
                                                     "problem_id": pid})
                n = len(convos)
                clean = n - len(fails)
                statuses[pid] = {
                    "verdict": "Y" if not fails else "N",
                    "passes": clean, "votes": n,
                    "evidence": (f"{clean}/{n} not observed in any conversation" if not fails
                                 else f"{clean}/{n} — occurred in {len(fails)}: {fails[0]['reason']}"),
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
            await self.bus.emit("version_recorded", {
                "run_id": self.run_id, "version": 0, "status": "baseline", "tier": "baseline",
                "statuses": _ser(statuses), "composite": base_composite, "stress": None,
                "section_scores": base_sections, "metrics": base_metrics, "latency": base_latency,
                "solved_pct": self._solved_pct(statuses, denominator),
                "config_json": (champion.get("layers") if mode == "layered" else {"blob": champion.get("blob")}),
                "merged_markdown": sp, "greeting": greeting,
            })
            final = "llm_complete" if self._solved_pct(statuses, denominator) >= gate_pct else "converged_below_gate"
            await self.bus.emit("run_complete", {
                "run_id": self.run_id, "status": final,
                "solved_pct": self._solved_pct(statuses, denominator), "final_version": 0, "parked": [],
            })
            return {"status": final, "solved_pct": self._solved_pct(statuses, denominator), "version": 0}

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
        revert_history = []
        accepts = 0
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
                pdef = problem_defs[target]
                cluster_label = "+".join(targets)
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
                }
                decision = await self.coach.propose(
                    mode=mode,
                    problem=merged_problem,
                    current_prompt=coach_blob,
                    layers=(champion.get("layers") if mode == "layered" else None),
                    revert_history=revert_history,
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
        if final_status == "converged_below_gate" and parked:
            final_status = "awaiting_human"
        await self.bus.emit("run_complete", {
            "run_id": self.run_id, "status": final_status, "solved_pct": solved_pct,
            "final_version": version, "parked": list(parked),
            "champion": (champion.get("layers") if mode == "layered" else {"blob": champion.get("blob")}),
        })
        return {"status": final_status, "solved_pct": solved_pct, "version": version}

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
    keep = ("verdict", "evidence", "passes", "votes", "sim_uids", "fails")
    return {pid: {k: v.get(k) for k in keep if v.get(k) is not None} for pid, v in statuses.items()}
