from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse


TRUSTED_MEDICAL_DOMAINS = [
    "who.int",
    "nice.org.uk",
    "rcp.ac.uk",
    "goldcopd.org",
    "ginasthma.org",
    "thoracic.org",
    "sccm.org",
    "nih.gov",
    "ncbi.nlm.nih.gov",
    "cdc.gov",
]


@dataclass
class WebSearchResult:
    title: str
    url: str
    content: str
    score: float
    domain: str

    def as_rag_source(self) -> Dict[str, Any]:
        return {
            "text": self.content,
            "score": round(float(self.score), 4),
            "relevance": round(float(self.score) * 100, 1),
            "source": self.url,
            "reference": self.title or self.url,
            "page": None,
            "category": "web",
            "title": self.title or self.domain,
            "badge": "WEB",
            "url": self.url,
            "domain": self.domain,
        }


class ControlledMedicalWebSearch:
    """Trusted-domain web search for medical RAG.

    This class uses Tavily when TAVILY_API_KEY is configured.
    It never searches arbitrary domains: results are restricted to
    TRUSTED_MEDICAL_DOMAINS or to a stricter domain list passed to search().
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        trusted_domains: Optional[List[str]] = None,
        max_results: int = 5,
    ):
        self.api_key = api_key or os.getenv("TAVILY_API_KEY")
        self.trusted_domains = trusted_domains or TRUSTED_MEDICAL_DOMAINS
        self.max_results = int(max_results or 5)
        self.client = None
        self.error: Optional[str] = None

        if not self.api_key:
            self.error = "TAVILY_API_KEY is not configured."
            return

        try:
            from tavily import TavilyClient  # type: ignore

            self.client = TavilyClient(api_key=self.api_key)
        except Exception as exc:  # pragma: no cover - depends on optional package
            self.error = f"Tavily client unavailable: {exc}"

    def available(self) -> bool:
        return self.client is not None and not self.error

    def status(self) -> Dict[str, Any]:
        return {
            "available": self.available(),
            "engine": "tavily_controlled_medical_web_search",
            "trusted_domains": self.trusted_domains,
            "error": self.error,
        }

    def search(
        self,
        query: str,
        top_k: int = 4,
        include_domains: Optional[List[str]] = None,
        search_depth: str = "advanced",
    ) -> List[Dict[str, Any]]:
        if not self.available():
            return []

        domains = self._normalize_domains(include_domains or self.trusted_domains)
        max_results = max(1, min(int(top_k or self.max_results), 10))

        try:
            response = self.client.search(
                query=query,
                search_depth=search_depth,
                topic="general",
                max_results=max_results,
                include_domains=domains,
                include_answer=False,
                include_raw_content=False,
                include_images=False,
            )
        except Exception as exc:
            self.error = f"Web search failed: {exc}"
            return []

        raw_results = response.get("results", []) if isinstance(response, dict) else []
        results: List[Dict[str, Any]] = []
        seen_urls = set()

        for item in raw_results:
            url = str(item.get("url") or "").strip()
            if not url or url in seen_urls:
                continue

            domain = self._domain(url)
            if not self._is_trusted_domain(domain, domains):
                continue

            title = str(item.get("title") or domain or "Trusted medical source").strip()
            content = str(item.get("content") or item.get("raw_content") or "").strip()
            if len(content) < 40:
                continue

            score = item.get("score", 0.72)
            try:
                score_float = float(score)
            except Exception:
                score_float = 0.72

            seen_urls.add(url)
            results.append(
                WebSearchResult(
                    title=title,
                    url=url,
                    content=content,
                    score=max(0.0, min(1.0, score_float)),
                    domain=domain,
                ).as_rag_source()
            )

            if len(results) >= max_results:
                break

        return results

    def _normalize_domains(self, domains: List[str]) -> List[str]:
        cleaned = []
        for domain in domains:
            value = str(domain or "").strip().lower()
            value = value.replace("https://", "").replace("http://", "")
            value = value.split("/")[0]
            if value and value not in cleaned:
                cleaned.append(value)
        return cleaned

    def _domain(self, url: str) -> str:
        try:
            hostname = urlparse(url).hostname or ""
        except Exception:
            hostname = ""
        return hostname.lower().removeprefix("www.")

    def _is_trusted_domain(self, domain: str, trusted_domains: List[str]) -> bool:
        if not domain:
            return False
        for trusted in trusted_domains:
            trusted = trusted.lower().removeprefix("www.")
            if domain == trusted or domain.endswith("." + trusted):
                return True
        return False
