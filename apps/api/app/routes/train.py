from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.model_service import train_active_model

router = APIRouter(prefix="/train", tags=["train"])


class TrainReq(BaseModel):
    dataset_key: str
    epochs: int = Field(5, ge=1, le=50)
    batch: int = Field(32, ge=1, le=512)


@router.post("/start")
def train_start(body: TrainReq) -> Dict[str, Any]:
    try:
        resp = train_active_model(body.dataset_key, epochs=body.epochs, batch_size=body.batch)
        resp.setdefault("ok", True)
        return resp
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
