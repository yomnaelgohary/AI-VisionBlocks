from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.model_service import (
    build_model_for_dataset,
    save_active_model,
    load_model_for_dataset,
)
from app.services.split_service import split_state

router = APIRouter(prefix="/model", tags=["model"])


class LayerSpecModel(BaseModel):
    type: str
    params: Dict[str, Any] = {}


class ModelSpecModel(BaseModel):
    name: str = "my-model"
    layers: List[LayerSpecModel] = []


class BuildReq(BaseModel):
    dataset_key: str
    spec: ModelSpecModel
    use_active_split: bool = Field(True, description="Require an active train/test split")


class SaveReq(BaseModel):
    dataset_key: str
    model_name: str = Field(..., min_length=1)


class LoadReq(BaseModel):
    dataset_key: str
    model_name: str = Field(..., min_length=1)


@router.post("/build")
def model_build(body: BuildReq) -> Dict[str, Any]:
    # Optional: enforce that a split exists when requested
    if body.use_active_split:
        st = split_state(body.dataset_key)
        if not st:
            raise HTTPException(
                status_code=400,
                detail="No active split for this dataset. Use the split blocks to apply a train/test split first.",
            )
    try:
        resp = build_model_for_dataset(body.dataset_key, spec_dict=body.spec.dict())
        # Ensure there's an 'ok' field for the frontend
        resp.setdefault("ok", True)
        return resp
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/save")
def model_save(body: SaveReq) -> Dict[str, Any]:
    try:
        return save_active_model(body.dataset_key, body.model_name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/load")
def model_load(body: LoadReq) -> Dict[str, Any]:
    try:
        return load_model_for_dataset(body.dataset_key, body.model_name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
