from __future__ import annotations

from typing import Any, Dict, Iterable, List


GUIDELINES: List[Dict[str, str]] = [
    {
        "source": "WHO",
        "reference": "WHO Respiratory Care",
        "text": "Escalate respiratory monitoring when oxygen saturation falls, respiratory effort rises, or clinical deterioration is suspected.",
        "tags": "spo2 oxygen respiratory deterioration triage monitoring",
    },
    {
        "source": "GINA",
        "reference": "GINA Asthma Strategy",
        "text": "Wheeze, cough, dyspnea, falling oxygen saturation, and reliever need are important warning signals in asthma exacerbation assessment.",
        "tags": "wheeze cough dyspnea asthma exacerbation respiratory",
    },
    {
        "source": "GOLD",
        "reference": "GOLD COPD Guidance",
        "text": "COPD exacerbation risk increases with worsening dyspnea, sputum or cough burden, low oxygen saturation, and comorbidity load.",
        "tags": "copd cough dyspnea spo2 comorbidity respiratory",
    },
    {
        "source": "ATS",
        "reference": "ATS Clinical Respiratory Monitoring",
        "text": "Repeated abnormal respiratory rate, oxygen saturation, and heart rate trends should be interpreted together rather than as isolated readings.",
        "tags": "heart rate respiratory rate trend spo2 monitoring",
    },
    {
        "source": "AASM",
        "reference": "Sleep-Disordered Breathing Screening",
        "text": "Nocturnal desaturation and irregular respiratory pauses are compatible with sleep-disordered breathing and warrant clinical review.",
        "tags": "apnea sleep desaturation oxygen respiratory pauses",
    },
    {
        "source": "ERS",
        "reference": "Respiratory Sound Assessment",
        "text": "Abnormal lung sounds such as wheeze or crackles can support assessment when combined with symptoms and vital signs.",
        "tags": "audio wheeze crackles lung sounds respiratory",
    },
]


def _tokenize(value: str) -> set[str]:
    return {part.strip().lower() for part in value.replace(",", " ").replace(".", " ").split() if part.strip()}


def retrieve_guidelines(
    *,
    query: str = "",
    signals: Dict[str, Any] | None = None,
    selected_models: Iterable[str] | None = None,
    limit: int = 4,
) -> List[Dict[str, Any]]:
    signals = signals or {}
    selected = set(selected_models or [])
    query_terms = _tokenize(query)

    if signals.get("spo2", 100) < 94:
        query_terms.update({"spo2", "oxygen", "desaturation"})
    if signals.get("respiratory_rate", 16) >= 22:
        query_terms.update({"respiratory", "dyspnea"})
    if signals.get("wheezing"):
        query_terms.update({"wheeze", "asthma"})
    if signals.get("cough_events", 0) > 0 or signals.get("cough"):
        query_terms.update({"cough", "respiratory"})
    if "apnea" in selected:
        query_terms.update({"apnea", "sleep", "desaturation"})
    if "respiratory" in selected:
        query_terms.update({"audio", "wheeze", "lung", "sounds"})

    ranked = []
    for item in GUIDELINES:
        tags = _tokenize(item["tags"])
        text_terms = _tokenize(item["text"])
        overlap = len(query_terms & (tags | text_terms))
        relevance = min(0.99, 0.62 + overlap * 0.07)
        ranked.append((relevance, item))

    ranked.sort(key=lambda pair: pair[0], reverse=True)
    return [
        {
            "source": item["source"],
            "reference": item["reference"],
            "snippet": item["text"],
            "text": item["text"],
            "relevance": round(relevance, 3),
        }
        for relevance, item in ranked[: max(1, min(24, limit))]
    ]

