from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.model_service import predict_on_sample

router = APIRouter(prefix="/predict", tags=["predict"])


class PredictSampleReq(BaseModel):
    dataset_key: str
    path: str  # relative path from the dataset root, as returned by /datasets/{key}/sample


@router.post("/sample")
def predict_sample(body: PredictSampleReq) -> Dict[str, Any]:
    try:
        resp = predict_on_sample(body.dataset_key, body.path)
        resp.setdefault("ok", True)
        return resp
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except (RuntimeError, KeyError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
