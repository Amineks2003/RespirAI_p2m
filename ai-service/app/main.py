from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .guidelines import retrieve_guidelines
from .model_service import ModelManager, model_dump
from .schemas import ManualRunRequest, PredictRequest


settings = get_settings()
model_manager = ModelManager(settings)

app = FastAPI(title="eHealth AI Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event() -> None:
    model_manager.load_all()


@app.get("/health")
def health() -> dict:
    return model_manager.health()


@app.post("/api/v1/predict")
def predict(request: PredictRequest) -> dict:
    try:
        return model_manager.predict(model_dump(request))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/explain")
def explain(request: PredictRequest) -> dict:
    try:
        payload = model_dump(request)
        payload["top_k_guidelines"] = request.top_k_guidelines
        return model_manager.predict(payload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/manual/run")
def manual_run(request: ManualRunRequest) -> dict:
    try:
        return model_manager.predict_manual(model_dump(request), request.files)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/guidelines")
def guidelines(limit: int = Query(24, ge=1, le=200), query: Optional[str] = None) -> dict:
    return {"sources": retrieve_guidelines(query=query or "", limit=limit)}

