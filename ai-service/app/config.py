from functools import lru_cache
import os
from pathlib import Path

from pydantic import BaseModel


class Settings(BaseModel):
    host: str = os.getenv("AI_SERVICE_HOST", "0.0.0.0")
    port: int = int(os.getenv("AI_SERVICE_PORT", "8100"))
    models_dir: Path
    max_series_length: int = int(os.getenv("MAX_SERIES_LENGTH", "72"))
    distress_threshold: float = float(os.getenv("DISTRESS_THRESHOLD", "0.55"))
    load_real_models: bool = os.getenv("AI_LOAD_REAL_MODELS", "1").lower() not in {"0", "false", "no"}


def _resolve_models_dir() -> Path:
    raw_value = os.getenv("AI_MODELS_DIR") or os.getenv("MODELS_DIR") or "../models"
    raw_path = Path(raw_value)
    service_dir = Path(__file__).resolve().parents[1]
    repo_root = service_dir.parent

    candidates = [
        raw_path,
        Path.cwd() / raw_path,
        service_dir / raw_path,
        repo_root / raw_path,
        repo_root / "models",
    ]

    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.exists():
            return resolved

    return (repo_root / "models").resolve()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(models_dir=_resolve_models_dir())

