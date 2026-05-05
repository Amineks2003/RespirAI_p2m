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

    def load_all(self) -> None:
        for runtime_model in self.models.values():
            self._load_model(runtime_model)

    def health(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "service": "ehealth-ai-service",
            "models_dir": str(self.settings.models_dir),
            "models": {key: model.status() for key, model in self.models.items()},
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
            "explanation": self._explanation(signals, results, fused_score, sources),
            "sources": sources,
        }

    def predict_manual(self, request_payload: Dict[str, Any], files: Any) -> Dict[str, Any]:
        files_dict = model_dump(files)
        payload = dict(request_payload.get("payload") or {})
        payload["model"] = request_payload.get("model") or payload.get("model") or "all_models"
        payload["top_k_guidelines"] = request_payload.get("top_k_guidelines") or payload.get("top_k_guidelines") or 4
        return self.predict(payload, files=files_dict)

    def _extract_signals(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        intake = payload.get("intake_form") or {}
        vitals = payload.get("vitals") or {}
        audio = payload.get("audio") or {}
        apnea = payload.get("apnea") or {}
        environment = payload.get("environment") or {}
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
            "aqi": clamp(to_number(payload.get("aqi"), intake.get("air_quality_index"), environment.get("aqi"), environment.get("air_quality_index"), default=60), 0, 500),
            "environment_temperature": clamp(to_number(intake.get("environment_temperature"), environment.get("temperature"), default=24), -30, 60),
            "humidity": clamp(to_number(intake.get("humidity"), environment.get("humidity"), default=50), 0, 100),
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
        intake = payload.get("intake_form") or {}
        gender = str(intake.get("gender") or intake.get("sex") or signals.get("sex") or "other").lower()
        gender_value = {"female": 0.0, "male": 1.0}.get(gender, 0.5)
        base = np.array(
            [
                clamp(to_number(intake.get("hour_from_admission"), default=0) / 168),
                clamp(signals["heart_rate"] / 220),
                clamp(signals["respiratory_rate"] / 80),
                clamp(signals["spo2"] / 100),
                clamp(signals["systolic_bp"] / 260),
                clamp(signals["diastolic_bp"] / 150),
                clamp(signals["mobility_score"] / 10),
                clamp(signals["lactate"] / 30),
                clamp(signals["hemoglobin"] / 22),
                clamp(signals["age"] / 120),
                gender_value,
                clamp(signals["comorbidity_index"] / 40),
            ],
            dtype=np.float32,
        )
        series = np.tile(base, (72, 1))
        trend = np.linspace(-0.04, 0.04, 72, dtype=np.float32)
        series[:, 3] = clamp(signals["spo2"] / 100) + trend * clamp((94 - signals["spo2"]) / 18)
        series[:, 2] = clamp(signals["respiratory_rate"] / 80) + trend * clamp((signals["respiratory_rate"] - 18) / 24)
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
