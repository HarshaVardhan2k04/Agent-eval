from pydantic import BaseModel, Field


class RAGConfig(BaseModel):
    enabled: bool = False
    server_url: str = ""
    collection_name: str = ""
    search_type: str = "keyword"
    top_k: int = 3
    alpha: float = 0
    rerank: bool = False


class EvalConfig(BaseModel):
    max_iterations: int = 5
    quality_threshold: float = 0.9
    rag: RAGConfig | None = None
    tools_enabled: bool = True
    enabled_tools: list[str] | None = None
    dynamic_context_enabled: bool = False
    context_data: dict | None = None
    concurrent_scenarios: int = 4
    included_scenarios: list[str] | None = None
    excluded_scenarios: list[str] | None = None
    scenario_pass_threshold: float = 0.7
    regression_margin: float = 0.05
    plateau_patience: int = 3
    critical_sections: list[str] | None = None
    critical_tags: list[str] | None = None
    llm_base_url: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None


class EvalStartRequest(BaseModel):
    eval_id: str
    system_prompt: str
    scenarios: dict | list
    config: EvalConfig = Field(default_factory=EvalConfig)
    callback_url: str | None = None


class EvalStopRequest(BaseModel):
    eval_id: str
