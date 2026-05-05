from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class PredictRequest(BaseModel):
    patient_id: Optional[str] = None
    intake_form: Dict[str, Any] = Field(default_factory=dict)
    physiology: List[Dict[str, Any]] = Field(default_factory=list)
    environment: Dict[str, Any] = Field(default_factory=dict)
    model: Optional[str] = None
    selected_models: Optional[List[str]] = None
    top_k_guidelines: int = 4

    class Config:
        extra = "allow"


class FilePayload(BaseModel):
    filename: str = ""
    content_type: Optional[str] = None
    size: Optional[int] = None
    data_base64: Optional[str] = None

    class Config:
        extra = "allow"


class ManualFiles(BaseModel):
    apn_file: Optional[FilePayload] = None
    dat_file: Optional[FilePayload] = None
    hea_file: Optional[FilePayload] = None
    wav_files: List[FilePayload] = Field(default_factory=list)

    class Config:
        extra = "allow"


class ManualRunRequest(BaseModel):
    model: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    files: ManualFiles = Field(default_factory=ManualFiles)
    top_k_guidelines: int = 4

    class Config:
        extra = "allow"
