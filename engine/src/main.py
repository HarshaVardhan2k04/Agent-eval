from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.routes import router
from src.api.stt_routes import router as stt_router
from src.api.analysis_routes import router as analysis_router
from src.api.flow_routes import router as flow_router
from src.api.llm_routes import router as llm_router
from src.api.metrics_routes import router as metrics_router
from src.api.forge_routes import router as forge_router

app = FastAPI(title="Agent Eval Engine", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(stt_router)
app.include_router(analysis_router)
app.include_router(flow_router)
app.include_router(llm_router)
app.include_router(metrics_router)
app.include_router(forge_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
