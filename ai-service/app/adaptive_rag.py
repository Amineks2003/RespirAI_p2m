from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from .rag_index import LocalRagIndex
from .web_search import ControlledMedicalWebSearch, TRUSTED_MEDICAL_DOMAINS


APP_DIR = Path(__file__).resolve().parent


class AdaptiveRAGEngine:
    """Model-aware Adaptive RAG for the eHealth AI service.

    The RAG output is intentionally tied to the model that produced the result:
    - Model 1 / CNN-BiLSTM apnea uses apnea/sleep-breathing interpretation only.
    - Model 2 / LSTM SpO2 uses SpO2 deterioration and tabular time-series values only.
    - Respiratory audio uses respiratory audio/symptom interpretation only.
    - Combined/all models can use a broader clinical-deterioration explanation.

    Retrieval remains safe-by-default:
    - Local PDF knowledge base from app/rag_docs.
    - Optional controlled web search on trusted medical domains only.
    """

    def __init__(
        self,
        docs_dir: Path | str | None = None,
        vectorstore_dir: Path | str | None = None,
        enable_web_search: Optional[bool] = None,
    ):
        self.index = LocalRagIndex(
            docs_dir=Path(docs_dir) if docs_dir else APP_DIR / "rag_docs",
            vectorstore_dir=Path(vectorstore_dir) if vectorstore_dir else APP_DIR / "vectorstore",
        )
        self.index.load_or_build(force_rebuild=False)

        if enable_web_search is None:
            enable_web_search = os.getenv("RAG_ENABLE_WEB_SEARCH", "0").strip() == "1"

        self.enable_web_search = bool(enable_web_search)
        self.force_web_search = os.getenv("RAG_FORCE_WEB_SEARCH", "0").strip() == "1"
        self.web_search = ControlledMedicalWebSearch(
            trusted_domains=TRUSTED_MEDICAL_DOMAINS,
            max_results=int(os.getenv("RAG_WEB_MAX_RESULTS", "4") or 4),
        )

    def status(self) -> Dict[str, Any]:
        status = self.index.status()
        status["engine"] = "adaptive_rag_model_aware_local_tfidf_plus_controlled_web"
        status["available"] = True
        status["web_search_enabled"] = self.enable_web_search
        status["web_search_force"] = self.force_web_search
        status["web_search"] = self.web_search.status()
        return status

    def rebuild_index(self) -> Dict[str, Any]:
        self.index.build()
        return self.status()

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------
    def route(
        self,
        question: str,
        signals: Optional[Dict[str, Any]] = None,
        selected_models: Optional[List[str]] = None,
        model_name: str = "",
    ) -> Dict[str, Any]:
        signals = signals or {}
        selected_models = selected_models or []
        model_kind = self._model_kind(selected_models, model_name)
        q = f"{question}".lower()

        categories: List[str] = []
        reasons: List[str] = []
        web_reasons: List[str] = []

        if model_kind == "apnea":
            # Keep apnea RAG model-specific. Do not add sepsis/SpO2 deterioration routes.
            categories = ["general", "news2"]
            reasons.append("Model 1 is CNN-BiLSTM apnea; explanation is restricted to apnea/sleep-breathing signal interpretation")
            if any(term in q for term in ["latest", "current", "recent", "updated", "2025", "2026", "web", "online"]):
                web_reasons.append("question asks for recent/current information")
            return self._route_payload(categories, reasons, web_reasons, model_kind)

        if model_kind == "spo2":
            categories = ["oxygen", "news2"]
            reasons.append("Model 2 is LSTM SpO2 deterioration; explanation is restricted to SpO2 time-series and tabular vital features")
            spo2 = self._num(signals.get("spo2") or signals.get("spo2_pct"), default=None)
            rr = self._num(signals.get("respiratory_rate"), default=None)
            hr = self._num(signals.get("heart_rate"), default=None)
            sbp = self._num(signals.get("systolic_bp"), default=None)
            lactate = self._num(signals.get("lactate"), default=None)
            if spo2 is not None and spo2 < 94:
                reasons.append("SpO2 is below the usual monitoring threshold")
            if (rr is not None and rr >= 22) or (hr is not None and hr >= 100):
                reasons.append("respiratory rate or heart rate contributes to early-warning context")
            if (sbp is not None and sbp < 100) or (lactate is not None and lactate >= 2.0):
                # Only add sepsis for Model 2 when the actual model features justify it.
                categories.append("sepsis")
                reasons.append("blood pressure or lactate values justify acute-deterioration context")
            if any(term in q for term in ["latest", "current", "recent", "updated", "2025", "2026", "web", "online"]):
                web_reasons.append("question asks for recent/current information")
            return self._route_payload(categories, reasons, web_reasons, model_kind)

        if model_kind == "respiratory":
            categories = ["asthma", "copd", "general"]
            reasons.append("Respiratory audio model; explanation is restricted to respiratory audio/symptom interpretation")
            if any(term in q for term in ["latest", "current", "recent", "updated", "2025", "2026", "web", "online"]):
                web_reasons.append("question asks for recent/current information")
            return self._route_payload(categories, reasons, web_reasons, model_kind)

        # Combined / fallback route.
        spo2 = self._num(signals.get("spo2") or signals.get("spo2_pct"), default=None)
        rr = self._num(signals.get("respiratory_rate"), default=None)
        hr = self._num(signals.get("heart_rate"), default=None)
        sbp = self._num(signals.get("systolic_bp"), default=None)
        lactate = self._num(signals.get("lactate"), default=None)

        if any(term in q for term in ["spo2", "oxygen", "hypox", "saturation", "oximetry"]):
            categories.append("oxygen")
            reasons.append("question mentions oxygen saturation")
        if spo2 is not None and spo2 < 94:
            categories.append("oxygen")
            reasons.append("low SpO2 value")
        if any(term in q for term in ["asthma", "wheez", "shortness of breath", "dyspnea", "dyspnoea"]):
            categories.append("asthma")
            reasons.append("question mentions asthma/wheezing/dyspnea")
        if any(term in q for term in ["copd", "gold", "chronic obstructive", "emphysema"]):
            categories.append("copd")
            reasons.append("question mentions COPD")
        if any(term in q for term in ["sepsis", "lactate", "shock", "hypotension"]):
            categories.append("sepsis")
            reasons.append("question mentions sepsis/lactate/shock")
        if (lactate is not None and lactate >= 2.0) or (sbp is not None and sbp < 100):
            categories.append("sepsis")
            reasons.append("lactate or systolic BP suggests possible acute deterioration context")
        if any(term in q for term in ["deterioration", "risk", "early warning", "news2", "vital", "respiratory rate"]):
            categories.append("news2")
            reasons.append("question concerns clinical deterioration / vital signs")
        if (rr is not None and rr >= 22) or (hr is not None and hr >= 100):
            categories.append("news2")
            reasons.append("abnormal RR/HR are early warning signals")

        if not categories:
            categories = ["news2", "oxygen", "general"]
            reasons.append("general clinical explanation route")

        if any(term in q for term in ["latest", "current", "recent", "updated", "new guideline", "2025", "2026", "web", "online"]):
            web_reasons.append("question asks for recent/current information")

        return self._route_payload(categories, reasons, web_reasons, model_kind)

    def _route_payload(self, categories: List[str], reasons: List[str], web_reasons: List[str], model_kind: str) -> Dict[str, Any]:
        unique_categories: List[str] = []
        for category in categories:
            if category not in unique_categories:
                unique_categories.append(category)
        return {
            "categories": unique_categories,
            "reasons": reasons,
            "web_search_recommended": bool(web_reasons),
            "web_reasons": web_reasons,
            "trusted_web_domains": TRUSTED_MEDICAL_DOMAINS,
            "model_kind": model_kind,
        }

    # ------------------------------------------------------------------
    # Public explanation API
    # ------------------------------------------------------------------
    def explain_prediction(
        self,
        patient_id: str,
        risk_score: float,
        confidence: float,
        model_name: str,
        last_vitals: Optional[Dict[str, Any]] = None,
        factors: Optional[List[Dict[str, Any]]] = None,
        selected_models: Optional[List[str]] = None,
        top_k: int = 4,
        question: Optional[str] = None,
    ) -> Dict[str, Any]:
        last_vitals = last_vitals or {}
        factors = factors or []
        selected_models = selected_models or []
        top_k = max(1, int(top_k or 4))
        model_kind = self._model_kind(selected_models, model_name)

        if question is None:
            question = self._build_question(risk_score, model_name, last_vitals, factors, selected_models)

        route = self.route(question, last_vitals, selected_models=selected_models, model_name=model_name)
        expanded_query = self._expand_query(question, risk_score, last_vitals, factors, route["categories"], model_kind)

        local_docs = self.index.search(
            expanded_query,
            categories=route["categories"],
            top_k=top_k,
            min_score=0.025,
        )

        retrieval_steps = ["local_routed_retrieval"]

        if len(local_docs) < min(2, top_k):
            retrieval_steps.append("local_self_corrected_broader_retrieval")
            local_docs = self.index.search(
                self._broader_query(expanded_query, model_kind),
                categories=None,
                top_k=top_k,
                min_score=0.015,
            )

        web_docs: List[Dict[str, Any]] = []
        should_use_web = self._should_use_web(route=route, local_docs=local_docs)
        if should_use_web:
            retrieval_steps.append("controlled_trusted_web_search")
            web_query = self._build_web_query(expanded_query, route["categories"], model_kind)
            web_docs = self.web_search.search(web_query, top_k=min(4, top_k))

        docs = self._merge_sources(local_docs, web_docs, top_k=max(top_k, top_k + len(web_docs)))

        explanation = self._compose_explanation(
            patient_id=patient_id,
            risk_score=risk_score,
            confidence=confidence,
            model_name=model_name,
            last_vitals=last_vitals,
            factors=factors,
            docs=docs,
            route=route,
            web_used=bool(web_docs),
            model_kind=model_kind,
        )

        return {
            "mode": "adaptive_rag",
            "model_kind": model_kind,
            "retrieval_mode": "+".join(retrieval_steps),
            "question": question,
            "expanded_query": expanded_query,
            "route": route,
            "summary": explanation,
            "explanation": explanation,
            "sources": docs,
            "documents": docs,
            "local_sources_count": len(local_docs),
            "web_sources_count": len(web_docs),
            "web_search_used": bool(web_docs),
            "web_search_status": self.web_search.status(),
            "disclaimer": "Clinical decision support only. It does not replace physician judgment.",
        }

    def _should_use_web(self, route: Dict[str, Any], local_docs: List[Dict[str, Any]]) -> bool:
        if not self.enable_web_search:
            return False
        if not self.web_search.available():
            return False
        if self.force_web_search:
            return True
        if route.get("web_search_recommended"):
            return True
        if len(local_docs) < 2:
            return True
        return False

    # ------------------------------------------------------------------
    # Query construction
    # ------------------------------------------------------------------
    def _build_question(
        self,
        risk_score: float,
        model_name: str,
        last_vitals: Dict[str, Any],
        factors: List[Dict[str, Any]],
        selected_models: List[str],
    ) -> str:
        model_kind = self._model_kind(selected_models, model_name)
        percent_score = round(risk_score * 100, 1)

        if model_kind == "apnea":
            parts = [
                f"Explain a {percent_score} percent apnea signal risk from {model_name}.",
                "Focus only on sleep apnea, apnea signal interpretation, breathing pauses, ECG/respiratory signal windows, and respiratory monitoring.",
                "Do not use SpO2 deterioration, sepsis, lactate, or blood pressure interpretation unless explicitly provided by the apnea model.",
            ]
        elif model_kind == "spo2":
            parts = [
                f"Explain a {percent_score} percent deterioration risk from {model_name}.",
                "Focus only on LSTM SpO2 deterioration, oxygen saturation trend, respiratory rate, heart rate, blood pressure, mobility, lactate, hemoglobin, age, gender, and comorbidity index.",
            ]
        elif model_kind == "respiratory":
            parts = [
                f"Explain a {percent_score} percent respiratory audio risk from {model_name}.",
                "Focus only on respiratory sound analysis, wheeze, cough, and respiratory symptoms.",
            ]
        else:
            parts = [
                f"Explain a {percent_score} percent deterioration risk from {model_name}.",
                "Use clinical deterioration, oxygen saturation, respiratory monitoring and vital signs guidelines.",
            ]

        for key, value in last_vitals.items():
            if value is not None:
                parts.append(f"{key}: {value}.")

        for factor in factors:
            label = factor.get("label") or factor.get("key")
            value = factor.get("value")
            if label and value:
                parts.append(f"Factor {label}: {value}.")

        return " ".join(parts)

    def _expand_query(
        self,
        question: str,
        risk_score: float,
        last_vitals: Dict[str, Any],
        factors: List[Dict[str, Any]],
        categories: List[str],
        model_kind: str,
    ) -> str:
        additions: List[str] = []

        if model_kind == "apnea":
            additions.append("sleep apnea apnea detection breathing pause respiratory signal ECG window sleep disordered breathing monitoring")
            if risk_score >= 0.5:
                additions.append("clinically significant apnea events monitoring escalation")
            else:
                additions.append("low apnea probability routine sleep breathing monitoring")
            return " ".join([question] + additions)

        if model_kind == "spo2":
            additions.append("SpO2 oxygen saturation pulse oximetry hypoxemia NEWS2 respiratory rate heart rate systolic blood pressure")
            if risk_score >= 0.5:
                additions.append("acute clinical deterioration early warning escalation")
            else:
                additions.append("low risk stable monitoring vital signs")
            if "sepsis" in categories:
                additions.append("lactate hypotension sepsis screening monitoring")
            return " ".join([question] + additions)

        if model_kind == "respiratory":
            additions.append("respiratory sound wheeze cough asthma COPD exacerbation respiratory symptoms monitoring")
            return " ".join([question] + additions)

        if risk_score >= 0.5:
            additions.append("acute clinical deterioration early warning escalation")
        else:
            additions.append("low risk stable monitoring vital signs")

        if "oxygen" in categories:
            additions.append("oxygen saturation pulse oximetry hypoxemia oxygen therapy")
        if "news2" in categories:
            additions.append("NEWS2 respiratory rate SpO2 systolic blood pressure heart rate")
        if "asthma" in categories:
            additions.append("asthma exacerbation wheezing shortness of breath GINA")
        if "copd" in categories:
            additions.append("COPD exacerbation GOLD oxygen saturation dyspnea")
        if "sepsis" in categories:
            additions.append("sepsis lactate hypotension shock monitoring")

        return " ".join([question] + additions)

    def _broader_query(self, expanded_query: str, model_kind: str) -> str:
        if model_kind == "apnea":
            return f"{expanded_query} apnea sleep breathing respiratory monitoring guideline"
        if model_kind == "spo2":
            return f"{expanded_query} clinical deterioration oxygen respiratory monitoring guideline"
        if model_kind == "respiratory":
            return f"{expanded_query} respiratory symptoms asthma COPD monitoring guideline"
        return f"{expanded_query} clinical deterioration oxygen respiratory monitoring guideline"

    def _build_web_query(self, expanded_query: str, categories: List[str], model_kind: str) -> str:
        if model_kind == "apnea":
            return f"{expanded_query} sleep apnea respiratory monitoring official guideline"
        if model_kind == "spo2":
            return f"{expanded_query} oxygen saturation pulse oximetry clinical deterioration official guideline"
        if model_kind == "respiratory":
            return f"{expanded_query} respiratory symptoms asthma COPD official guideline"

        category_terms = {
            "oxygen": "oxygen saturation pulse oximetry hypoxemia guideline",
            "news2": "NEWS2 clinical deterioration vital signs guideline",
            "asthma": "GINA asthma exacerbation guideline",
            "copd": "GOLD COPD exacerbation oxygen saturation guideline",
            "sepsis": "Surviving Sepsis lactate hypotension guideline",
            "general": "clinical monitoring respiratory deterioration guideline",
        }
        extras = " ".join(category_terms.get(category, "") for category in categories)
        return f"{expanded_query} {extras} official guideline"

    def _merge_sources(
        self,
        local_docs: List[Dict[str, Any]],
        web_docs: List[Dict[str, Any]],
        top_k: int,
    ) -> List[Dict[str, Any]]:
        merged: List[Dict[str, Any]] = []
        seen = set()

        for doc in local_docs + web_docs:
            key = doc.get("url") or (doc.get("source"), doc.get("page"))
            if key in seen:
                continue
            seen.add(key)
            merged.append(doc)
            if len(merged) >= top_k:
                break

        return merged

    # ------------------------------------------------------------------
    # Explanation composition
    # ------------------------------------------------------------------
    def _compose_explanation(
        self,
        patient_id: str,
        risk_score: float,
        confidence: float,
        model_name: str,
        last_vitals: Dict[str, Any],
        factors: List[Dict[str, Any]],
        docs: List[Dict[str, Any]],
        route: Dict[str, Any],
        web_used: bool = False,
        model_kind: str = "combined",
    ) -> str:
        percent_score = round(risk_score * 100, 1)
        percent_conf = round(confidence * 100, 1)
        risk_level = self._risk_level_text(risk_score)

        data_lines = self._format_model_data_for_summary(last_vitals, model_kind)
        factor_lines = self._format_factors_for_summary(factors)
        source_lines = self._format_sources_for_summary(docs)
        recommendation_lines = self._recommendations_for_summary(risk_score, last_vitals, factors, model_kind)

        if model_kind == "apnea":
            route_text = "apnea signal interpretation, sleep-breathing monitoring"
        elif model_kind == "spo2":
            route_text = "SpO2 deterioration, oxygen saturation, early-warning vital signs"
        elif model_kind == "respiratory":
            route_text = "respiratory audio, wheeze/cough symptoms"
        else:
            route_text = ", ".join(route.get("categories") or ["general"])

        reason_text = "; ".join(route.get("reasons") or []) or "the query is related to clinical monitoring"
        web_text = (
            "The system also used controlled web search on trusted medical domains."
            if web_used
            else "The system used the local uploaded clinical knowledge base; controlled web search was not required."
        )

        return (
            "Adaptive RAG clinical summary\n"
            f"Patient: {patient_id}\n"
            f"Model used: {model_name}\n"
            f"Estimated model risk: {percent_score}% ({risk_level})\n"
            f"Model confidence: {percent_conf}%\n\n"
            f"Model-specific data considered ({self._model_title(model_kind)})\n"
            f"{data_lines}\n\n"
            "Clinical interpretation\n"
            f"{self._situation_text(risk_score, model_kind)}\n"
            f"The retrieval route selected: {route_text}. Reason: {reason_text}. {web_text}\n\n"
            "Main factors influencing this model-specific explanation\n"
            f"{factor_lines}\n\n"
            "Retrieved guideline support\n"
            f"{source_lines}\n\n"
            "Conclusion\n"
            f"{self._conclusion_for_summary(risk_score, last_vitals, model_kind)}\n\n"
            "Recommendations / next actions\n"
            f"{recommendation_lines}\n\n"
            "Safety note\n"
            "This output is clinical decision support only. It should help the doctor review the patient, "
            "but it does not replace clinical judgment, bedside examination, or local hospital protocol."
        )

    def _risk_level_text(self, risk_score: float) -> str:
        if risk_score >= 0.75:
            return "critical risk"
        if risk_score >= 0.50:
            return "high risk"
        if risk_score >= 0.30:
            return "moderate risk"
        return "low risk"

    def _situation_text(self, risk_score: float, model_kind: str) -> str:
        if model_kind == "apnea":
            if risk_score >= 0.75:
                return "The CNN-BiLSTM apnea model indicates a high probability of apnea-related abnormal breathing patterns in the uploaded signal. This should be reviewed promptly in the sleep-breathing/respiratory monitoring context."
            if risk_score >= 0.50:
                return "The CNN-BiLSTM apnea model indicates a meaningful probability of apnea-related breathing abnormality. The signal quality and event distribution should be reviewed."
            if risk_score >= 0.30:
                return "The CNN-BiLSTM apnea model indicates an intermediate apnea signal pattern. It is not critical by threshold, but the signal should be compared with the annotated windows and patient symptoms."
            return "The CNN-BiLSTM apnea model indicates a low apnea-related risk pattern in the uploaded signal. Continue routine monitoring if the clinical context remains stable."

        if model_kind == "spo2":
            if risk_score >= 0.75:
                return "The LSTM SpO2 model suggests a high probability of short-term deterioration based on the patient’s tabular time-series pattern. This should be reviewed promptly by the clinical team."
            if risk_score >= 0.50:
                return "The LSTM SpO2 model suggests a meaningful risk of deterioration based on the SpO2/vital-sign sequence. The patient should receive closer monitoring and reassessment."
            if risk_score >= 0.30:
                return "The LSTM SpO2 model suggests an intermediate deterioration pattern. The latest values and previous trend should be reviewed together."
            return "The LSTM SpO2 model suggests a low short-term deterioration risk from the uploaded CSV sequence. Routine monitoring should continue because LSTM predictions depend on time trends."

        if model_kind == "respiratory":
            if risk_score >= 0.50:
                return "The respiratory audio model suggests a relevant respiratory-sound risk pattern. Wheeze/cough features and clinical symptoms should be reviewed together."
            return "The respiratory audio model suggests a low respiratory-sound risk pattern. Continue routine symptom and audio monitoring if clinically appropriate."

        if risk_score >= 0.75:
            return "The model output suggests a high probability of short-term clinical deterioration. This situation should be treated as urgent and reviewed promptly by the clinical team."
        if risk_score >= 0.50:
            return "The model output suggests a meaningful risk of deterioration. The patient should receive closer monitoring and clinical reassessment."
        if risk_score >= 0.30:
            return "The model output suggests an intermediate risk pattern. The trend and vital signs should be reviewed."
        return "The model output suggests a low short-term deterioration risk. Routine monitoring should continue."

    def _format_model_data_for_summary(self, data: Dict[str, Any], model_kind: str) -> str:
        if model_kind == "apnea":
            labels = {
                "apnea_probability": "Predicted apnea probability",
                "apnea_label": "Predicted apnea label",
                "windows_analyzed": "Signal windows analyzed",
                "signal_samples": "Signal samples used",
                "apnea_level": "Apnea level",
                "accuracy": "Window-level accuracy",
                "true_apnea_rate": "Ground-truth apnea rate from .apn",
                "predicted_apnea_rate": "Predicted apnea window rate",
                "total_windows": "Total labeled windows",
            }
        elif model_kind == "spo2":
            labels = {
                "hour_from_admission": "Hour from admission",
                "spo2_pct": "SpO2",
                "spo2": "SpO2",
                "respiratory_rate": "Respiratory rate",
                "heart_rate": "Heart rate",
                "systolic_bp": "Systolic BP",
                "diastolic_bp": "Diastolic BP",
                "mobility_score": "Mobility score",
                "lactate": "Lactate",
                "hemoglobin": "Hemoglobin",
                "age": "Age",
                "gender": "Gender",
                "comorbidity_index": "Comorbidity index",
            }
        elif model_kind == "respiratory":
            labels = {
                "predicted_class": "Predicted respiratory class",
                "wheezing": "Wheezing",
                "cough_frequency_per_hour": "Cough frequency",
                "symptom_count": "Symptom count",
            }
        else:
            labels = {
                "spo2": "SpO2",
                "spo2_pct": "SpO2",
                "respiratory_rate": "Respiratory rate",
                "heart_rate": "Heart rate",
                "systolic_bp": "Systolic BP",
                "diastolic_bp": "Diastolic BP",
                "lactate": "Lactate",
                "hemoglobin": "Hemoglobin",
            }

        units = {
            "spo2": "%",
            "spo2_pct": "%",
            "respiratory_rate": "br/min",
            "heart_rate": "bpm",
            "systolic_bp": "mmHg",
            "diastolic_bp": "mmHg",
            "lactate": "mmol/L",
            "hemoglobin": "g/dL",
            "cough_frequency_per_hour": "events/hr",
        }

        rows: List[str] = []
        emitted_spo2 = False
        for key, label in labels.items():
            if key == "spo2" and ("spo2_pct" in data or emitted_spo2):
                continue
            if key == "spo2_pct":
                emitted_spo2 = True
            value = data.get(key)
            if value is None:
                continue
            formatted = self._format_number(value)
            unit = units.get(key, "")
            rows.append(f"- {label}: {formatted}{(' ' + unit) if unit else ''}")

        if not rows:
            return "- No model-specific input details were provided to the RAG module."
        return "\n".join(rows)

    def _format_factors_for_summary(self, factors: List[Dict[str, Any]]) -> str:
        if not factors:
            return "- No dominant model factor was provided."
        rows: List[str] = []
        for factor in factors[:6]:
            label = factor.get("label") or factor.get("key") or "Factor"
            value = factor.get("value") or "contributed to the model output"
            severity = factor.get("severity")
            severity_text = f" ({severity})" if severity else ""
            rows.append(f"- {label}: {value}{severity_text}")
        return "\n".join(rows)

    def _format_sources_for_summary(self, docs: List[Dict[str, Any]]) -> str:
        if not docs:
            return "- No guideline source was retrieved. Check the RAG index and uploaded PDFs."

        grouped: Dict[str, Dict[str, Any]] = {}
        for doc in docs:
            title = str(doc.get("title") or doc.get("source") or doc.get("domain") or "Clinical source")
            key = title.lower()
            if key not in grouped:
                grouped[key] = {"title": title, "pages": [], "web": False}
            if doc.get("category") == "web" or doc.get("url"):
                grouped[key]["web"] = True
            page = doc.get("page")
            try:
                page_int = int(page)
                if page_int > 0 and page_int not in grouped[key]["pages"]:
                    grouped[key]["pages"].append(page_int)
            except Exception:
                pass

        rows: List[str] = []
        for item in list(grouped.values())[:6]:
            pages = sorted(item["pages"])
            if pages:
                pages_text = ", ".join(f"p. {page}" for page in pages)
                rows.append(f"- {item['title']}: pages used {pages_text}")
            elif item["web"]:
                rows.append(f"- {item['title']}: trusted web source")
            else:
                rows.append(f"- {item['title']}: page not specified")
        return "\n".join(rows)

    def _conclusion_for_summary(self, risk_score: float, data: Dict[str, Any], model_kind: str) -> str:
        if model_kind == "apnea":
            windows = self._num(data.get("windows_analyzed"), default=None)
            label = str(data.get("apnea_label") or "").replace("_", " ")
            if risk_score >= 0.50:
                detail = f" The model label is {label}." if label else ""
                window_text = f" It was based on {int(windows)} analyzed signal windows." if windows else ""
                return "The apnea-specific prediction is concerning because the uploaded signal pattern is classified as apnea-related or high probability." + detail + window_text
            return "The apnea-specific prediction is currently reassuring because the uploaded signal pattern is below the apnea decision threshold. Continue to review signal quality and clinical symptoms."

        if model_kind == "spo2":
            spo2 = self._num(data.get("spo2_pct", data.get("spo2")), default=None)
            rr = self._num(data.get("respiratory_rate"), default=None)
            hr = self._num(data.get("heart_rate"), default=None)
            sbp = self._num(data.get("systolic_bp"), default=None)
            lactate = self._num(data.get("lactate"), default=None)
            concerning: List[str] = []
            reassuring: List[str] = []
            if spo2 is not None:
                if spo2 < 90:
                    concerning.append("marked oxygen desaturation")
                elif spo2 < 94:
                    concerning.append("reduced oxygen saturation")
                else:
                    reassuring.append("oxygen saturation is not low")
            if rr is not None:
                if rr >= 22:
                    concerning.append("elevated respiratory rate")
                elif 12 <= rr <= 20:
                    reassuring.append("respiratory rate is within the usual adult resting range")
            if hr is not None:
                if hr >= 100:
                    concerning.append("tachycardia")
                elif 50 <= hr <= 100:
                    reassuring.append("heart rate is not elevated")
            if sbp is not None and sbp < 100:
                concerning.append("low systolic blood pressure")
            if lactate is not None and lactate >= 2:
                concerning.append("elevated lactate")
            if risk_score >= 0.50:
                if concerning:
                    return "The SpO2 deterioration prediction is concerning because it is supported by " + ", ".join(concerning) + "."
                return "The SpO2 deterioration prediction is elevated even though the last values are not strongly abnormal; review the full CSV trend."
            if reassuring:
                return "The SpO2 deterioration prediction is currently stable because " + ", ".join(reassuring[:3]) + ". Continue routine monitoring."
            return "The LSTM SpO2 model classifies the current short-term risk as low; interpret it with the full time trend and clinical context."

        if model_kind == "respiratory":
            if risk_score >= 0.50:
                return "The respiratory audio prediction is concerning because the uploaded audio/symptom pattern suggests abnormal respiratory sounds or symptoms."
            return "The respiratory audio prediction is currently reassuring, but cough/wheeze symptoms should continue to be monitored."

        return "The prediction should be interpreted according to the selected model outputs and the patient’s clinical context."

    def _recommendations_for_summary(
        self,
        risk_score: float,
        data: Dict[str, Any],
        factors: List[Dict[str, Any]],
        model_kind: str,
    ) -> str:
        rows: List[str] = []

        if model_kind == "apnea":
            if risk_score >= 0.75:
                rows.append("- Review the uploaded apnea signal urgently and confirm whether the predicted apnea windows match the annotated .apn events.")
                rows.append("- Assess sleep-breathing context: repeated pauses, desaturation episodes if available, daytime fatigue, and respiratory distress signs.")
            elif risk_score >= 0.50:
                rows.append("- Review the apnea signal windows and verify signal quality before acting on the prediction.")
                rows.append("- Compare predicted apnea windows with clinical symptoms and any available sleep/respiratory observations.")
            else:
                rows.append("- Continue routine apnea/sleep-breathing monitoring if symptoms remain stable.")
                rows.append("- Re-run the model if a new .apn/.dat/.hea record is uploaded or symptoms worsen.")
            rows.append("- Use apnea-related guideline sources as support, then validate the decision with the treating clinician.")
            return "\n".join(rows)

        if model_kind == "spo2":
            spo2 = self._num(data.get("spo2_pct", data.get("spo2")), default=None)
            rr = self._num(data.get("respiratory_rate"), default=None)
            hr = self._num(data.get("heart_rate"), default=None)
            sbp = self._num(data.get("systolic_bp"), default=None)
            lactate = self._num(data.get("lactate"), default=None)
            if risk_score >= 0.75:
                rows.append("- Urgent clinical review is recommended according to local escalation protocol.")
            elif risk_score >= 0.50:
                rows.append("- Increase monitoring frequency and reassess the patient’s respiratory and hemodynamic status.")
            elif risk_score >= 0.30:
                rows.append("- Continue close observation and compare the latest values with previous CSV measurements.")
            else:
                rows.append("- Continue routine monitoring and repeat assessment if the trend worsens.")
            if spo2 is not None and spo2 < 94:
                rows.append("- Recheck pulse oximetry quality, oxygen saturation trend, and oxygen requirement if applicable.")
            if rr is not None and rr >= 22:
                rows.append("- Review work of breathing, respiratory rate trend, and signs of respiratory distress.")
            if hr is not None and hr >= 100:
                rows.append("- Review heart rate trend and possible causes such as fever, pain, hypoxia, dehydration, or infection.")
            if sbp is not None and sbp < 100:
                rows.append("- Reassess blood pressure and perfusion status, and follow local escalation guidance.")
            if lactate is not None and lactate >= 2:
                rows.append("- Consider whether lactate elevation fits the clinical picture and whether sepsis screening is appropriate.")
            rows.append("- Use the retrieved SpO2/vital-sign guideline sources as support, then validate the decision with the treating clinician.")
            return "\n".join(rows)

        if model_kind == "respiratory":
            if risk_score >= 0.50:
                rows.append("- Review wheeze/cough features and compare them with bedside respiratory examination.")
                rows.append("- Consider asthma/COPD exacerbation context if it matches the patient history.")
            else:
                rows.append("- Continue routine respiratory symptom and audio monitoring.")
            rows.append("- Validate the model output with clinical examination and local protocol.")
            return "\n".join(rows)

        if risk_score >= 0.75:
            rows.append("- Urgent clinical review is recommended according to local escalation protocol.")
        elif risk_score >= 0.50:
            rows.append("- Increase monitoring frequency and reassess the patient.")
        else:
            rows.append("- Continue monitoring and reassess if the trend worsens.")
        rows.append("- Validate the output with the treating clinician.")
        return "\n".join(rows)

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------
    def _model_kind(self, selected_models: List[str], model_name: str = "") -> str:
        values = {str(item).lower() for item in selected_models}
        name = str(model_name or "").lower()
        if values == {"apnea"} or ("apnea" in values and len(values) == 1) or "cnn_bilstm" in name:
            return "apnea"
        if values == {"spo2"} or values == {"vitals"} or "lstm_spo2" in name or "spo2" in name:
            return "spo2"
        if values == {"respiratory"} or "model_best" in name or "respiratory" in name:
            return "respiratory"
        return "combined"

    def _model_title(self, model_kind: str) -> str:
        return {
            "apnea": "Model 1 · CNN-BiLSTM Apnea Signals",
            "spo2": "Model 2 · LSTM SpO2 Deterioration",
            "respiratory": "Respiratory Audio Model",
            "combined": "Combined AI models",
        }.get(model_kind, "Selected AI model")

    def _format_number(self, value: Any) -> str:
        if isinstance(value, str) and not value.replace(",", ".").replace(".", "", 1).replace("-", "", 1).isdigit():
            return value
        try:
            number = float(str(value).replace(",", "."))
        except Exception:
            return str(value)
        if number.is_integer():
            return str(int(number))
        return f"{number:.2f}".rstrip("0").rstrip(".")

    def _num(self, value: Any, default: Optional[float] = 0.0) -> Optional[float]:
        if value is None:
            return default
        try:
            return float(str(value).replace(",", "."))
        except Exception:
            return default
