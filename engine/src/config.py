import os


LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://16.112.145.206:8000/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "/models/gemma4-awq")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "EMPTY")

CALLBACK_BASE_URL = os.environ.get("CALLBACK_BASE_URL", "http://localhost:3001")

DEFAULT_MAX_ITERATIONS = 5
DEFAULT_QUALITY_THRESHOLD = 0.9
DEFAULT_CONCURRENT_SCENARIOS = 4
DEFAULT_MAX_LLM_CONCURRENCY = 8
DEFAULT_AGENT_TEMPERATURE = 0.3
DEFAULT_JUDGE_TEMPERATURE = 0.1
DEFAULT_RESOLVER_TEMPERATURE = 0.3
DEFAULT_USER_TEMPERATURE = 0.7
DEFAULT_MAX_TOKENS = 300
DEFAULT_JUDGE_MAX_TOKENS = 3000          # judge runs with thinking on, needs room to reason
DEFAULT_COACH_PATCH_MAX_TOKENS = 3000    # coach patch pass (thinking on, small edits out)
DEFAULT_RESOLVER_MAX_TOKENS = 16000      # full-rewrite escalation only (thinking off)
