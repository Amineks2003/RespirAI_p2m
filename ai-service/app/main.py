from __future__ import annotations

from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

import io
from typing import Optional

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
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


@app.post("/api/v1/spo2-lstm/predict-csv")
async def predict_spo2_lstm_csv(
    file: UploadFile = File(...),
    top_k_guidelines: int = Query(4, ge=0, le=20),
) -> dict:
    filename = (file.filename or "").lower()
    if not filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Veuillez envoyer un fichier CSV.")

    try:
        content = await file.read()
        if not content:
            raise ValueError("Le fichier CSV est vide.")
        df = pd.read_csv(io.BytesIO(content), sep=None, engine="python")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Erreur lors de la lecture du CSV : {exc}") from exc

    try:
        return model_manager.predict_spo2_lstm_csv(df, top_k_guidelines=top_k_guidelines)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/rag/rebuild")
def rebuild_rag_index() -> dict:
    try:
        return model_manager.rebuild_adaptive_rag()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/rag/status")
def rag_status() -> dict:
    return model_manager.health().get("adaptive_rag", {})


@app.get("/api/v1/rag/web-test")
def rag_web_test(query: str = Query(..., min_length=5), top_k: int = Query(4, ge=1, le=10)) -> dict:
    """Debug endpoint to verify controlled web search configuration.

    It does not affect model inference. It only confirms whether Tavily and the
    trusted-domain search are configured correctly.
    """
    rag = getattr(model_manager, "adaptive_rag", None)
    if rag is None:
        raise HTTPException(status_code=503, detail="Adaptive RAG is not available.")

    try:
        route = rag.route(query, {})
        web_query = rag._build_web_query(query, route.get("categories", []))
        results = rag.web_search.search(web_query, top_k=top_k)
        return {
            "query": query,
            "web_query": web_query,
            "route": route,
            "web_search_status": rag.web_search.status(),
            "results": results,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/v1/guidelines")
def guidelines(limit: int = Query(24, ge=1, le=200), query: Optional[str] = None) -> dict:
    return {"sources": retrieve_guidelines(query=query or "", limit=limit)}
