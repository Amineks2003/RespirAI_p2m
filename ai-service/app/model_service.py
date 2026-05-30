from __future__ import annotations

import base64
import io
import math
import os
import shutil
import tempfile
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd

from .config import Settings
from .guidelines import retrieve_guidelines


MODEL_KEY_ALIASES = {
    "lstm_spo2_model.keras": "spo2",
    "spo2": "spo2",
    "vitals": "spo2",
    "cnn_bilstm_model.keras": "apnea",
    "apnea": "apnea",
    "history": "apnea",
    "model_best.pth": "respiratory",
    "audio": "respiratory",
    "symptoms": "respiratory",
    "respiratory": "respiratory",
    "all": "all_models",
    "all_models": "all_models",
}

FINAL_MODEL_ORDER = ["spo2", "apnea", "respiratory"]

# ---------------------------------------------------------------------------
# Model 2: LSTM SpO2 CSV inference configuration
# IMPORTANT: this order must be the same as training after dropping
# ["deterioration_next_12h", "patient_id"].
# ---------------------------------------------------------------------------
SPO2_LSTM_TARGET_COL = "deterioration_next_12h"
SPO2_LSTM_GROUP_COL = "patient_id"
SPO2_LSTM_FEATURES = [
    "hour_from_admission",
    "heart_rate",
    "respiratory_rate",
    "spo2_pct",
    "systolic_bp",
    "diastolic_bp",
    "mobility_score",
    "lactate",
    "hemoglobin",
    "age",
    "gender",
    "comorbidity_index",
]

SPO2_LSTM_COLUMN_ALIASES = {
    "patient_id": "patient_id",
    "patientid": "patient_id",
    "patient": "patient_id",
    "id_patient": "patient_id",
    "hour_from_admission": "hour_from_admission",
    "hours_from_admission": "hour_from_admission",
    "hour_from_admission_auto": "hour_from_admission",
    "age": "age",
    "gender": "gender",
    "sex": "gender",
    "comorbidity_index": "comorbidity_index",
    "comorbidity": "comorbidity_index",
    "heart_rate": "heart_rate",
    "heart_rate_bpm": "heart_rate",
    "hr": "heart_rate",
    "respiratory_rate": "respiratory_rate",
    "respiratory_rate_br_min": "respiratory_rate",
    "respiratory_rate_bpm": "respiratory_rate",
    "rr": "respiratory_rate",
    "spo2": "spo2_pct",
    "spo2_pct": "spo2_pct",
    "sp_o2": "spo2_pct",
    "systolic_bp": "systolic_bp",
    "systolic_bp_mmhg": "systolic_bp",
    "diastolic_bp": "diastolic_bp",
    "diastolic_bp_mmhg": "diastolic_bp",
    "mobility_score": "mobility_score",
    "lactate": "lactate",
    "lactate_mmol_l": "lactate",
    "hemoglobin": "hemoglobin",
    "hemoglobin_g_dl": "hemoglobin",
    "deterioration_next_12h": "deterioration_next_12h",
}

SPO2_LSTM_DEFAULTS = {
    "hour_from_admission": 0.0,
    "heart_rate": 80.0,
    "respiratory_rate": 18.0,
    "spo2_pct": 96.0,
    "systolic_bp": 120.0,
    "diastolic_bp": 80.0,
    "mobility_score": 6.0,
    "lactate": 1.2,
    "hemoglobin": 13.5,
    "age": 45.0,
    "gender": 0.5,
    "comorbidity_index": 0.0,
}


def normalize_spo2_column_name(column: str) -> str:
    value = str(column).strip().lower()
    value = value.replace("%", "")
    value = value.replace("(", "")
    value = value.replace(")", "")
    value = value.replace("/", "_")
    value = value.replace("-", "_")
    value = value.replace(" ", "_")
    while "__" in value:
        value = value.replace("__", "_")
    return value.strip("_")


def standardize_spo2_columns(df: pd.DataFrame) -> pd.DataFrame:
    rename_map = {}
    for column in df.columns:
        normalized = normalize_spo2_column_name(column)
        rename_map[column] = SPO2_LSTM_COLUMN_ALIASES.get(normalized, normalized)
    return df.rename(columns=rename_map)


def encode_spo2_gender(value: Any) -> float:
    if pd.isna(value):
        return float("nan")

    normalized = str(value).strip().upper()
    if normalized in {"F", "FEMALE", "FEMME", "0"}:
        return 0.0
    if normalized in {"M", "MALE", "HOMME", "1"}:
        return 1.0

    try:
        return float(str(value).replace(",", "."))
    except ValueError:
        return float("nan")


def clean_spo2_lstm_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Clean an uploaded CSV so it matches the training dataframe.

    Training used:
      features = group.drop([target_col, "patient_id"], axis=1).values
    Therefore the model expects exactly SPO2_LSTM_FEATURES in this order.
    """
    if df is None or df.empty:
        raise ValueError("Le fichier CSV est vide.")

    df = standardize_spo2_columns(df.copy())

    if SPO2_LSTM_TARGET_COL in df.columns:
        df = df.drop(columns=[SPO2_LSTM_TARGET_COL])

    if SPO2_LSTM_GROUP_COL not in df.columns:
        df[SPO2_LSTM_GROUP_COL] = "uploaded_patient"

    if "hour_from_admission" not in df.columns:
        df["hour_from_admission"] = np.arange(len(df), dtype=np.float32)

    missing = [column for column in SPO2_LSTM_FEATURES if column not in df.columns]
    if missing:
        raise ValueError(f"Colonnes manquantes dans le CSV : {missing}")

    df = df[[SPO2_LSTM_GROUP_COL] + SPO2_LSTM_FEATURES].copy()
    df["gender"] = df["gender"].apply(encode_spo2_gender)

    for column in SPO2_LSTM_FEATURES:
        if column == "gender":
            continue
        df[column] = (
            df[column]
            .astype(str)
            .str.replace(",", ".", regex=False)
            .str.strip()
        )
        df[column] = pd.to_numeric(df[column], errors="coerce")

    df = df.sort_values([SPO2_LSTM_GROUP_COL, "hour_from_admission"])

    # Fill missing values inside each patient's timeline first.
    df[SPO2_LSTM_FEATURES] = df.groupby(SPO2_LSTM_GROUP_COL)[SPO2_LSTM_FEATURES].transform(
        lambda series: series.ffill().bfill()
    )

    # Remaining missing values are filled by dataset medians, then safe defaults.
    medians = df[SPO2_LSTM_FEATURES].median(numeric_only=True)
    for column in SPO2_LSTM_FEATURES:
        median_value = medians.get(column, np.nan)
        default_value = SPO2_LSTM_DEFAULTS[column]
        fill_value = default_value if pd.isna(median_value) else float(median_value)
        df[column] = df[column].fillna(fill_value)

    if df[SPO2_LSTM_FEATURES].isna().any().any():
        bad_columns = df[SPO2_LSTM_FEATURES].columns[df[SPO2_LSTM_FEATURES].isna().any()].tolist()
        raise ValueError(f"Valeurs manquantes impossibles à corriger : {bad_columns}")

    return df


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    if not math.isfinite(float(value)):
        return low
    return max(low, min(high, float(value)))


def to_number(*values: Any, default: float = 0.0) -> float:
    for value in values:
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)) and math.isfinite(value):
            return float(value)
        if isinstance(value, str) and value.strip():
            try:
                parsed = float(value)
            except ValueError:
                continue
            if math.isfinite(parsed):
                return parsed
    return float(default)


def to_bool(*values: Any, default: bool = False) -> bool:
    for value in values:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"true", "1", "yes", "y", "on"}:
                return True
            if normalized in {"false", "0", "no", "n", "off"}:
                return False
    return default


def risk_label(score: float) -> str:
    if score >= 0.75:
        return "critical"
    if score >= 0.50:
        return "high"
    if score >= 0.30:
        return "moderate"
    return "low"


def percent(score: float) -> int:
    return int(round(clamp(score) * 100))


def model_dump(value: Any) -> Dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "dict"):
        return value.dict()
    return dict(value or {})


@dataclass
class RuntimeModel:
    key: str
    label: str
    filename: str
    path: Path
    framework: str
    model: Any = None
    loaded_runtime: bool = False
    load_error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def artifact_present(self) -> bool:
        return self.path.exists()

    def status(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "filename": self.filename,
            "path": str(self.path),
            "framework": self.framework,
            "artifact_present": self.artifact_present,
            "artifact_size_bytes": self.path.stat().st_size if self.artifact_present else 0,
            "runtime_loaded": self.loaded_runtime,
            "load_error": self.load_error,
            "metadata": self.metadata,
        }


class ModelManager:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.models: Dict[str, RuntimeModel] = {
            "spo2": RuntimeModel(
                key="spo2",
                label="LSTM SpO2 Model",
                filename="lstm_SPO2_model.keras",
                path=settings.models_dir / "spo2" / "lstm_SPO2_model.keras",
                framework="keras",
                metadata={"expected_input": [72, 12]},
            ),
            "apnea": RuntimeModel(
                key="apnea",
                label="CNN-BiLSTM Apnea Model",
                filename="cnn_bilstm_model.keras",
                path=settings.models_dir / "apnea" / "cnn_bilstm_model.keras",
                framework="keras",
                metadata={"expected_input": [6000, 1]},
            ),
            "respiratory": RuntimeModel(
                key="respiratory",
                label="Respiratory Sound ViT Model",
                filename="model_best.pth",
                path=settings.models_dir / "respiratory" / "model_best.pth",
                framework="pytorch",
                metadata={"expected_input": [3, 224, 224], "num_classes": 5},
            ),
        }
        self._torch = None
        self._respiratory_labels: Dict[str, int] = {}
        self.adaptive_rag = None
        self.adaptive_rag_error: Optional[str] = None
        try:
            from .adaptive_rag import AdaptiveRAGEngine
            self.adaptive_rag = AdaptiveRAGEngine()
        except Exception as exc:
            # The AI models must continue working even if the RAG index is not ready yet.
            self.adaptive_rag_error = str(exc)

    def load_all(self) -> None:
        for runtime_model in self.models.values():
            self._load_model(runtime_model)

    def rebuild_adaptive_rag(self) -> Dict[str, Any]:
        if self.adaptive_rag is None:
            try:
                from .adaptive_rag import AdaptiveRAGEngine
                self.adaptive_rag = AdaptiveRAGEngine()
                self.adaptive_rag_error = None
            except Exception as exc:
                self.adaptive_rag_error = str(exc)
                raise RuntimeError(f"Adaptive RAG unavailable: {exc}") from exc

        try:
            return self.adaptive_rag.rebuild_index()
        except Exception as exc:
            self.adaptive_rag_error = str(exc)
            raise RuntimeError(f"Adaptive RAG index rebuild failed: {exc}") from exc

    def health(self) -> Dict[str, Any]:
        rag_status = {"available": False, "error": self.adaptive_rag_error}
        if self.adaptive_rag is not None:
            try:
                rag_status = self.adaptive_rag.status()
            except Exception as exc:
                rag_status = {"available": False, "error": str(exc)}

        return {
            "status": "ok",
            "service": "ehealth-ai-service",
            "models_dir": str(self.settings.models_dir),
            "models": {key: model.status() for key, model in self.models.items()},
            "adaptive_rag": rag_status,
        }

    def _load_model(self, runtime_model: RuntimeModel) -> None:
        if not runtime_model.artifact_present:
            runtime_model.load_error = "Artifact not found."
            return

        if not self.settings.load_real_models:
            runtime_model.load_error = "Runtime loading disabled by AI_LOAD_REAL_MODELS=0."
            return

        if runtime_model.framework == "keras":
            self._load_keras(runtime_model)
        elif runtime_model.framework == "pytorch":
            self._load_torch_vit(runtime_model)

    def _load_keras(self, runtime_model: RuntimeModel) -> None:
        try:
            try:
                from tensorflow import keras  # type: ignore
            except Exception:
                import keras  # type: ignore

            runtime_model.model = keras.models.load_model(runtime_model.path, compile=False)
            runtime_model.loaded_runtime = True
            runtime_model.load_error = None
        except Exception as exc:
            runtime_model.load_error = f"Keras runtime unavailable: {exc}"

    def _load_torch_vit(self, runtime_model: RuntimeModel) -> None:
        try:
            import torch  # type: ignore
            from torch import nn  # type: ignore
        except Exception as exc:
            runtime_model.load_error = f"PyTorch runtime unavailable: {exc}"
            return

        self._torch = torch

        class PatchEmbed(nn.Module):
            def __init__(self):
                super().__init__()
                self.proj = nn.Conv2d(3, 768, kernel_size=16, stride=16)

            def forward(self, x):
                return self.proj(x).flatten(2).transpose(1, 2)

        class Attention(nn.Module):
            def __init__(self):
                super().__init__()
                self.num_heads = 12
                self.scale = (768 // 12) ** -0.5
                self.qkv = nn.Linear(768, 2304)
                self.proj = nn.Linear(768, 768)

            def forward(self, x):
                batch, tokens, channels = x.shape
                qkv = self.qkv(x).reshape(batch, tokens, 3, self.num_heads, channels // self.num_heads)
                qkv = qkv.permute(2, 0, 3, 1, 4)
                q, k, v = qkv[0], qkv[1], qkv[2]
                attn = (q @ k.transpose(-2, -1)) * self.scale
                attn = attn.softmax(dim=-1)
                x = (attn @ v).transpose(1, 2).reshape(batch, tokens, channels)
                return self.proj(x)

        class Mlp(nn.Module):
            def __init__(self):
                super().__init__()
                self.fc1 = nn.Linear(768, 3072)
                self.act = nn.GELU()
                self.fc2 = nn.Linear(3072, 768)

            def forward(self, x):
                return self.fc2(self.act(self.fc1(x)))

        class Block(nn.Module):
            def __init__(self):
                super().__init__()
                self.norm1 = nn.LayerNorm(768)
                self.attn = Attention()
                self.norm2 = nn.LayerNorm(768)
                self.mlp = Mlp()

            def forward(self, x):
                x = x + self.attn(self.norm1(x))
                x = x + self.mlp(self.norm2(x))
                return x

        class VisionTransformer(nn.Module):
            def __init__(self):
                super().__init__()
                self.cls_token = nn.Parameter(torch.zeros(1, 1, 768))
                self.pos_embed = nn.Parameter(torch.zeros(1, 197, 768))
                self.patch_embed = PatchEmbed()
                self.blocks = nn.ModuleList([Block() for _ in range(12)])
                self.norm = nn.LayerNorm(768)
                self.head = nn.Linear(768, 5)

            def forward(self, x):
                batch = x.shape[0]
                x = self.patch_embed(x)
                cls_token = self.cls_token.expand(batch, -1, -1)
                x = torch.cat((cls_token, x), dim=1)
                x = x + self.pos_embed
                for block in self.blocks:
                    x = block(x)
                x = self.norm(x)
                return self.head(x[:, 0])

        try:
            checkpoint = torch.load(runtime_model.path, map_location="cpu")
            state_dict = checkpoint.get("model_state_dict", checkpoint)
            model = VisionTransformer()
            model.load_state_dict(state_dict, strict=True)
            model.eval()
            runtime_model.model = model
            runtime_model.loaded_runtime = True
            runtime_model.load_error = None
            runtime_model.metadata["label_to_idx"] = checkpoint.get("label_to_idx", {})
            self._respiratory_labels = checkpoint.get("label_to_idx", {})
        except Exception as exc:
            runtime_model.load_error = f"PyTorch checkpoint could not be loaded: {exc}"

    def selected_models(self, raw_model: Optional[str], selected: Optional[Iterable[str]] = None) -> List[str]:
        if selected:
            normalized = [MODEL_KEY_ALIASES.get(str(item).strip().lower(), "") for item in selected]
            values = [item for item in normalized if item in FINAL_MODEL_ORDER]
            return values or FINAL_MODEL_ORDER

        normalized_model = MODEL_KEY_ALIASES.get(str(raw_model or "all_models").strip().lower(), "all_models")
        if normalized_model == "all_models":
            return FINAL_MODEL_ORDER
        if normalized_model in FINAL_MODEL_ORDER:
            return [normalized_model]
        return FINAL_MODEL_ORDER

    def predict(self, payload: Dict[str, Any], files: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        files = files or {}
        payload = dict(payload or {})
        selected = self.selected_models(payload.get("model"), payload.get("selected_models"))
        signals = self._extract_signals(payload)

        results: Dict[str, Dict[str, Any]] = {}
        if "spo2" in selected:
            results["spo2"] = self._predict_spo2(signals, payload)
        if "apnea" in selected:
            results["apnea"] = self._predict_apnea(signals, files)
        if "respiratory" in selected:
            results["respiratory"] = self._predict_respiratory(signals, files)

        fused_score = self._fuse(results)
        label = risk_label(fused_score)
        confidence = self._confidence(results)
        sources = retrieve_guidelines(
            query=self._query_from_payload(payload),
            signals=signals,
            selected_models=selected,
            limit=int(payload.get("top_k_guidelines") or 4),
        )
        factors = self._factors(signals, results, fused_score)
        rag_payload = self._build_model_specific_rag_payload(
            selected=selected,
            signals=signals,
            results=results,
            fused_score=fused_score,
        )
        adaptive_context = self._adaptive_rag_explain(
            patient_id=str(payload.get("patient_id") or signals.get("patient_id") or "unknown"),
            risk_score=fused_score,
            confidence=confidence,
            model_name=rag_payload["model_name"],
            signals=None,
            last_vitals=rag_payload["last_vitals"],
            factors=rag_payload["factors"],
            selected_models=rag_payload["selected_models"],
            top_k=int(payload.get("top_k_guidelines") or 4),
            question=rag_payload["question"],
        )
        if adaptive_context and adaptive_context.get("sources"):
            sources = adaptive_context["sources"]
        adaptive_explanation = (adaptive_context or {}).get("explanation")

        model_payload = dict(results)
        if "spo2" in results:
            model_payload["vitals"] = results["spo2"]
        if "apnea" in results:
            model_payload["history"] = results["apnea"]
        if "respiratory" in results:
            model_payload["audio"] = results["respiratory"]
            model_payload["symptoms"] = results["respiratory"]

        return {
            "patient_id": str(payload.get("patient_id") or signals.get("patient_id") or "unknown"),
            "risk_score": round(fused_score, 4),
            "risk_label": label,
            "confidence": round(confidence, 4),
            "predicted_window_hours": self._prediction_window_hours(fused_score),
            "factors": factors,
            "models": model_payload,
            "fusion": {
                "risk_score": round(fused_score, 4),
                "risk_level": label,
                "selected_models": selected,
                "strategy": "weighted_final_model_fusion",
            },
            "explanation": adaptive_explanation or self._explanation(signals, results, fused_score, sources),
            "sources": sources,
            "rag": adaptive_context or {"mode": "static_guidelines", "sources": sources},
        }

    def predict_manual(self, request_payload: Dict[str, Any], files: Any) -> Dict[str, Any]:
        files_dict = model_dump(files)
        payload = dict(request_payload.get("payload") or {})
        payload["model"] = request_payload.get("model") or payload.get("model") or "all_models"
        payload["top_k_guidelines"] = request_payload.get("top_k_guidelines") or payload.get("top_k_guidelines") or 4
        return self.predict(payload, files=files_dict)

    def predict_spo2_lstm_csv(self, df: pd.DataFrame, top_k_guidelines: int = 4) -> Dict[str, Any]:
        """Run Model 2 on an uploaded patient-history CSV.

        This method does not change Model 1 / CNN-BiLSTM apnea inference.
        It only uses the existing RuntimeModel with key="spo2".
        """
        runtime = self.models["spo2"]

        if not runtime.artifact_present:
            raise RuntimeError(f"Modèle SpO2 introuvable : {runtime.path}")
        if not runtime.loaded_runtime or runtime.model is None:
            raise RuntimeError(
                "Le modèle LSTM SpO2 n'est pas chargé. "
                f"Détail : {runtime.load_error or 'runtime indisponible'}"
            )

        cleaned_df = clean_spo2_lstm_dataframe(df)

        try:
            from tensorflow.keras.preprocessing.sequence import pad_sequences  # type: ignore
        except Exception:
            from keras.preprocessing.sequence import pad_sequences  # type: ignore

        input_shape = runtime.model.input_shape
        if isinstance(input_shape, list):
            input_shape = input_shape[0]

        if len(input_shape) < 3:
            raise RuntimeError(f"Input shape LSTM invalide : {input_shape}")

        max_len = input_shape[1]
        if max_len is None:
            max_len = int(cleaned_df.groupby(SPO2_LSTM_GROUP_COL).size().max())
        else:
            max_len = int(max_len)

        expected_features = int(input_shape[2])
        if expected_features != len(SPO2_LSTM_FEATURES):
            raise RuntimeError(
                f"Le modèle attend {expected_features} features, "
                f"mais le code fournit {len(SPO2_LSTM_FEATURES)} features : {SPO2_LSTM_FEATURES}"
            )

        x_sequences = []
        patient_ids = []
        row_counts = []
        last_hours = []
        last_vitals = []

        for patient_id, group in cleaned_df.groupby(SPO2_LSTM_GROUP_COL, sort=False):
            group = group.sort_values("hour_from_admission")
            values = group[SPO2_LSTM_FEATURES].to_numpy(dtype=np.float32)
            x_sequences.append(values)
            patient_ids.append(str(patient_id))
            row_counts.append(int(len(group)))
            last_hours.append(float(group["hour_from_admission"].iloc[-1]))
            last_vitals.append(
                {
                    "hour_from_admission": float(group["hour_from_admission"].iloc[-1]),
                    "heart_rate": float(group["heart_rate"].iloc[-1]),
                    "respiratory_rate": float(group["respiratory_rate"].iloc[-1]),
                    "spo2_pct": float(group["spo2_pct"].iloc[-1]),
                    "spo2": float(group["spo2_pct"].iloc[-1]),
                    "systolic_bp": float(group["systolic_bp"].iloc[-1]),
                    "diastolic_bp": float(group["diastolic_bp"].iloc[-1]),
                    "mobility_score": float(group["mobility_score"].iloc[-1]),
                    "lactate": float(group["lactate"].iloc[-1]),
                    "hemoglobin": float(group["hemoglobin"].iloc[-1]),
                    "age": float(group["age"].iloc[-1]),
                    "gender": float(group["gender"].iloc[-1]),
                    "comorbidity_index": float(group["comorbidity_index"].iloc[-1]),
                }
            )

        x_padded = pad_sequences(
            x_sequences,
            maxlen=max_len,
            dtype="float32",
            padding="pre",
            truncating="pre",
            value=0.0,
        )

        predictions = np.asarray(runtime.model.predict(x_padded, verbose=0))

        results = []
        probabilities = []
        for index, patient_id in enumerate(patient_ids):
            if predictions.ndim >= 3:
                probability = float(predictions[index, -1, 0])
            elif predictions.ndim == 2:
                probability = float(predictions[index, -1])
            else:
                probability = float(np.ravel(predictions)[index])

            probability = clamp(probability)
            probabilities.append(probability)
            prediction = int(probability >= 0.5)

            results.append(
                {
                    "patient_id": patient_id,
                    "rows_used": row_counts[index],
                    "last_hour_from_admission": last_hours[index],
                    "probability_deterioration": round(probability, 4),
                    "prediction": prediction,
                    "risk_label": risk_label(probability),
                    "status": "Risque de détérioration" if prediction == 1 else "Pas de détérioration détectée",
                    "last_vitals": last_vitals[index],
                }
            )

        overall_score = max(probabilities) if probabilities else 0.0
        selected_patient = results[0]["patient_id"] if len(results) == 1 else "multiple"
        sources = retrieve_guidelines(
            query="spo2 deterioration respiratory rate patient monitoring",
            selected_models=["spo2"],
            limit=max(0, int(top_k_guidelines or 0)),
        )

        model_result = self._model_result(
            runtime,
            overall_score,
            0.90 if runtime.loaded_runtime else 0.80,
            f"LSTM SpO2 CSV inference on {len(results)} patient sequence(s).",
            {
                "task": "deterioration_next_12h",
                "threshold": 0.5,
                "sequence_length_expected_by_model": max_len,
                "features_used": SPO2_LSTM_FEATURES,
                "patients_analyzed": len(results),
                "results": results,
            },
        )

        csv_factors = [
            {
                "key": "spo2_lstm_csv",
                "label": "LSTM SpO2 deterioration",
                "value": f"{percent(overall_score)}% highest predicted deterioration risk",
                "severity": risk_label(overall_score),
            }
        ]
        last_vitals_for_rag = results[0].get("last_vitals", {}) if results else {}
        adaptive_context = self._adaptive_rag_explain(
            patient_id=selected_patient,
            risk_score=overall_score,
            confidence=float(model_result["confidence"]),
            model_name="lstm_SPO2_model.keras",
            signals=None,
            last_vitals=last_vitals_for_rag,
            factors=csv_factors,
            selected_models=["spo2"],
            top_k=top_k_guidelines,
            question=(
                "Explain Model 2 LSTM SpO2 deterioration risk using only the uploaded CSV features: "
                "hour_from_admission, heart_rate, respiratory_rate, spo2_pct, blood pressure, mobility, "
                "lactate, hemoglobin, age, gender and comorbidity_index."
            ),
        )
        if adaptive_context and adaptive_context.get("sources"):
            sources = adaptive_context["sources"]
        adaptive_explanation = (adaptive_context or {}).get("explanation")

        return {
            "patient_id": selected_patient,
            "risk_score": round(overall_score, 4),
            "risk_label": risk_label(overall_score),
            "confidence": model_result["confidence"],
            "predicted_window_hours": self._prediction_window_hours(overall_score),
            "factors": csv_factors,
            "models": {
                "spo2": model_result,
                "vitals": model_result,
            },
            "fusion": {
                "risk_score": round(overall_score, 4),
                "risk_level": risk_label(overall_score),
                "selected_models": ["spo2"],
                "strategy": "single_model_spo2_lstm_csv",
            },
            "explanation": adaptive_explanation or (
                f"Model 2 LSTM SpO2 analysed {len(results)} patient sequence(s) from the CSV. "
                f"The highest predicted probability of deterioration in the next 12 hours is {percent(overall_score)}%. "
                "The decision threshold is 50%."
            ),
            "sources": sources,
            "rag": adaptive_context or {"mode": "static_guidelines", "sources": sources},
            "results": results,
            "csv_cleaning": {
                "rows_after_cleaning": int(len(cleaned_df)),
                "patients_detected": int(cleaned_df[SPO2_LSTM_GROUP_COL].nunique()),
                "target_column_removed_if_present": SPO2_LSTM_TARGET_COL,
            },
        }


    def _build_model_specific_rag_payload(
        self,
        selected: List[str],
        signals: Dict[str, Any],
        results: Dict[str, Dict[str, Any]],
        fused_score: float,
    ) -> Dict[str, Any]:
        """Return a model-specific RAG payload.

        This prevents the RAG summary from mixing Model 1 apnea logic with
        Model 2 SpO2 tabular logic. The RAG receives only the data and factors
        that belong to the selected model.
        """
        selected_set = set(selected or [])

        if selected_set == {"apnea"} and "apnea" in results:
            apnea_result = results["apnea"]
            evaluation = apnea_result.get("evaluation") or {}
            apnea_score = float(apnea_result.get("risk_score", fused_score) or fused_score)

            apnea_data = {
                "apnea_probability": round(apnea_score * 100, 2),
                "apnea_label": apnea_result.get("apnea_label") or ("apnea" if apnea_score >= 0.5 else "no_apnea"),
                "windows_analyzed": apnea_result.get("windows_analyzed"),
                "signal_samples": apnea_result.get("signal_samples"),
                "apnea_level": apnea_result.get("apnea_level"),
                "accuracy": evaluation.get("accuracy"),
                "true_apnea_rate": evaluation.get("true_apnea_rate"),
                "predicted_apnea_rate": evaluation.get("predicted_apnea_rate"),
                "total_windows": evaluation.get("total_windows"),
            }
            apnea_data = {key: value for key, value in apnea_data.items() if value is not None}

            apnea_factors = [
                {
                    "key": "cnn_bilstm_apnea",
                    "label": "CNN-BiLSTM Apnea Signal",
                    "value": f"{percent(apnea_score)}% apnea-related model output",
                    "severity": risk_label(apnea_score),
                }
            ]
            if apnea_result.get("windows_analyzed") is not None:
                apnea_factors.append(
                    {
                        "key": "windows_analyzed",
                        "label": "Signal windows analyzed",
                        "value": str(apnea_result.get("windows_analyzed")),
                        "severity": risk_label(apnea_score),
                    }
                )

            return {
                "model_name": "cnn_bilstm_model.keras",
                "selected_models": ["apnea"],
                "last_vitals": apnea_data,
                "factors": apnea_factors,
                "question": (
                    "Explain Model 1 CNN-BiLSTM apnea signal risk using only apnea/sleep-breathing "
                    "signal interpretation, uploaded .apn/.dat/.hea information, apnea windows, and respiratory monitoring context. "
                    "Do not use SpO2 deterioration, lactate, blood pressure, or sepsis interpretation."
                ),
            }

        if selected_set == {"spo2"} and "spo2" in results:
            return {
                "model_name": "lstm_SPO2_model.keras",
                "selected_models": ["spo2"],
                "last_vitals": {
                    "spo2": signals.get("spo2"),
                    "heart_rate": signals.get("heart_rate"),
                    "respiratory_rate": signals.get("respiratory_rate"),
                    "systolic_bp": signals.get("systolic_bp"),
                    "diastolic_bp": signals.get("diastolic_bp"),
                    "mobility_score": signals.get("mobility_score"),
                    "lactate": signals.get("lactate"),
                    "hemoglobin": signals.get("hemoglobin"),
                    "age": signals.get("age"),
                    "comorbidity_index": signals.get("comorbidity_index"),
                },
                "factors": [
                    {
                        "key": "spo2_lstm",
                        "label": "LSTM SpO2 deterioration",
                        "value": f"{percent(float(results['spo2'].get('risk_score', fused_score)))}% model contribution",
                        "severity": risk_label(float(results["spo2"].get("risk_score", fused_score))),
                    }
                ],
                "question": (
                    "Explain Model 2 LSTM SpO2 deterioration risk using only SpO2/tabular time-series features, "
                    "including oxygen saturation, respiratory rate, heart rate, blood pressure, mobility, lactate, hemoglobin, age and comorbidity."
                ),
            }

        if selected_set == {"respiratory"} and "respiratory" in results:
            respiratory_result = results["respiratory"]
            return {
                "model_name": "model_best.pth",
                "selected_models": ["respiratory"],
                "last_vitals": {
                    "predicted_class": respiratory_result.get("predicted_class"),
                    "wheezing": respiratory_result.get("wheezing"),
                    "cough_frequency_per_hour": respiratory_result.get("cough_frequency_per_hour"),
                    "symptom_count": respiratory_result.get("symptom_count"),
                },
                "factors": [
                    {
                        "key": "respiratory_audio",
                        "label": "Respiratory audio model",
                        "value": f"{percent(float(respiratory_result.get('risk_score', fused_score)))}% model contribution",
                        "severity": risk_label(float(respiratory_result.get("risk_score", fused_score))),
                    }
                ],
                "question": "Explain respiratory audio model output using only respiratory sound, wheeze, cough and symptom context.",
            }

        # Combined or fallback case: keep broader clinical context.
        return {
            "model_name": ", ".join(selected or ["all_models"]),
            "selected_models": selected,
            "last_vitals": {
                "spo2": signals.get("spo2"),
                "heart_rate": signals.get("heart_rate"),
                "respiratory_rate": signals.get("respiratory_rate"),
                "systolic_bp": signals.get("systolic_bp"),
                "diastolic_bp": signals.get("diastolic_bp"),
                "lactate": signals.get("lactate"),
                "hemoglobin": signals.get("hemoglobin"),
            },
            "factors": self._factors(signals, results, fused_score),
            "question": None,
        }

    def _adaptive_rag_explain(
        self,
        patient_id: str,
        risk_score: float,
        confidence: float,
        model_name: str,
        signals: Optional[Dict[str, Any]] = None,
        last_vitals: Optional[Dict[str, Any]] = None,
        factors: Optional[List[Dict[str, Any]]] = None,
        selected_models: Optional[List[str]] = None,
        top_k: int = 4,
        question: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        if self.adaptive_rag is None:
            return None

        try:
            selected_models = selected_models or []
            selected_set = set(selected_models)
            combined_vitals = dict(last_vitals or {})

            # Add generic signal values only for combined mode. For single-model
            # RAG we deliberately keep the input model-specific.
            if signals and not (selected_set == {"apnea"} or selected_set == {"spo2"} or selected_set == {"respiratory"}):
                for key in [
                    "spo2",
                    "heart_rate",
                    "respiratory_rate",
                    "systolic_bp",
                    "diastolic_bp",
                    "lactate",
                    "hemoglobin",
                ]:
                    if key not in combined_vitals and key in signals:
                        combined_vitals[key] = signals[key]

            return self.adaptive_rag.explain_prediction(
                patient_id=patient_id,
                risk_score=float(risk_score),
                confidence=float(confidence),
                model_name=model_name,
                last_vitals={key: value for key, value in combined_vitals.items() if value is not None},
                factors=factors or [],
                selected_models=selected_models,
                top_k=max(0, int(top_k or 0)),
                question=question,
            )
        except Exception as exc:
            self.adaptive_rag_error = str(exc)
            return None

    def _extract_signals(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        intake = payload.get("intake_form") or {}
        vitals = payload.get("vitals") or {}
        audio = payload.get("audio") or {}
        apnea = payload.get("apnea") or {}
        # environment payload removed — rely on intake/payload fields only
        physiology = payload.get("physiology") if isinstance(payload.get("physiology"), list) else []
        latest = physiology[-1] if physiology else {}

        cough_events = to_number(
            payload.get("cough_events"),
            intake.get("cough_events_per_hour"),
            latest.get("cough_events_per_hour"),
            audio.get("cough_frequency_per_hour"),
            default=0,
        )
        if cough_events <= 0 and to_bool(intake.get("cough"), default=False):
            cough_events = 6
        wheezing = to_bool(
            payload.get("wheeze_detected"),
            intake.get("wheezing"),
            latest.get("wheezing_detected"),
            audio.get("wheezing_detected"),
            default=False,
        )
        respiratory_rate = to_number(
            payload.get("rr"),
            payload.get("respiratory_rate"),
            intake.get("respiratory_rate"),
            vitals.get("respiration_rate"),
            apnea.get("respiration_rate"),
            latest.get("rr"),
            default=18,
        )

        symptom_values = [
            intake.get("cough"),
            intake.get("shortness_of_breath"),
            intake.get("wheezing"),
            intake.get("chest_pain"),
            intake.get("fatigue"),
        ]
        symptom_count = sum(1 for value in symptom_values if to_bool(value))
        chronic_count = sum(
            1
            for value in [
                intake.get("asthma"),
                intake.get("copd"),
                intake.get("hypertension"),
                intake.get("diabetes"),
                intake.get("heart_disease"),
            ]
            if to_bool(value)
        )

        return {
            "patient_id": payload.get("patient_id") or intake.get("patient_id"),
            "age": to_number(intake.get("age"), default=45),
            "sex": str(intake.get("sex") or intake.get("gender") or "other").lower(),
            "spo2": clamp(to_number(payload.get("spo2"), intake.get("spo2"), intake.get("spo2_pct"), vitals.get("spo2"), latest.get("spo2"), default=96), 50, 100),
            "heart_rate": clamp(to_number(payload.get("hr"), payload.get("heart_rate"), intake.get("heart_rate"), vitals.get("heart_rate"), latest.get("hr"), default=80), 20, 220),
            "respiratory_rate": clamp(respiratory_rate, 5, 80),
            "temperature": clamp(to_number(payload.get("temperature"), intake.get("temperature"), default=37), 30, 45),
            "systolic_bp": clamp(to_number(intake.get("systolic_bp"), default=120), 60, 260),
            "diastolic_bp": clamp(to_number(intake.get("diastolic_bp"), default=80), 30, 150),
            "mobility_score": clamp(to_number(intake.get("mobility_score"), default=6), 0, 10),
            "lactate": clamp(to_number(intake.get("lactate"), default=1.2), 0, 30),
            "hemoglobin": clamp(to_number(intake.get("hemoglobin"), default=13.5), 4, 22),
            "comorbidity_index": clamp(to_number(intake.get("comorbidity_index"), default=0), 0, 40),
            "cough": to_bool(intake.get("cough"), cough_events > 0, default=False),
            "shortness_of_breath": to_bool(intake.get("shortness_of_breath"), respiratory_rate >= 22, default=False),
            "wheezing": wheezing,
            "chest_pain": to_bool(intake.get("chest_pain"), default=False),
            "fatigue": to_bool(intake.get("fatigue"), default=False),
            "symptom_count": symptom_count,
            "chronic_condition_count": chronic_count,
            "cough_events": cough_events,
            "apnea_level": clamp(to_number(payload.get("apnea_level"), latest.get("apnea_level"), apnea.get("apnea_level"), default=1), 0, 10),
            "aqi": clamp(to_number(payload.get("aqi"), intake.get("air_quality_index"), default=60), 0, 500),
            "environment_temperature": clamp(to_number(intake.get("environment_temperature"), payload.get("environment_temperature"), default=24), -30, 60),
            "humidity": clamp(to_number(intake.get("humidity"), payload.get("humidity"), default=50), 0, 100),
        }

    def _predict_spo2(self, signals: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        runtime = self.models["spo2"]
        score = None
        if runtime.loaded_runtime and runtime.model is not None:
            try:
                x = self._spo2_tensor(signals, payload)
                pred = runtime.model.predict(x, verbose=0)
                score = float(np.asarray(pred).reshape(-1)[-1])
            except Exception as exc:
                runtime.load_error = f"Spo2 inference failed: {exc}"

        if score is None:
            desaturation = clamp((95 - signals["spo2"]) / 10)
            rr_stress = clamp((signals["respiratory_rate"] - 18) / 14)
            hr_stress = clamp(abs(signals["heart_rate"] - 82) / 55)
            lactate = clamp((signals["lactate"] - 2) / 8)
            score = clamp(0.50 * desaturation + 0.22 * rr_stress + 0.12 * hr_stress + 0.10 * lactate + 0.06 * clamp(signals["comorbidity_index"] / 12))

        patterns = []
        if signals["spo2"] < 92:
            patterns.append("desaturation")
        if signals["respiratory_rate"] >= 22:
            patterns.append("tachypnea")
        if signals["heart_rate"] >= 105:
            patterns.append("tachycardia")

        return self._model_result(
            runtime,
            score,
            0.90 if runtime.loaded_runtime else 0.82,
            f"SpO2 {signals['spo2']:.1f}% | HR {signals['heart_rate']:.0f} bpm | RR {signals['respiratory_rate']:.0f} br/min",
            {
                "spo2_level": round(signals["spo2"], 1),
                "heart_rate": round(signals["heart_rate"]),
                "respiration_rate": round(signals["respiratory_rate"]),
                "abnormal_patterns": patterns,
            },
        )

    def _predict_apnea(self, signals: Dict[str, Any], files: Dict[str, Any]) -> Dict[str, Any]:
        runtime = self.models["apnea"]
        wfdb_result = self._predict_apnea_wfdb(runtime, files)
        if wfdb_result is not None:
            return wfdb_result

        apnea_signal = self._apnea_tensor(signals, files)
        score = None
        if runtime.loaded_runtime and runtime.model is not None:
            try:
                pred = runtime.model.predict(apnea_signal, verbose=0)
                score = float(np.asarray(pred).reshape(-1).mean())
            except Exception as exc:
                runtime.load_error = f"Apnea inference failed: {exc}"

        if score is None:
            flat = apnea_signal.reshape(-1)
            irregularity = clamp(float(np.std(np.diff(flat))) / (float(np.std(flat)) + 1e-6) / 2)
            score = clamp(
                0.34 * clamp(signals["apnea_level"] / 10)
                + 0.24 * clamp((95 - signals["spo2"]) / 10)
                + 0.18 * irregularity
                + 0.14 * float(signals["fatigue"])
                + 0.10 * float(signals["shortness_of_breath"])
            )

        return self._model_result(
            runtime,
            score,
            0.88 if runtime.loaded_runtime else 0.80,
            f"Apnea level {signals['apnea_level']:.1f}/10 | SpO2 {signals['spo2']:.1f}% | signal window 6000 samples",
            {
                "apnea_level": round(signals["apnea_level"], 2),
                "spo2": round(signals["spo2"], 1),
                "respiration_rate": round(signals["respiratory_rate"]),
                "signal_samples": int(apnea_signal.shape[1]),
            },
        )

    def _predict_apnea_wfdb(self, runtime: RuntimeModel, files: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not runtime.loaded_runtime or runtime.model is None:
            return None

        apn_bytes = self._decode_file(files.get("apn_file"))
        dat_bytes = self._decode_file(files.get("dat_file"))
        hea_bytes = self._decode_file(files.get("hea_file"))
        if not apn_bytes or not dat_bytes or not hea_bytes:
            return None

        try:
            import wfdb  # type: ignore
        except Exception as exc:
            runtime.load_error = f"WFDB runtime unavailable: {exc}"
            return None

        temp_dir = tempfile.mkdtemp()
        try:
            hea_name = str((files.get("hea_file") or {}).get("filename") or "record.hea")
            base_name = os.path.splitext(os.path.basename(hea_name))[0] or "record"
            record_path = os.path.join(temp_dir, base_name)

            with open(record_path + ".apn", "wb") as file:
                file.write(apn_bytes)
            with open(record_path + ".dat", "wb") as file:
                file.write(dat_bytes)
            with open(record_path + ".hea", "wb") as file:
                file.write(hea_bytes)

            record = wfdb.rdrecord(record_path)
            signal = np.asarray(record.p_signal[:, 0], dtype=np.float32)
            ann = wfdb.rdann(record_path, "apn")
            true_labels = np.array([1 if symbol == "A" else 0 for symbol in ann.symbol], dtype=np.int32)

            x_values, y_true = self._prepare_apnea_windows(signal, true_labels)
            if len(x_values) == 0:
                return self._model_result(
                    runtime,
                    0.0,
                    0.0,
                    "No valid 60-second ECG windows found.",
                    {
                        "label": "unknown",
                        "has_apnea": False,
                        "windows_analyzed": 0,
                        "evaluation": {
                            "accuracy": 0.0,
                            "true_apnea_rate": 0.0,
                            "predicted_apnea_rate": 0.0,
                            "true_apnea_windows": 0,
                            "predicted_apnea_windows": 0,
                            "total_windows": 0,
                        },
                    },
                )

            x_values = self._match_apnea_model_input_shape(x_values, runtime.model)
            preds = runtime.model.predict(x_values, verbose=0)
            preds = np.ravel(preds)
            y_pred = (preds >= 0.5).astype(int)

            apnea_probability = float(np.mean(preds))
            apnea_score = apnea_probability * 100
            has_apnea = apnea_probability >= 0.5
            accuracy = float(np.mean(y_pred == y_true)) * 100
            true_apnea_rate = float(np.mean(y_true)) * 100
            predicted_apnea_rate = float(np.mean(y_pred)) * 100
            confidence = apnea_probability if has_apnea else 1 - apnea_probability

            return self._model_result(
                runtime,
                apnea_probability,
                confidence,
                (
                    f"Analyzed {len(x_values)} ECG windows. "
                    f"Predicted apnea probability: {apnea_score:.1f}%. "
                    f"Ground-truth apnea rate from .apn: {true_apnea_rate:.1f}%. "
                    f"Window-level accuracy: {accuracy:.1f}%."
                ),
                {
                    "apnea_label": "apnea" if has_apnea else "no_apnea",
                    "has_apnea": bool(has_apnea),
                    "windows_analyzed": int(len(x_values)),
                    "evaluation": {
                        "accuracy": round(accuracy, 1),
                        "true_apnea_rate": round(true_apnea_rate, 1),
                        "predicted_apnea_rate": round(predicted_apnea_rate, 1),
                        "true_apnea_windows": int(np.sum(y_true)),
                        "predicted_apnea_windows": int(np.sum(y_pred)),
                        "total_windows": int(len(y_true)),
                    },
                },
            )
        except Exception as exc:
            runtime.load_error = f"WFDB apnea inference failed: {exc}"
            return None
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def _prepare_apnea_windows(self, signal: np.ndarray, true_labels: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        samples = 60 * 100
        x_values = []
        y_true = []

        for index in range(len(true_labels)):
            start = index * samples
            end = start + samples
            segment = signal[start:end]

            if len(segment) == samples:
                segment = np.nan_to_num(segment, nan=0.0)
                std = np.std(segment)
                if std != 0:
                    segment = (segment - np.mean(segment)) / std
                    x_values.append(segment)
                    y_true.append(true_labels[index])

        return np.array(x_values, dtype=np.float32), np.array(y_true, dtype=np.int32)

    def _match_apnea_model_input_shape(self, x_values: np.ndarray, model: Any) -> np.ndarray:
        input_shape = model.input_shape
        if isinstance(input_shape, list):
            input_shape = input_shape[0]
        if len(input_shape) == 3 and x_values.ndim == 2:
            return np.expand_dims(x_values, axis=-1)
        return x_values

    def _predict_respiratory(self, signals: Dict[str, Any], files: Dict[str, Any]) -> Dict[str, Any]:
        runtime = self.models["respiratory"]
        image = self._respiratory_tensor(signals, files)
        score = None
        predicted_label = "clinical-risk"
        class_probabilities: Dict[str, float] = {}

        if runtime.loaded_runtime and runtime.model is not None and self._torch is not None:
            try:
                torch = self._torch
                with torch.no_grad():
                    tensor = torch.from_numpy(image.astype("float32"))
                    logits = runtime.model(tensor)
                    probs = torch.softmax(logits, dim=1).cpu().numpy()[0]
                idx_to_label = {idx: label for label, idx in self._respiratory_labels.items()} or {
                    0: "COPD",
                    1: "Bronchiolitis",
                    2: "Healthy",
                    3: "Pneumonia",
                    4: "URTI",
                }
                risk_map = {
                    "healthy": 0.08,
                    "normal": 0.08,
                    "urti": 0.34,
                    "asthma": 0.48,
                    "bronchiolitis": 0.66,
                    "pneumonia": 0.78,
                    "copd": 0.72,
                }
                class_probabilities = {
                    str(idx_to_label.get(index, index)): round(float(probability), 4)
                    for index, probability in enumerate(probs)
                }
                predicted_label = max(class_probabilities, key=class_probabilities.get)
                score = sum(risk_map.get(str(label).lower(), 0.5) * probability for label, probability in class_probabilities.items())
            except Exception as exc:
                runtime.load_error = f"Respiratory inference failed: {exc}"

        if score is None:
            audio_energy = float(np.mean(np.abs(image)))
            score = clamp(
                0.24 * float(signals["wheezing"])
                + 0.18 * float(signals["cough"])
                + 0.18 * clamp(signals["cough_events"] / 16)
                + 0.16 * clamp((signals["respiratory_rate"] - 18) / 24)
                + 0.14 * clamp((signals["aqi"] - 75) / 175)
                + 0.10 * clamp(audio_energy)
            )

        return self._model_result(
            runtime,
            score,
            0.88 if runtime.loaded_runtime else 0.81,
            f"Respiratory audio risk | wheeze {'yes' if signals['wheezing'] else 'no'} | cough {signals['cough_events']:.0f}/hr",
            {
                "predicted_class": predicted_label,
                "class_probabilities": class_probabilities,
                "wheezing": bool(signals["wheezing"]),
                "cough_frequency_per_hour": round(signals["cough_events"], 2),
                "symptom_count": int(signals["symptom_count"]),
            },
        )

    def _model_result(
        self,
        runtime: RuntimeModel,
        score: float,
        confidence: float,
        details: str,
        extra: Dict[str, Any],
    ) -> Dict[str, Any]:
        bounded = clamp(score)
        return {
            "label": runtime.label,
            "model_key": runtime.key,
            "source_model": runtime.filename,
            "risk_score": round(bounded, 4),
            "risk_label": risk_label(bounded),
            "confidence": round(clamp(confidence), 4),
            "details": details,
            "status": "runtime_loaded" if runtime.loaded_runtime else "artifact_loaded",
            "artifact_present": runtime.artifact_present,
            "runtime_loaded": runtime.loaded_runtime,
            "load_error": runtime.load_error,
            **extra,
        }

    def _spo2_tensor(self, signals: Dict[str, Any], payload: Dict[str, Any]) -> np.ndarray:
        """Fallback/manual tensor for Model 2 when no CSV is uploaded.

        The real CSV endpoint uses predict_spo2_lstm_csv(). This method is kept for
        compatibility with /api/v1/predict and uses the same feature order as training.
        """
        runtime = self.models.get("spo2")
        max_len = 72
        if runtime is not None and runtime.loaded_runtime and runtime.model is not None:
            input_shape = runtime.model.input_shape
            if isinstance(input_shape, list):
                input_shape = input_shape[0]
            if len(input_shape) >= 2 and input_shape[1] is not None:
                max_len = int(input_shape[1])

        intake = payload.get("intake_form") or {}
        raw_gender = str(intake.get("gender") or intake.get("sex") or signals.get("sex") or "").strip().upper()
        if raw_gender in {"F", "FEMALE", "FEMME"}:
            gender_value = 0.0
        elif raw_gender in {"M", "MALE", "HOMME"}:
            gender_value = 1.0
        else:
            gender_value = 0.5

        hour = to_number(intake.get("hour_from_admission"), payload.get("hour_from_admission"), default=0)
        base = np.array(
            [
                hour,
                signals["heart_rate"],
                signals["respiratory_rate"],
                signals["spo2"],
                signals["systolic_bp"],
                signals["diastolic_bp"],
                signals["mobility_score"],
                signals["lactate"],
                signals["hemoglobin"],
                signals["age"],
                gender_value,
                signals["comorbidity_index"],
            ],
            dtype=np.float32,
        )

        series = np.tile(base, (max_len, 1)).astype(np.float32)
        series[:, 0] = np.maximum(0, hour - (max_len - 1)) + np.arange(max_len, dtype=np.float32)
        return np.expand_dims(series, axis=0).astype(np.float32)

    def _apnea_tensor(self, signals: Dict[str, Any], files: Dict[str, Any]) -> np.ndarray:
        dat_bytes = self._decode_file(files.get("dat_file"))
        if dat_bytes:
            data = np.frombuffer(dat_bytes, dtype=np.int16).astype(np.float32)
            if data.size == 0:
                data = self._synthetic_apnea_signal(signals)
        else:
            data = self._synthetic_apnea_signal(signals)

        if data.size < 6000:
            repeats = int(math.ceil(6000 / max(1, data.size)))
            data = np.tile(data, repeats)
        data = data[:6000]
        data = data - float(np.mean(data))
        data = data / (float(np.std(data)) + 1e-6)
        return data.reshape(1, 6000, 1).astype(np.float32)

    def _synthetic_apnea_signal(self, signals: Dict[str, Any]) -> np.ndarray:
        t = np.linspace(0, 60, 6000, dtype=np.float32)
        base_rate = max(6.0, min(32.0, signals["respiratory_rate"])) / 60.0
        signal = np.sin(2 * np.pi * base_rate * t)
        pause_strength = clamp(signals["apnea_level"] / 10)
        envelope = 1.0 - pause_strength * (np.sin(2 * np.pi * 0.045 * t) > 0.78).astype(np.float32)
        return signal * envelope + 0.05 * np.sin(2 * np.pi * 1.7 * t)

    def _respiratory_tensor(self, signals: Dict[str, Any], files: Dict[str, Any]) -> np.ndarray:
        wav_payloads = files.get("wav_files") or []
        waves = []
        for payload in wav_payloads:
            raw = self._decode_file(payload)
            if raw:
                waves.append(self._read_wav_or_raw(raw))
        if waves:
            audio = np.concatenate(waves)
        else:
            audio = self._synthetic_audio_signal(signals)

        image = self._audio_to_image(audio)
        image = (image - 0.5) / 0.5
        return image.reshape(1, 3, 224, 224).astype(np.float32)

    def _read_wav_or_raw(self, raw: bytes) -> np.ndarray:
        try:
            with wave.open(io.BytesIO(raw), "rb") as wav:
                frames = wav.readframes(wav.getnframes())
                channels = max(1, wav.getnchannels())
                sample_width = wav.getsampwidth()
                if sample_width == 1:
                    data = np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128
                    scale = 128.0
                elif sample_width == 4:
                    data = np.frombuffer(frames, dtype=np.int32).astype(np.float32)
                    scale = float(2**31)
                else:
                    data = np.frombuffer(frames, dtype=np.int16).astype(np.float32)
                    scale = float(2**15)
                if channels > 1:
                    data = data.reshape(-1, channels).mean(axis=1)
                return data / scale
        except Exception:
            data = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
            if data.size == 0:
                return np.zeros(16000, dtype=np.float32)
            return data / (float(np.max(np.abs(data))) + 1e-6)

    def _synthetic_audio_signal(self, signals: Dict[str, Any]) -> np.ndarray:
        t = np.linspace(0, 8, 16000 * 8, dtype=np.float32)
        base = 0.08 * np.sin(2 * np.pi * 180 * t)
        wheeze = 0.20 * np.sin(2 * np.pi * 720 * t) if signals["wheezing"] else 0
        cough = np.zeros_like(t)
        if signals["cough_events"] > 0:
            cough[::8000] = clamp(signals["cough_events"] / 20)
        return base + wheeze + cough

    def _audio_to_image(self, audio: np.ndarray) -> np.ndarray:
        audio = np.asarray(audio, dtype=np.float32).reshape(-1)
        if audio.size < 1024:
            audio = np.pad(audio, (0, 1024 - audio.size))
        audio = audio[: min(audio.size, 16000 * 12)]
        frame = 512
        hop = 256
        frames = []
        window = np.hanning(frame).astype(np.float32)
        for start in range(0, max(1, audio.size - frame), hop):
            chunk = audio[start : start + frame]
            if chunk.size < frame:
                chunk = np.pad(chunk, (0, frame - chunk.size))
            spectrum = np.abs(np.fft.rfft(chunk * window))[:224]
            frames.append(spectrum)
            if len(frames) >= 224:
                break
        spec = np.stack(frames, axis=1) if frames else np.zeros((224, 1), dtype=np.float32)
        spec = np.log1p(spec)
        spec = spec / (float(np.max(spec)) + 1e-6)
        if spec.shape[1] < 224:
            x_old = np.linspace(0, 1, spec.shape[1])
            x_new = np.linspace(0, 1, 224)
            spec = np.vstack([np.interp(x_new, x_old, row) for row in spec])
        else:
            spec = spec[:, :224]
        return np.stack([spec, spec, spec], axis=0)

    def _decode_file(self, payload: Any) -> bytes:
        if not payload:
            return b""
        if hasattr(payload, "model_dump") or hasattr(payload, "dict"):
            payload = model_dump(payload)
        if not isinstance(payload, dict):
            return b""
        data = payload.get("data_base64")
        if not data:
            return b""
        try:
            return base64.b64decode(data)
        except Exception:
            return b""

    def _fuse(self, results: Dict[str, Dict[str, Any]]) -> float:
        weights = {"spo2": 0.38, "apnea": 0.32, "respiratory": 0.30}
        active_weight = sum(weights[key] for key in results)
        if active_weight <= 0:
            return 0.0
        return clamp(sum(weights[key] * float(results[key]["risk_score"]) for key in results) / active_weight)

    def _confidence(self, results: Dict[str, Dict[str, Any]]) -> float:
        if not results:
            return 0.70
        return clamp(sum(float(item.get("confidence", 0.8)) for item in results.values()) / len(results))

    def _prediction_window_hours(self, score: float) -> int:
        if score >= 0.75:
            return 2
        if score >= 0.50:
            return 4
        if score >= 0.30:
            return 8
        return 12

    def _factors(self, signals: Dict[str, Any], results: Dict[str, Dict[str, Any]], score: float) -> List[Dict[str, str]]:
        severity = risk_label(score)
        factors: List[Dict[str, str]] = []
        for key, result in results.items():
            model_score = float(result.get("risk_score", 0))
            if model_score >= 0.30:
                factors.append(
                    {
                        "key": key,
                        "label": str(result.get("label") or key),
                        "value": f"{percent(model_score)}% model contribution",
                        "severity": risk_label(model_score),
                    }
                )
        if signals["spo2"] < 94:
            factors.append({"key": "spo2", "label": "Oxygen Saturation", "value": f"{signals['spo2']:.1f}%", "severity": severity})
        if signals["respiratory_rate"] >= 22:
            factors.append({"key": "rr", "label": "Respiratory Rate", "value": f"{signals['respiratory_rate']:.0f} br/min", "severity": severity})
        if signals["wheezing"] or signals["cough_events"] > 0:
            factors.append({"key": "audio", "label": "Respiratory Symptoms", "value": f"cough {signals['cough_events']:.0f}/hr, wheeze {'yes' if signals['wheezing'] else 'no'}", "severity": severity})
        if not factors:
            factors.append({"key": "overall", "label": "Overall Stability", "value": "No dominant destabilizing factor detected.", "severity": "low"})
        return factors[:6]

    def _query_from_payload(self, payload: Dict[str, Any]) -> str:
        intake = payload.get("intake_form") or {}
        terms = [str(payload.get("patient_id") or ""), str(intake.get("smoking_status") or "")]
        for key in ["asthma", "copd", "cough", "wheezing", "shortness_of_breath", "fatigue"]:
            if to_bool(intake.get(key)):
                terms.append(key)
        return " ".join(terms)

    def _explanation(
        self,
        signals: Dict[str, Any],
        results: Dict[str, Dict[str, Any]],
        fused_score: float,
        sources: List[Dict[str, Any]],
    ) -> str:
        model_parts = ", ".join(
            f"{result['label']} {percent(float(result['risk_score']))}%"
            for result in results.values()
        )
        source_tags = ", ".join(source["source"] for source in sources[:3])
        return (
            f"Final AI+RAG fusion estimates {percent(fused_score)}% short-term respiratory risk. "
            f"Model signals: {model_parts}. "
            f"Current vitals include SpO2 {signals['spo2']:.1f}%, RR {signals['respiratory_rate']:.0f}/min, "
            f"HR {signals['heart_rate']:.0f}/min, cough {signals['cough_events']:.0f}/hr, and wheeze "
            f"{'detected' if signals['wheezing'] else 'not detected'}. "
            f"Retrieved references used for the explanation: {source_tags}."
        )
