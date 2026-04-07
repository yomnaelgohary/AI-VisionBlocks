from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class BlockModel(BaseModel):
    type: str
    fields: Dict[str, Any] = {}


class ChainModel(BaseModel):
    top_block_type: Optional[str] = None
    blocks: List[BlockModel] = []


class AnalyzeRequest(BaseModel):
    chains: List[ChainModel]
    # optional client-side signature to help debugging / caching
    client_signature: Optional[str] = None


class ChecklistItem(BaseModel):
    key: str
    label: str
    state: str


class PlannedAction(BaseModel):
    action: str
    tool: str
    args: Dict[str, Any] = {}
    requires: Optional[str] = None


class AnalyzeResponse(BaseModel):
    signature: str
    chains: List[ChainModel]
    checklist: List[ChecklistItem]
    planned_actions: List[PlannedAction]


REQUIRED_ORDER = [
    "dataset.select",
    "dataset.info",
    "dataset.class_counts",
    "dataset.class_distribution_preview",
    "dataset.sample_image",
    "image.channels_split",
]


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze_workspace(req: AnalyzeRequest):
    # Canonicalize input for deterministic signature
    canonical = json.dumps(
        json.loads(req.json()), sort_keys=True, separators=(",", ":")
    )
    sig = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    # Find the primary chain (the one containing dataset.select)
    primary_chain = None
    for ch in req.chains:
        if any(b.type == "dataset.select" for b in ch.blocks):
            primary_chain = ch
            break
    # If none found, try first chain
    if primary_chain is None and req.chains:
        primary_chain = req.chains[0]

    # Build checklist deterministically
    checklist: List[ChecklistItem] = []
    for key in REQUIRED_ORDER:
        label = key
        state = "missing"
        if primary_chain is not None:
            present = any(b.type == key for b in primary_chain.blocks)
            if present:
                # check order: key must appear after dataset.select (unless it's dataset.select)
                if key == "dataset.select":
                    state = "ok"
                else:
                    types = [b.type for b in primary_chain.blocks]
                    try:
                        ds_idx = types.index("dataset.select")
                        key_idx = types.index(key)
                        state = "ok" if key_idx > ds_idx else "wrong_place"
                    except ValueError:
                        state = "missing"
        checklist.append(ChecklistItem(key=key, label=label, state=state))

    # Extract dataset key and sample config if available
    dataset_key = None
    sample_conf: Optional[Dict[str, Any]] = None
    sample_block_path = None
    if primary_chain is not None:
        for b in primary_chain.blocks:
            if b.type == "dataset.select":
                dataset_key = b.fields.get("DATASET") or b.fields.get("dataset")
            if b.type == "dataset.sample_image":
                mode = b.fields.get("MODE") or b.fields.get("mode") or "random"
                idx = b.fields.get("INDEX") or b.fields.get("index")
                if mode == "index":
                    try:
                        idx = int(idx)
                    except Exception:
                        idx = 0
                    sample_conf = {"mode": "index", "index": idx}
                else:
                    sample_conf = {"mode": "random"}

    # Map blocks to planned actions (no side-effects)
    planned: List[PlannedAction] = []

    def append_for_block(b: BlockModel):
        if b.type == "dataset.info":
            planned.append(
                PlannedAction(action="dataset_info", tool="get_dataset_info", args={"dataset_key": dataset_key or ""})
            )
        elif b.type == "dataset.class_counts":
            planned.append(
                PlannedAction(action="dataset_class_counts", tool="get_dataset_info", args={"dataset_key": dataset_key or ""})
            )
        elif b.type == "dataset.class_distribution_preview":
            planned.append(
                PlannedAction(action="dataset_distribution", tool="get_dataset_info", args={"dataset_key": dataset_key or ""})
            )
        elif b.type == "dataset.sample_image":
            # mode handled via sample_conf
            args = {"dataset_key": dataset_key or "", "mode": sample_conf.get("mode") if sample_conf else "random"}
            if sample_conf and sample_conf.get("mode") == "index":
                args["index"] = sample_conf.get("index", 0)
            planned.append(PlannedAction(action="get_sample", tool="get_sample", args=args))
        elif b.type == "image.channels_split":
            # This requires a sample path; indicate dependency
            planned.append(PlannedAction(action="split_channels", tool="split_channels", args={"path": "<sample.path>"}, requires="get_sample"))
        elif b.type == "image.to_grayscale_preview":
            planned.append(PlannedAction(action="grayscale", tool="grayscale", args={"path": "<sample.path>"}, requires="get_sample"))

    if primary_chain is not None:
        for blk in primary_chain.blocks:
            append_for_block(blk)

    return AnalyzeResponse(
        signature=sig,
        chains=req.chains,
        checklist=checklist,
        planned_actions=planned,
    )
