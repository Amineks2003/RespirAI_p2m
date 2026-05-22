from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


APP_DIR = Path(__file__).resolve().parent
DEFAULT_DOCS_DIR = APP_DIR / "rag_docs"
DEFAULT_VECTORSTORE_DIR = APP_DIR / "vectorstore"


CATEGORY_KEYWORDS = {
    "news2": ["news2", "early warning", "deterioration", "acute illness", "vital signs", "respiratory rate", "heart rate", "blood pressure"],
    "oxygen": ["oxygen", "spo2", "saturation", "hypoxemia", "hypoxaemia", "pulse oximetry", "oxygen therapy"],
    "asthma": ["gina", "asthma", "wheezing", "bronchodilator", "exacerbation"],
    "copd": ["gold", "copd", "chronic obstructive", "emphysema", "chronic bronchitis", "exacerbation"],
    "sepsis": ["sepsis", "lactate", "shock", "hypotension", "surviving sepsis"],
    "general": ["clinical", "monitoring", "guideline", "patient", "respiratory"],
}


@dataclass
class SearchResult:
    text: str
    score: float
    source: str
    page: int
    category: str
    title: str

    def as_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "score": round(float(self.score), 4),
            "relevance": round(float(self.score) * 100, 1),
            "source": self.source,
            "reference": f"{self.title}, p. {self.page}",
            "page": self.page,
            "category": self.category,
            "title": self.title,
            "badge": self.category.upper(),
        }


def clean_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def infer_category(filename: str, text: str = "") -> str:
    value = f"{filename} {text[:1000]}".lower()
    if "news2" in value or "early warning" in value:
        return "news2"
    if "nice" in value or "acutely ill" in value:
        return "news2"
    if "oxygen" in value or "bts" in value or "pulse oxim" in value or "hypox" in value:
        return "oxygen"
    if "gina" in value or "asthma" in value:
        return "asthma"
    if "gold" in value or "copd" in value or "chronic obstructive" in value:
        return "copd"
    if "sepsis" in value or "lactate" in value or "shock" in value:
        return "sepsis"
    return "general"


def chunk_text(text: str, chunk_size: int = 1200, overlap: int = 180) -> List[str]:
    text = clean_text(text)
    if not text:
        return []

    chunks: List[str] = []
    start = 0
    text_len = len(text)

    while start < text_len:
        end = min(text_len, start + chunk_size)
        chunk = text[start:end]

        # Try to avoid cutting the sentence in the middle.
        if end < text_len:
            last_period = max(chunk.rfind(". "), chunk.rfind("; "), chunk.rfind(": "))
            if last_period > chunk_size * 0.55:
                end = start + last_period + 1
                chunk = text[start:end]

        chunk = clean_text(chunk)
        if len(chunk) > 80:
            chunks.append(chunk)

        next_start = max(end - overlap, start + 1)
        if next_start <= start:
            next_start = end
        start = next_start

    return chunks


class LocalRagIndex:
    """Simple local vector index for medical PDFs.

    It is intentionally API-key-free and deployment-friendly:
    - PDF extraction with pypdf
    - TF-IDF retrieval with scikit-learn
    - local files in app/vectorstore
    """

    def __init__(
        self,
        docs_dir: Path | str = DEFAULT_DOCS_DIR,
        vectorstore_dir: Path | str = DEFAULT_VECTORSTORE_DIR,
    ):
        self.docs_dir = Path(docs_dir)
        self.vectorstore_dir = Path(vectorstore_dir)
        self.chunks_path = self.vectorstore_dir / "rag_chunks.json"
        self.vectorizer_path = self.vectorstore_dir / "tfidf_vectorizer.joblib"
        self.matrix_path = self.vectorstore_dir / "tfidf_matrix.joblib"
        self.manifest_path = self.vectorstore_dir / "manifest.json"

        self.chunks: List[Dict[str, Any]] = []
        self.vectorizer: Optional[TfidfVectorizer] = None
        self.matrix = None

    def status(self) -> Dict[str, Any]:
        return {
            "docs_dir": str(self.docs_dir),
            "vectorstore_dir": str(self.vectorstore_dir),
            "docs_dir_exists": self.docs_dir.exists(),
            "index_exists": self.chunks_path.exists() and self.vectorizer_path.exists() and self.matrix_path.exists(),
            "chunks": len(self.chunks),
            "pdf_count": len(list(self.docs_dir.glob("*.pdf"))) if self.docs_dir.exists() else 0,
        }

    def load_or_build(self, force_rebuild: bool = False) -> None:
        if not force_rebuild and self._index_files_exist():
            self.load()
            return
        self.build()

    def _index_files_exist(self) -> bool:
        return self.chunks_path.exists() and self.vectorizer_path.exists() and self.matrix_path.exists()

    def load(self) -> None:
        with open(self.chunks_path, "r", encoding="utf-8") as f:
            self.chunks = json.load(f)
        self.vectorizer = joblib.load(self.vectorizer_path)
        self.matrix = joblib.load(self.matrix_path)

    def build(self) -> None:
        self.vectorstore_dir.mkdir(parents=True, exist_ok=True)
        self.docs_dir.mkdir(parents=True, exist_ok=True)

        pdf_files = sorted(self.docs_dir.glob("*.pdf"))
        chunks: List[Dict[str, Any]] = []

        for pdf_file in pdf_files:
            chunks.extend(self._extract_pdf_chunks(pdf_file))

        if not chunks:
            self.chunks = []
            self.vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), max_features=20000)
            self.matrix = self.vectorizer.fit_transform(["empty medical guideline placeholder"])
            self._save_manifest(pdf_files, warning="No PDF chunks indexed yet.")
            with open(self.chunks_path, "w", encoding="utf-8") as f:
                json.dump([], f, ensure_ascii=False, indent=2)
            joblib.dump(self.vectorizer, self.vectorizer_path)
            joblib.dump(self.matrix, self.matrix_path)
            return

        texts = [chunk["text"] for chunk in chunks]
        vectorizer = TfidfVectorizer(
            stop_words="english",
            ngram_range=(1, 2),
            max_features=50000,
            sublinear_tf=True,
        )
        matrix = vectorizer.fit_transform(texts)

        self.chunks = chunks
        self.vectorizer = vectorizer
        self.matrix = matrix

        with open(self.chunks_path, "w", encoding="utf-8") as f:
            json.dump(chunks, f, ensure_ascii=False, indent=2)
        joblib.dump(vectorizer, self.vectorizer_path)
        joblib.dump(matrix, self.matrix_path)
        self._save_manifest(pdf_files)

    def _save_manifest(self, pdf_files: List[Path], warning: str | None = None) -> None:
        manifest = {
            "documents": [
                {"name": path.name, "size_bytes": path.stat().st_size if path.exists() else 0}
                for path in pdf_files
            ],
            "chunks": len(self.chunks),
            "warning": warning,
        }
        with open(self.manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)

    def _extract_pdf_chunks(self, pdf_file: Path) -> List[Dict[str, Any]]:
        try:
            from pypdf import PdfReader
        except Exception as exc:
            raise RuntimeError("pypdf is required. Install it with: pip install pypdf") from exc

        reader = PdfReader(str(pdf_file))
        output: List[Dict[str, Any]] = []
        title = pdf_file.stem.replace("_", " ")

        for page_idx, page in enumerate(reader.pages, start=1):
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""

            text = clean_text(text)
            if not text:
                continue

            category = infer_category(pdf_file.name, text)
            for chunk_idx, chunk in enumerate(chunk_text(text)):
                output.append(
                    {
                        "id": f"{pdf_file.stem}:p{page_idx}:c{chunk_idx}",
                        "text": chunk,
                        "source": pdf_file.name,
                        "title": title,
                        "page": page_idx,
                        "category": category,
                    }
                )
        return output

    def search(
        self,
        query: str,
        categories: Optional[List[str]] = None,
        top_k: int = 5,
        min_score: float = 0.03,
        max_per_source: int = 3,
    ) -> List[Dict[str, Any]]:
        """Search relevant clinical guideline chunks.

        Improvements:
        - Removes duplicate results from the same PDF page.
        - Keeps only the best chunk for each (source, page).
        - Limits how many results can come from the same PDF so the UI shows
          more diverse clinical sources.
        """
        if self.vectorizer is None or self.matrix is None:
            self.load_or_build()

        if not self.chunks:
            return []

        safe_query = clean_text(query or "")
        if not safe_query:
            return []

        categories_set = set(categories or [])
        query_vector = self.vectorizer.transform([safe_query])
        scores = cosine_similarity(query_vector, self.matrix).ravel()

        ranked: List[Tuple[int, float]] = []

        for idx, score in enumerate(scores):
            chunk = self.chunks[idx]

            if categories_set and chunk.get("category") not in categories_set:
                continue

            score_float = float(score)
            if score_float >= min_score:
                ranked.append((idx, score_float))

        ranked.sort(key=lambda item: item[1], reverse=True)

        # Step 1:
        # Keep only the best-scoring chunk for the same PDF page.
        # This avoids repeated display like:
        # NEWS2_RCP.pdf p.38
        # NEWS2_RCP.pdf p.38
        # NEWS2_RCP.pdf p.38
        best_by_page: Dict[Tuple[str, int], Tuple[int, float]] = {}

        for idx, score in ranked:
            chunk = self.chunks[idx]
            source = str(chunk.get("source", ""))
            page = int(chunk.get("page", 0))
            key = (source, page)

            if key not in best_by_page or score > best_by_page[key][1]:
                best_by_page[key] = (idx, score)

        unique_ranked = sorted(
            best_by_page.values(),
            key=lambda item: item[1],
            reverse=True,
        )

        # Step 2:
        # Limit the number of results per PDF source to improve diversity.
        results: List[Dict[str, Any]] = []
        source_counts: Dict[str, int] = {}

        for idx, score in unique_ranked:
            chunk = self.chunks[idx]
            source = str(chunk.get("source", ""))

            current_count = source_counts.get(source, 0)
            if current_count >= max_per_source:
                continue

            results.append(
                SearchResult(
                    text=chunk["text"],
                    score=score,
                    source=source,
                    page=int(chunk["page"]),
                    category=chunk["category"],
                    title=chunk.get("title") or source,
                ).as_dict()
            )
            source_counts[source] = current_count + 1

            if len(results) >= top_k:
                break

        # Step 3:
        # If limiting per source made the result set too small, fill remaining
        # slots with the best unique pages regardless of source.
        if len(results) < top_k:
            already_seen_pages = {
                (item["source"], int(item["page"]))
                for item in results
            }

            for idx, score in unique_ranked:
                chunk = self.chunks[idx]
                source = str(chunk.get("source", ""))
                page = int(chunk.get("page", 0))
                key = (source, page)

                if key in already_seen_pages:
                    continue

                results.append(
                    SearchResult(
                        text=chunk["text"],
                        score=score,
                        source=source,
                        page=page,
                        category=chunk["category"],
                        title=chunk.get("title") or source,
                    ).as_dict()
                )
                already_seen_pages.add(key)

                if len(results) >= top_k:
                    break

        return results
