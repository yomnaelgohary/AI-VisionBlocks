from __future__ import annotations
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Dict, Any

from app.services.split_service import (
    preview_split,
    apply_split,
    split_state,
    check_bias_train,
    balance_train_inplace,  # in-session balancing
)

router = APIRouter(prefix="/split", tags=["split"])


class PreviewReq(BaseModel):
    dataset_key: str
    train_pct: int = Field(80, ge=1, le=99)


class ApplyReq(BaseModel):
    dataset_key: str
    train_pct: int = Field(80, ge=1, le=99)
    shuffle: bool = True


class BiasReq(BaseModel):
    dataset_key: str
    threshold_pct: int = Field(10, ge=1, le=50)


# In-session balancing (no files written)
class BalanceReq(BaseModel):
    dataset_key: str
    mode: str  # 'duplicate' | 'augment' | 'undersample'
    target_min_pct: int = Field(25, ge=5, le=50)


@router.post("/preview")
def split_preview(body: PreviewReq) -> Dict[str, Any]:
    try:
        sv = preview_split(body.dataset_key, body.train_pct)
        return {
            "dataset_key": sv.dataset_key,
            "train_pct": sv.train_pct,
            "classes": sv.classes,
            "total_per_class": sv.total_per_class,
            "train_per_class": sv.train_per_class,
            "test_per_class": sv.test_per_class,
        }
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/apply")
def split_apply(body: ApplyReq) -> Dict[str, Any]:
    try:
        return apply_split(body.dataset_key, body.train_pct, shuffle=body.shuffle)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/state")
def split_current_state(dataset_key: str) -> Dict[str, Any]:
    st = split_state(dataset_key)
    if not st:
        raise HTTPException(status_code=404, detail="No active split for this dataset.")
    return {"dataset_key": dataset_key, **st}


@router.post("/bias")
def split_bias(body: BiasReq) -> Dict[str, Any]:
    try:
        return check_bias_train(body.dataset_key, threshold_pct=body.threshold_pct)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))


# In-session balancing; mutates active TRAIN indices only
@router.post("/balance")
def split_balance(body: BalanceReq) -> Dict[str, Any]:
    try:
        return balance_train_inplace(
            dataset_key=body.dataset_key,
            mode=body.mode,
            target_min_pct=body.target_min_pct,
        )
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
