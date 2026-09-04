import os

try:
    from dotenv import load_dotenv

    # Load engine/.env (two levels up from src/config.py). Never fails if absent.
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
except ImportError:
    pass


LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://16.112.145.206:8000/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "/models/gemma4-awq")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "EMPTY")

CALLBACK_BASE_URL = os.environ.get("CALLBACK_BASE_URL", "http://localhost:3001")

DEFAULT_MAX_ITERATIONS = 5
DEFAULT_QUALITY_THRESHOLD = 0.9
DEFAULT_CONCURRENT_SCENARIOS = 4
# Measured against the live box at 8 / 16 / 30 concurrent judge calls: all succeeded,
# but throughput plateaued (0.84 -> 0.97 -> 0.98 req/s) while per-call latency scaled
# linearly (p50 6.4s -> 11.1s -> 15.9s) — the GPU is compute-bound, not connection-bound,
# so past ~16 you mostly queue. The big win was serial -> parallel judging (8x), not
# 8 -> 30. Override with MAX_LLM_CONCURRENCY when the box is idle or bigger.
DEFAULT_MAX_LLM_CONCURRENCY = int(os.environ.get("MAX_LLM_CONCURRENCY", "16"))
DEFAULT_AGENT_TEMPERATURE = 0.0   # deterministic agent turns — a verdict shouldn't move on sampling luck
DEFAULT_JUDGE_TEMPERATURE = 0.4   # judge thinks; a little sampling room reads evidence better
DEFAULT_RESOLVER_TEMPERATURE = 0.3
# The coach REASONS about a prompt (diagnose -> route to a layer -> author a surgical
# edit); it is not the agent under test. Give it sampling room and thinking, the same
# way the judge gets them. 0.0 made it repeat the same dead-end edit after a revert.
DEFAULT_COACH_TEMPERATURE = 0.4
DEFAULT_USER_TEMPERATURE = 0.7
# The agent under test must get the SAME answer budget production gives it, or Forge
# is scoring a different model. Production's Gemma provider row is
#   {"model":"google/gemma-4-26B-A4B-it","temperature":0.7,"max_tokens":1024,...}
# (agent-server-dev migrations/20260501000000-add-gemma5090-provider.js). A tighter cap
# truncates agent turns mid-sentence, which quietly makes verbosity problems (p39)
# undetectable and manufactures abrupt endings that production would never produce.
DEFAULT_MAX_TOKENS = 1024
# Thinking burns the SAME budget as the answer. Measured: a 5-turn transcript needs
# ~400 completion tokens to think AND emit the JSON, so a 400 cap finished with
# finish_reason='length' and an object cut off mid-string, which chat_json could only
# report as a parse error. EVERY thinking judge call uses this — do not pass a small
# literal instead (the forge detectors did, and silently mis-scored every long call).
DEFAULT_JUDGE_MAX_TOKENS = 8000          # judge runs with thinking on, needs room to reason
DEFAULT_COACH_PATCH_MAX_TOKENS = 3000    # coach patch pass (thinking on, small edits out)
DEFAULT_RESOLVER_MAX_TOKENS = 16000      # full-rewrite escalation only (thinking off)

# --- STT (provider-agnostic) --------------------------------------------------
# The STT layer resolves a provider by name at request time, so the transcriber
# is swappable via env/settings alone. Provider-specific settings are namespaced
# and only read by that provider's module (nothing else imports SONIOX_*).
STT_PROVIDER = os.environ.get("STT_PROVIDER", "soniox")

# Target audio shape every provider normalizes to before scoring.
STT_TARGET_SAMPLE_RATE = 16000
STT_TARGET_CHANNELS = 1

# Soniox (one implementation; see src/stt/providers/soniox.py)
SONIOX_API_KEY = os.environ.get("SONIOX_API_KEY", "")
# Realtime WS endpoint — used for live audio.
SONIOX_STT_URL = os.environ.get("SONIOX_STT_URL", "wss://stt-rt.soniox.com/transcribe-websocket")
SONIOX_MODEL = os.environ.get("SONIOX_MODEL", "stt-rt-v4")
# Async REST endpoint — used for uploaded recordings (upload file -> batch job ->
# fetch transcript). Faster than realtime and the right tool for pre-recorded files.
SONIOX_API_URL = os.environ.get("SONIOX_API_URL", "https://api.soniox.com/v1")
SONIOX_ASYNC_MODEL = os.environ.get("SONIOX_ASYNC_MODEL", "stt-async-v5")
