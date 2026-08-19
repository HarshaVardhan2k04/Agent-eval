# Opik (Comet) — Prompt Optimization Research Report
*(researched 2026-08-17 · full agent findings, verbatim; sources linked inline)*

## Quick facts
- License: Apache-2.0 for the WHOLE platform (server + UI + SDKs); fully self-hostable (`./opik.sh` docker compose; Helm for prod). The optimizer SDK (`opik-optimizer` v3.2.0, PyPI) needs no platform at all.
- Everything routes through LiteLLM → our self-hosted Gemma/vLLM endpoint works (`hosted_vllm/...` or `openai/...` + api_base). Three separate model roles: optimizer-reasoner, evaluated agent, judge — all can be the same model (our constraint is expressible).
- MiproOptimizer (DSPy MIPRO) was the launch optimizer; superseded and no longer in the current set.

## The six optimizers (current set, v3.2.0)
1. **MetaPromptOptimizer** — a reasoning LLM critiques + rewrites the prompt, k candidates/round (default 4), budget max_trials. ≈ our Forge coach, generalized. Pluggable `candidate_generator`. Only one with MCP tool-description optimization.
2. **HRPO (Hierarchical Reflective)** — Comet's recommended default. Per trial: evaluate → batch the FAILURES → per-batch root-cause analysis over metric `reason` strings → synthesize a hierarchy of failure modes → one surgical edit per failure mode. Needs metrics that return reasons.
3. **FewShotBayesianOptimizer** — doesn't rewrite instructions; Optuna/TPE searches WHICH and HOW MANY few-shot demonstrations (from the dataset) to embed (2–8). Complements instruction optimizers.
4. **EvolutionaryOptimizer** — DEAP genetic algorithm, population 30 × 15 generations, LLM-driven semantic crossover, optional multi-objective (score vs prompt length). The heavyweight (450+ prompt evals minimum).
5. **GepaOptimizer** — GEPA (Genetic-Pareto reflective evolution): reflection LLM mutates from minibatch outcomes; candidates survive by PARETO-FRONTIER across dataset instances (not argmax aggregate), losers cost only 2×minibatch metric calls. Documented single-turn only.
6. **ParameterOptimizer** — prompt fixed; Optuna global+local search over sampling params (temperature/top_p) + FANOVA importance. Pure local Optuna, no extra LLM machinery.

## Scoring model
- Metric = plain callable `(dataset_item, llm_output) -> float | ScoreResult(name, value, reason)`; the `reason` field is load-bearing for HRPO/GEPA. `MultiMetricObjective` composes metrics.
- 16 heuristic + 18 LLM-judge built-in metrics (incl. Hallucination, AnswerRelevance, G-Eval, LLM Juries). Judge model swappable via LiteLLM.
- Conversational eval (separate from optimizers): traces auto-group into threads; `evaluate_threads()` with ConversationalCoherence, UserFrustration, SessionCompletenessQuality, DegenerationC (cross-turn repetition), KnowledgeRetention.

## Multi-turn caveat
The optimizers are single-shot-oriented (GEPA explicitly single-turn). Multi-turn optimization only via a custom `OptimizableAgent.invoke_agent()` that runs the whole conversation and returns something scoreable — exactly the harness Forge already is.

## Verdict for Forge: don't adopt the dependency — steal 4 ideas
1. **HRPO's failure-clustering RCA (highest value):** make our metrics/detectors always emit a `reason`; add a stage before the coach: cluster failures → per-cluster root-cause analysis → one surgical edit per failure mode (instead of one holistic proposal). Fully compatible with single-Gemma.
2. **GEPA's Pareto pool + minibatch gate:** keep ALL non-dominated versions across problem-matrix cells (a version that fixes objections but dents greeting isn't discarded — it can parent later); and score each candidate on a tiny minibatch FIRST, full matrix only if it wins. Big compute saver on self-hosted Gemma.
3. **Bayesian few-shot selection (local Optuna):** search which real transcript demonstration pairs go into the campaign layer, and how many. Search is over dataset indices, not text generation — cheap.
4. **ParameterOptimizer clone:** Optuna over our vLLM sampling params (temperature/top_p) against the same problem matrix + FANOVA importances. Zero new LLM machinery.
Also worth reimplementing natively: DegenerationC + KnowledgeRetention as stress-sim metrics; the `OptimizableAgent` dict-of-named-prompts pattern maps exactly onto our universal/vertical/campaign layers.

Why not the dependency: optimizer defaults assume frontier reasoning models; our no-external-API rule; we already own the metric layer. Ideas transfer clean; the package doesn't.
