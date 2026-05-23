from __future__ import annotations

import base64
import io
import json
import os
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

from .adaptive_rag import AdaptiveRAGEngine
from .config import get_settings
from .model_service import ModelManager


# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
# This file is located in: ai-service/app/mcp_server.py
# parents[1] points to: ai-service/
AI_SERVICE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(AI_SERVICE_DIR / ".env", override=True)


# ---------------------------------------------------------------------------
# MCP Server
# ---------------------------------------------------------------------------
mcp = FastMCP(
    "RespirAI Multimodal MCP Server",
    instructions=(
        "Multimodal eHealth MCP server exposing AI inference and Adaptive RAG tools. "
        "Use Model 1 for CNN-BiLSTM apnea signal interpretation. "
        "Use Model 2 for LSTM SpO2 deterioration prediction from tabular CSV history. "
        "Use Adaptive RAG to generate model-aware clinical explanations grounded in uploaded guidelines."
    ),
)

settings = get_settings()
model_manager = ModelManager(settings)
rag_engine = AdaptiveRAGEngine()


def _load_runtime_once() -> None:
    """Load AI models when the MCP server process starts."""
    model_manager.load_all()


_load_runtime_once()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _strip_data_url(value: str) -> str:
    value = str(value or "").strip()
    if value.lower().startswith("data:") and "," in value:
        return value.split(",", 1)[1].strip()
    return value


def _decode_base64(value: str) -> bytes:
    value = _strip_data_url(value)
    if not value:
        return b""
    return base64.b64decode(value)


def _file_payload(filename: str, data_base64: str) -> Dict[str, str]:
    return {
        "filename": filename,
        "data_base64": _strip_data_url(data_base64),
    }


def _jsonable(value: Any) -> Any:
    """Convert NumPy / pandas / Path values to JSON-safe values."""
    try:
        import numpy as np

        if isinstance(value, np.integer):
            return int(value)
        if isinstance(value, np.floating):
            return float(value)
        if isinstance(value, np.ndarray):
            return value.tolist()
    except Exception:
        pass

    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    if isinstance(value, tuple):
        return [_jsonable(v) for v in value]
    return value


def _selected_model_family(model_key: str) -> str:
    key = str(model_key or "").strip().lower()

    if key in {"apnea", "cnn_bilstm_model.keras"} or "cnn" in key or "bilstm" in key:
        return "apnea"

    if key in {"spo2", "lstm_spo2_model.keras"} or "spo2" in key or "deterioration" in key:
        return "spo2"

    if key in {"all", "all_models", "multimodal"}:
        return "all"

    return "unknown"


def _selected_models_for_rag(model_key: str) -> List[str]:
    family = _selected_model_family(model_key)
    if family == "apnea":
        return ["apnea"]
    if family == "spo2":
        return ["spo2"]
    if family == "all":
        return ["spo2", "apnea"]
    return ["spo2", "apnea"]


def _first_spo2_last_vitals(result: Dict[str, Any]) -> Dict[str, Any]:
    rows = result.get("results") or []
    if not rows:
        return {}

    first = rows[0] or {}
    last_vitals = dict(first.get("last_vitals") or {})
    last_vitals["patient_id"] = first.get("patient_id")
    last_vitals["hour_from_admission"] = first.get("last_hour_from_admission")
    last_vitals["rows_used"] = first.get("rows_used")
    return last_vitals


def _extract_apnea_vitals(result: Dict[str, Any]) -> Dict[str, Any]:
    models = result.get("models") or {}
    apnea = models.get("apnea") or models.get("history") or {}
    return {
        "model_family": "apnea",
        "apnea_label": apnea.get("apnea_label"),
        "has_apnea": apnea.get("has_apnea"),
        "windows_analyzed": apnea.get("windows_analyzed"),
        "signal_samples": apnea.get("signal_samples"),
        "evaluation": apnea.get("evaluation"),
    }


# ---------------------------------------------------------------------------
# MCP Resources
# ---------------------------------------------------------------------------
@mcp.resource("health://models")
def models_health_resource() -> str:
    """JSON status for all AI model artifacts and runtimes."""
    return json.dumps(_jsonable(model_manager.health()), ensure_ascii=False, indent=2)


@mcp.resource("rag://status")
def rag_status_resource() -> str:
    """JSON status for the Adaptive RAG index and controlled web search."""
    return json.dumps(_jsonable(rag_engine.status()), ensure_ascii=False, indent=2)


@mcp.resource("rag://documents")
def rag_documents_resource() -> str:
    """JSON list of local PDF documents indexed by Adaptive RAG."""
    docs_dir = Path(rag_engine.index.docs_dir)
    documents: List[Dict[str, Any]] = []

    if docs_dir.exists():
        for path in sorted(docs_dir.glob("*.pdf")):
            documents.append(
                {
                    "name": path.name,
                    "path": str(path),
                    "size_bytes": path.stat().st_size,
                }
            )

    return json.dumps({"documents": documents, "count": len(documents)}, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# MCP Tools
# ---------------------------------------------------------------------------
@mcp.tool()
def health_check() -> Dict[str, Any]:
    """Check the MCP server, model runtimes, RAG index, and web-search status."""
    return _jsonable(
        {
            "server": "RespirAI Multimodal MCP Server",
            "status": "ok",
            "models": model_manager.health(),
            "rag": rag_engine.status(),
        }
    )


@mcp.tool()
def list_rag_documents() -> Dict[str, Any]:
    """List the local guideline PDFs used by Adaptive RAG."""
    docs_dir = Path(rag_engine.index.docs_dir)
    documents: List[Dict[str, Any]] = []

    if docs_dir.exists():
        for path in sorted(docs_dir.glob("*.pdf")):
            documents.append(
                {
                    "name": path.name,
                    "size_bytes": path.stat().st_size,
                }
            )

    return {"count": len(documents), "documents": documents}


@mcp.tool()
def rebuild_rag_index() -> Dict[str, Any]:
    """Rebuild the Adaptive RAG local vector index from app/rag_docs/*.pdf."""
    return _jsonable(rag_engine.rebuild_index())


@mcp.tool()
def adaptive_rag_explain_prediction(
    patient_id: str,
    model_key: str,
    risk_score: float,
    confidence: float = 0.90,
    last_vitals: Optional[Dict[str, Any]] = None,
    factors: Optional[List[Dict[str, Any]]] = None,
    question: Optional[str] = None,
    top_k: int = 6,
) -> Dict[str, Any]:
    """Generate a model-aware RAG explanation from an existing AI prediction.

    The RAG explanation is restricted to the model family:
    - apnea model => apnea/sleep-breathing interpretation
    - SpO2 model => SpO2/tabular time-series deterioration interpretation
    """
    selected_models = _selected_models_for_rag(model_key)

    rag = rag_engine.explain_prediction(
        patient_id=str(patient_id),
        risk_score=float(risk_score),
        confidence=float(confidence),
        model_name=str(model_key),
        last_vitals=last_vitals or {},
        factors=factors or [],
        selected_models=selected_models,
        top_k=int(top_k or 6),
        question=question,
    )

    return _jsonable(rag)


@mcp.tool()
def predict_spo2_deterioration_from_csv(
    csv_base64: str,
    filename: str = "patient_data.csv",
    top_k_guidelines: int = 6,
) -> Dict[str, Any]:
    """Run Model 2 · LSTM SpO2 Deterioration from a base64-encoded CSV.

    Expected CSV columns:
    patient_id, hour_from_admission, heart_rate, respiratory_rate, spo2_pct,
    systolic_bp, diastolic_bp, mobility_score, lactate, hemoglobin,
    age, gender, comorbidity_index, deterioration_next_12h.

    The target column is ignored if present.
    """
    try:
        raw = _decode_base64(csv_base64)
        if not raw:
            raise ValueError("csv_base64 is empty.")

        df = pd.read_csv(io.BytesIO(raw), sep=None, engine="python")
        result = model_manager.predict_spo2_lstm_csv(
            df,
            top_k_guidelines=int(top_k_guidelines or 6),
        )

        # Guarantee model-aware RAG for MCP clients.
        if not result.get("rag"):
            last_vitals = _first_spo2_last_vitals(result)
            rag = rag_engine.explain_prediction(
                patient_id=str(result.get("patient_id") or last_vitals.get("patient_id") or "unknown"),
                risk_score=float(result.get("risk_score") or 0.0),
                confidence=float(result.get("confidence") or 0.90),
                model_name="lstm_SPO2_model.keras",
                last_vitals=last_vitals,
                factors=result.get("factors") or [],
                selected_models=["spo2"],
                top_k=int(top_k_guidelines or 6),
                question=(
                    "Explain the LSTM SpO2 deterioration prediction using only Model 2 "
                    "tabular time-series features and SpO2 deterioration guidelines."
                ),
            )
            result["rag"] = rag
            result["explanation"] = rag.get("summary") or result.get("explanation")

        return _jsonable(result)

    except Exception as exc:
        return {
            "error": str(exc),
            "filename": filename,
            "traceback": traceback.format_exc(limit=8),
        }


@mcp.tool()
def predict_apnea_from_wfdb_files(
    apn_base64: str,
    dat_base64: str,
    hea_base64: str,
    patient_id: str = "unknown",
    apn_filename: str = "record.apn",
    dat_filename: str = "record.dat",
    hea_filename: str = "record.hea",
    top_k_guidelines: int = 6,
) -> Dict[str, Any]:
    """Run Model 1 · CNN-BiLSTM Apnea Signals from base64 WFDB files.

    Required files:
    - .apn annotations
    - .dat signal data
    - .hea header

    The Adaptive RAG output is restricted to apnea/sleep-breathing interpretation.
    """
    try:
        files = {
            "apn_file": _file_payload(apn_filename, apn_base64),
            "dat_file": _file_payload(dat_filename, dat_base64),
            "hea_file": _file_payload(hea_filename, hea_base64),
        }

        payload = {
            "patient_id": str(patient_id),
            "model": "cnn_bilstm_model.keras",
            "selected_models": ["apnea"],
            "top_k_guidelines": int(top_k_guidelines or 6),
        }

        result = model_manager.predict(payload, files=files)

        # Guarantee apnea-specific RAG for MCP clients.
        if not result.get("rag"):
            rag = rag_engine.explain_prediction(
                patient_id=str(patient_id),
                risk_score=float(result.get("risk_score") or 0.0),
                confidence=float(result.get("confidence") or 0.90),
                model_name="cnn_bilstm_model.keras",
                last_vitals=_extract_apnea_vitals(result),
                factors=result.get("factors") or [],
                selected_models=["apnea"],
                top_k=int(top_k_guidelines or 6),
                question=(
                    "Explain the CNN-BiLSTM apnea signal prediction using only apnea, "
                    "sleep-breathing, and signal-window interpretation."
                ),
            )
            result["rag"] = rag
            result["explanation"] = rag.get("summary") or result.get("explanation")

        return _jsonable(result)

    except Exception as exc:
        return {
            "error": str(exc),
            "patient_id": patient_id,
            "traceback": traceback.format_exc(limit=8),
        }


@mcp.tool()
def run_multimodal_mcp_analysis(
    patient_id: str,
    model_key: str,
    csv_base64: Optional[str] = None,
    apn_base64: Optional[str] = None,
    dat_base64: Optional[str] = None,
    hea_base64: Optional[str] = None,
    top_k_guidelines: int = 6,
) -> Dict[str, Any]:
    """MCP host-facing multimodal router.

    model_key:
    - lstm_SPO2_model.keras / spo2 => Model 2 from CSV
    - cnn_bilstm_model.keras / apnea => Model 1 from WFDB apnea files
    - all / multimodal => runs all models for which inputs are provided
    """
    family = _selected_model_family(model_key)
    outputs: Dict[str, Any] = {}

    if family == "spo2":
        if not csv_base64:
            return {"error": "csv_base64 is required for Model 2 · LSTM SpO2 Deterioration."}
        return predict_spo2_deterioration_from_csv(
            csv_base64=csv_base64,
            filename="patient_data.csv",
            top_k_guidelines=top_k_guidelines,
        )

    if family == "apnea":
        if not (apn_base64 and dat_base64 and hea_base64):
            return {"error": "apn_base64, dat_base64 and hea_base64 are required for Model 1 · CNN-BiLSTM Apnea Signals."}
        return predict_apnea_from_wfdb_files(
            apn_base64=apn_base64,
            dat_base64=dat_base64,
            hea_base64=hea_base64,
            patient_id=patient_id,
            top_k_guidelines=top_k_guidelines,
        )

    if family == "all":
        if csv_base64:
            outputs["spo2"] = predict_spo2_deterioration_from_csv(
                csv_base64=csv_base64,
                filename="patient_data.csv",
                top_k_guidelines=top_k_guidelines,
            )
        if apn_base64 and dat_base64 and hea_base64:
            outputs["apnea"] = predict_apnea_from_wfdb_files(
                apn_base64=apn_base64,
                dat_base64=dat_base64,
                hea_base64=hea_base64,
                patient_id=patient_id,
                top_k_guidelines=top_k_guidelines,
            )

        scores = [
            float(output.get("risk_score") or 0.0)
            for output in outputs.values()
            if isinstance(output, dict) and not output.get("error")
        ]

        return _jsonable(
            {
                "patient_id": patient_id,
                "mode": "multimodal_mcp",
                "models_run": list(outputs.keys()),
                "combined_risk_score": max(scores) if scores else 0.0,
                "outputs": outputs,
                "note": (
                    "MCP multimodal mode returns one model-aware RAG explanation per model. "
                    "The final clinical decision remains physician-supervised."
                ),
            }
        )

    return {
        "error": f"Unsupported model_key: {model_key}",
        "supported_model_keys": ["lstm_SPO2_model.keras", "spo2", "cnn_bilstm_model.keras", "apnea", "all"],
    }


# ---------------------------------------------------------------------------
# MCP Prompt
# ---------------------------------------------------------------------------
@mcp.prompt()
def clinical_mcp_review_prompt(model_key: str, patient_id: str = "unknown") -> str:
    """Prompt template for an external MCP host/agent."""
    return (
        f"You are an external MCP host reviewing patient {patient_id} with {model_key}. "
        "Call the relevant MCP tool. Keep the interpretation model-specific. "
        "For apnea, focus on apnea/sleep-breathing signal windows. "
        "For SpO2 LSTM, focus on CSV time-series features such as SpO2, respiratory rate, heart rate, blood pressure, lactate, hemoglobin, age, gender, and comorbidity index. "
        "Use Adaptive RAG guideline support as clinical decision support only, not as an autonomous diagnosis."
    )


def main() -> None:
    transport = os.getenv("MCP_TRANSPORT", "stdio").strip().lower()
    if transport not in {"stdio", "sse", "streamable-http"}:
        transport = "stdio"
    mcp.run(transport=transport)


if __name__ == "__main__":
    main()
