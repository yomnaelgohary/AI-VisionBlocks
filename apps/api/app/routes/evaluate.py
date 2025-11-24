from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from app.services.model_service import evaluate_active_model_on_test

router = APIRouter(prefix="/evaluate", tags=["evaluate"])


@router.get("/test")
def evaluate_test() -> Dict[str, Any]:
    try:
        resp = evaluate_active_model_on_test()
        resp.setdefault("ok", True)
        return resp
    except (RuntimeError, KeyError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
