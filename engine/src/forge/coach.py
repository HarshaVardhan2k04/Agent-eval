"""Layer-aware coach — the Forge evolution of core/resolver.py.

Given the single worst OPEN problem, propose ONE surgical fix (one concern at a time). In
layered mode the coach must ROUTE the fix to the correct layer using the layer-purpose spec
(R5); when it is not confident and the fix targets a SHARED layer (universal/vertical), it
escalates to the human advisor instead of editing (park-and-continue). Shared-layer edits it
IS confident about are applied as RUN-LOCAL overlays (never mutating the shared library).

Standalone mode has no layers: the coach edits the single blob with append/prepend/replace.
"""
from __future__ import annotations

from src.config import DEFAULT_COACH_TEMPERATURE, DEFAULT_COACH_PATCH_MAX_TOKENS
from src.forge.merge import deep_merge

LAYER_PURPOSE = """LAYER PURPOSES (route each fix to the layer where it is TRUE — this governs its blast radius):
- universal : LLM speech/behaviour rules true for ANY voice agent, ANY domain, ANY client
              (e.g. never speak "?" or bullets or special characters aloud; mirror the lead's
              language; TTS hygiene; turn discipline). REUSED BY EVERY AGENT — high blast radius.
- vertical  : rules tied to ONE industry/domain, reused by every client in it
              (e.g. real-estate: say "square feet" not "sqft"; insurance: how to explain plans).
              Reused across a domain — medium blast radius. No single-company facts here.
- campaign  : everything specific to ONE client/campaign, tightly coupled, may be 100%
              client-specific (company name, offer, this campaign's conversational_flow).
              Blast radius = this campaign only — safe to edit freely."""

COACH_SYS = """You are the COACH inside Forge, an automated prompt-optimisation system for
production voice AI agents. Before you propose anything, understand your situation.

WHO YOU ARE
  A senior voice-agent prompt engineer. You do not talk to customers. You rewrite the
  system prompt that a different LLM — the "agent under test" — will use to talk to them.

WHAT THE SYSTEM AROUND YOU DOES
  1. Forge takes a prompt and runs it through many simulated phone calls: a dataset of
     lead personas, played by a second LLM, across every call direction (outbound,
     inbound, follow-up) and every lead_status stage the prompt defines.
  2. A judge LLM then sweeps those finished conversations for a catalogue of known
     failure behaviours ("problems"). A problem is SOLVED only if it never occurred in
     any conversation; one occurrence marks it failed and the conversation is the proof.
  3. You are handed the single worst OPEN problem and asked for ONE fix.
  4. Your edit is applied, the whole battery is re-run, and an adversarial verifier
     tries to REFUTE that your fix worked. If the problem recurs, or another problem
     regresses, your edit is REVERTED and you are told why.

WHY YOU EXIST
  The prompt has to survive real calls, not look good on paper. Every point of score is
  a real customer conversation that did not go wrong. A fix that games the detector but
  does not change behaviour is worse than no fix: it burns an iteration and hides the bug.

WHEN AND WHERE YOUR OUTPUT LANDS
  Your edits go into a layered prompt that MANY live agents share, or into a single
  standalone prompt. Layer choice decides blast radius, so it is a real engineering
  decision, not a formality. A human reviews everything at the end — but you are expected
  to get the prompt as close to finished as an LLM can.

HOW TO WORK
  - ONE concern per proposal. Surgical, minimal, specific. Do not rewrite wholesale.
  - Diagnose before you edit: say WHY the agent behaved that way, not just what to add.
    An instruction that repeats what the prompt already says will not change anything —
    if the rule is already there and being ignored, the fix is to make it unmissable
    (position, phrasing, concreteness), not to say it a second time.
  - Prefer a rule the agent can FOLLOW at speaking time over an abstract principle.
  - Never contradict an existing instruction without removing the one you contradict.
  - Reuse the proven lever when one is recorded — it already worked on this problem.
  - Read the reverted attempts. Repeating a dead end wastes a full battery run.
  - Honour the operator's guidance verbatim when it is given. It outranks your taste.

Reply with strict JSON only. No prose outside the JSON."""

# A reference is a passage that ALREADY WORKED on this problem. A model imitates a
# concrete example far more reliably than it follows an abstract rule, so references
# are the strongest signal we can give the coach — but they cost prompt budget, and
# they carry another client's facts. Hence a hard cap and an explicit no-copy rule.
_REF_BUDGET_CHARS = 3000
_REF_MAX = 4


def _references_block(refs):
    """Render at most _REF_MAX references inside _REF_BUDGET_CHARS.

    Good examples first (imitate this), then bad ones (avoid this) — a contrastive
    pair teaches more than either alone. Truncation is marked so the coach never
    treats a cut-off passage as a complete rule.
    """
    if not refs:
        return "  (none recorded)"
    order = {"good_example": 0, "bad_example": 1, "layer_snapshot": 2, "note": 3}
    ranked = sorted(refs, key=lambda r: order.get(r.get("kind"), 9))[:_REF_MAX]
    lines, spent = [], 0
    for r in ranked:
        body = str(r.get("body") or "").strip()
        if not body:
            continue
        room = _REF_BUDGET_CHARS - spent
        if room <= 200:
            lines.append("  … (further references omitted to stay within budget)")
            break
        if len(body) > room:
            body = body[:room].rstrip() + " …[truncated]"
        kind = r.get("kind", "note")
        verb = ("IMITATE THIS" if kind == "good_example"
                else "AVOID THIS" if kind == "bad_example" else "FOR CONTEXT")
        title = r.get("title") or kind
        src = f" (from {r['source']})" if r.get("source") else ""
        lines.append(f"  [{verb}] {title}{src}:\n  \"\"\"{body}\"\"\"")
        spent += len(body)
    return "\n".join(lines) if lines else "  (none recorded)"


_STANDALONE_TMPL = """{layer_purpose}

MODE: standalone (a single prompt blob — no layers). Edit the blob directly.

THE ONE PROBLEM TO FIX NOW:
  id: {problem_id}
  behaviour: {behaviour}
  observed: {evidence}
  proven lever (reuse if it fits): {lever}

WORKED EXAMPLES FOR THIS PROBLEM:
{references}
  How to use these: copy the STRUCTURE, PHRASING and POSITIONING that made them work.
  NEVER copy company names, places, prices or any other fact out of them — those belong
  to a different agent. If a reference conflicts with the current prompt's facts, the
  current prompt's facts win.

CURRENT PROMPT (blob):
{current_prompt}

{revert_feedback}
{guidance}
Make the SMALLEST change that fixes ONLY this problem without breaking anything else.
Return JSON:
{{
  "changes_summary": "<one line>",
  "fix_strategy": "<how this fixes it without regressions>",
  "how_solved": "<the lever, for the problem catalog>",
  "edits": [ {{"op": "append|prepend|replace", "text": "...", "find": "...", "replace": "..."}} ]
}}"""

_LAYERED_TMPL = """{layer_purpose}

MODE: layered (universal + vertical + campaign). You must decide WHICH layer this fix belongs in.
HARD RULE: only the CAMPAIGN layer is writable by you. Universal and vertical are READ-ONLY —
edited by humans only. If the right fix is universal- or vertical-class, set escalate=true and
write the exact rule you would add in escalation_question so the human can place it themselves.
Do NOT disguise a generic rule as campaign-specific to avoid escalating — campaign edits are
audited for smuggled generic rules, and misplacement is treated as a failure.

THE ONE PROBLEM TO FIX NOW:
  id: {problem_id}
  behaviour: {behaviour}
  observed: {evidence}
  catalog's suggested layer: {suggested_layer}
  proven lever (reuse if it fits): {lever}

WORKED EXAMPLES FOR THIS PROBLEM:
{references}
  How to use these: copy the STRUCTURE, PHRASING and POSITIONING that made them work.
  NEVER copy company names, places, prices or any other fact out of them — those belong
  to a different agent. If a reference conflicts with the current layers' facts, the
  current layers win.

CURRENT LAYERS (JSON):
  campaign: {campaign_json}
  universal (read-only reference): {universal_ref}
  vertical (read-only reference): {vertical_ref}

{revert_feedback}
{guidance}
Return JSON:
{{
  "layer_for_fix": "universal|vertical|campaign",
  "confidence": 0.0-1.0,
  "escalate": true|false,     // true if layer is universal/vertical AND confidence < 0.6
  "escalation_question": "<if escalate: the question for the human>",
  "escalation_options": ["universal","vertical","campaign"],
  "rationale": "<why this layer>",
  "changes_summary": "<one line>",
  "fix_strategy": "<how this fixes it without regressions>",
  "how_solved": "<the lever, for the catalog>",
  "edits": [
    {{"op": "add_bullet", "path": "rules.core_rules", "text": "..."}},
    {{"op": "set", "path": "guidelines.identity", "value": "..."}},
    {{"op": "merge", "patch": {{ }} }}
  ]
}}
edits MUST be non-empty (unless escalate=true) and MUST use ONLY the ops add_bullet | set | merge.
The ops act on the JSON of the chosen layer — add_bullet appends to a list at a dot-path,
set writes a value at a dot-path, merge deep-merges an object patch. Never emit text-diff ops
like append/replace here."""


def _guidance_block(guidance):
    """The operator's own standing instructions for this run, typed live in the side
    panel. These are not suggestions — the human running the optimisation knows things
    about this campaign the coach cannot infer from the transcripts."""
    text = (guidance or "").strip()
    if not text:
        return ""
    return ("\nOPERATOR GUIDANCE FOR THIS RUN (written by the human running it — follow it "
            "exactly; if it conflicts with your own instinct, the operator wins; if it "
            "conflicts with the problem you were asked to fix, say so in fix_strategy):\n"
            + text[:2000] + "\n")


def _revert_feedback(revert_history):
    if not revert_history:
        return ""
    lines = ["PREVIOUSLY REVERTED ATTEMPTS (do not repeat these dead ends):"]
    for h in revert_history[-5:]:
        lines.append(f"- {str(h.get('changes', ''))[:200]} (reason: {h.get('reason', '')})")
    return "\n".join(lines)


class Coach:
    def __init__(self, llm_client):
        self.llm = llm_client

    async def propose(self, *, mode, problem, current_prompt=None, layers=None,
                      revert_history=None, guidance=None):
        """Propose one fix. `problem` = {id, behaviour, evidence, layer_for_fix, lever}.
        Returns a decision dict (see per-mode template)."""
        if mode == "layered":
            return await self._propose_layered(problem, layers or {}, revert_history, guidance)
        return await self._propose_standalone(problem, current_prompt or "", revert_history, guidance)

    async def _propose_standalone(self, problem, current_prompt, revert_history, guidance=None):
        prompt = _STANDALONE_TMPL.format(
            layer_purpose=LAYER_PURPOSE,
            problem_id=problem.get("id"), behaviour=problem.get("behaviour", ""),
            evidence=problem.get("evidence", ""), lever=problem.get("lever") or "(none recorded)",
            references=_references_block(problem.get("references")),
            current_prompt=str(current_prompt)[:8000],
            revert_feedback=_revert_feedback(revert_history),
            guidance=_guidance_block(guidance),
        )
        data = await self._call(prompt)
        if not data:
            return self._noop("coach produced no valid patch")
        data.update({"layer_for_fix": "standalone", "escalate": False, "needs_human": False})
        return data

    async def _propose_layered(self, problem, layers, revert_history, guidance=None):
        import json as _json
        campaign = layers.get("campaign", {})
        prompt = _LAYERED_TMPL.format(
            layer_purpose=LAYER_PURPOSE,
            problem_id=problem.get("id"), behaviour=problem.get("behaviour", ""),
            evidence=problem.get("evidence", ""),
            suggested_layer=problem.get("layer_for_fix") or "(unknown)",
            lever=problem.get("lever") or "(none recorded)",
            references=_references_block(problem.get("references")),
            campaign_json=_json.dumps(campaign)[:6000],
            universal_ref=_json.dumps(layers.get("universal", {}))[:1500],
            vertical_ref=_json.dumps(layers.get("vertical", {}))[:1500],
            revert_feedback=_revert_feedback(revert_history),
            guidance=_guidance_block(guidance),
        )
        data = await self._call(prompt)
        if not data:
            return self._noop("coach produced no valid patch")
        layer = data.get("layer_for_fix", "campaign")
        # HARD LOCK: shared layers are human-only. Any universal/vertical proposal escalates,
        # regardless of confidence — the coach hands the human the exact rule to place.
        if layer in ("universal", "vertical") or data.get("escalate"):
            data["escalate"] = True
            data["needs_human"] = True
            if not data.get("escalation_question"):
                data["escalation_question"] = (
                    f"The coach believes this fix is {layer}-class (generic): "
                    f"{data.get('changes_summary', '')} — universal/vertical are human-edited only. "
                    f"Place it there yourself, or answer 'campaign' to allow a campaign-local override.")
        else:
            data["escalate"] = False
            data["needs_human"] = False
        return data

    async def audit_placement(self, edits):
        """Anti-smuggling guard: classify campaign-bound edit text. If it is really a
        universal- or vertical-class rule, the runner escalates instead of applying —
        otherwise the campaign layer silently accumulates generic rules that belong in
        the shared layers (and the human gate is bypassed)."""
        import json as _json
        texts = []
        for e in edits or []:
            t = e.get("text") or e.get("value") or (_json.dumps(e.get("patch")) if e.get("patch") else "")
            if t:
                texts.append(str(t)[:400])
        if not texts:
            return None
        prompt = (
            "Classify where each of these voice-agent prompt rules TRULY belongs:\n"
            "- universal: true for ANY voice agent in ANY industry for ANY client (speech habits, "
            "formatting, language mirroring, ending discipline, safety).\n"
            "- vertical: true for a whole industry but no single client (domain wording, domain objections).\n"
            "- campaign: tied to ONE client — their name, offer, flow, client-specific facts.\n\n"
            "RULES:\n" + "\n".join(f"{i+1}. {t}" for i, t in enumerate(texts)) +
            '\n\nReply JSON: {"placement": "universal|vertical|campaign", "confidence": 0.0-1.0, '
            '"reason": "<=20 words"} for the DOMINANT classification across the rules.')
        try:
            return await self.llm.chat_json(
                [{"role": "system", "content": "You are a strict prompt-architecture reviewer. JSON only."},
                 {"role": "user", "content": prompt}],
                temperature=0.0, max_tokens=300, enable_thinking=False)
        except ValueError:
            return None

    async def cluster_failures(self, problems):
        """HRPO-style root-cause clustering: group open problems that share ONE underlying
        cause so a single surgical edit can address the whole cluster."""
        import json as _json
        if len(problems) < 2:
            return None
        listing = "\n".join(
            f"- {p['id']}: {p.get('behaviour', '')} | observed: {str(p.get('evidence', ''))[:100]}"
            for p in problems)
        prompt = (
            "Group these failing voice-agent problems by shared ROOT CAUSE (problems that one "
            "prompt change could plausibly fix together). Every problem id appears in exactly one "
            "cluster; singletons are fine.\n\nPROBLEMS:\n" + listing +
            '\n\nReply JSON: {"clusters": [{"root_cause": "<one line>", "problem_ids": ["p1", ...]}]}')
        try:
            data = await self.llm.chat_json(
                [{"role": "system", "content": "You are a failure-analysis expert. JSON only."},
                 {"role": "user", "content": prompt}],
                temperature=0.0, max_tokens=800, enable_thinking=True)
        except ValueError:
            return None
        valid_ids = {p["id"] for p in problems}
        clusters = []
        for c in (data or {}).get("clusters", []):
            ids = [i for i in (c.get("problem_ids") or []) if i in valid_ids]
            if ids:
                clusters.append({"root_cause": str(c.get("root_cause", ""))[:200], "problem_ids": ids})
        return sorted(clusters, key=lambda c: -len(c["problem_ids"])) or None

    async def _call(self, prompt):
        # Pass 1: thinking ON (better reasoning). Pass 2 fallback: thinking OFF — the whole
        # token budget goes to output, which rescues truncated/malformed JSON on big prompts.
        for thinking in (True, False):
            try:
                data = await self.llm.chat_json(
                    [{"role": "system", "content": COACH_SYS}, {"role": "user", "content": prompt}],
                    temperature=DEFAULT_COACH_TEMPERATURE,
                    max_tokens=DEFAULT_COACH_PATCH_MAX_TOKENS,
                    enable_thinking=thinking,
                )
                if isinstance(data, dict) and data.get("edits"):
                    return data
                if isinstance(data, dict) and data.get("escalate"):
                    return data  # a pure escalation legitimately has no edits
            except ValueError:
                continue
        return None

    @staticmethod
    def _noop(reason):
        return {"edits": [], "changes_summary": reason, "fix_strategy": "", "how_solved": "",
                "layer_for_fix": "campaign", "escalate": False, "needs_human": False}


# --- edit application -----------------------------------------------------

def apply_standalone_edits(blob: str, edits) -> tuple[str, int]:
    applied = 0
    for e in edits or []:
        op = str(e.get("op", "")).lower()
        if op == "append" and e.get("text"):
            blob = blob.rstrip() + "\n" + e["text"]; applied += 1
        elif op == "prepend" and e.get("text"):
            blob = e["text"] + "\n" + blob.lstrip(); applied += 1
        elif op == "replace" and e.get("find") and e["find"] in blob:
            blob = blob.replace(e["find"], e.get("replace", ""), 1); applied += 1
    return blob, applied


def _set_path(obj: dict, path: str, value):
    parts = [p for p in str(path).split(".") if p]
    if not parts:
        return
    cur = obj
    for p in parts[:-1]:
        if not isinstance(cur.get(p), dict):
            cur[p] = {}
        cur = cur[p]
    cur[parts[-1]] = value


def _get_path(obj: dict, path: str):
    cur = obj
    for p in [p for p in str(path).split(".") if p]:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(p)
    return cur


def apply_layer_edits(layer_obj: dict, edits) -> tuple[dict, int]:
    """Apply coach edits to a copy of a layer's JSON. Returns (new_layer, num_applied)."""
    import copy
    out = copy.deepcopy(layer_obj or {})
    applied = 0
    for e in edits or []:
        op = str(e.get("op", "")).lower()
        if op == "merge" and isinstance(e.get("patch"), dict):
            deep_merge(out, e["patch"]); applied += 1
        elif op == "set" and e.get("path") is not None:
            _set_path(out, e["path"], e.get("value")); applied += 1
        elif op == "add_bullet" and e.get("path") and e.get("text"):
            cur = _get_path(out, e["path"])
            if isinstance(cur, list):
                cur.append(e["text"])
            else:
                _set_path(out, e["path"], [e["text"]] if cur is None else [cur, e["text"]])
            applied += 1
    return out, applied
