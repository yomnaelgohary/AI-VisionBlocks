from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services.datasets import dataset_info

load_dotenv()
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


class AnalyzeAgentResponse(BaseModel):
    analyzer: AnalyzeResponse
    agent_text: str


class _StudentHistory(BaseModel):
    last_missing_key: Optional[str] = None
    last_wrong_place: bool = False
    repeat_count: int = 0
    last_hint: Optional[str] = None
    last_seen: float = 0.0


_HISTORY: Dict[str, _StudentHistory] = {}


class _Module2Stage1History(BaseModel):
    last_problem_key: Optional[str] = None
    repeat_count: int = 0
    last_hint: Optional[str] = None
    last_seen: float = 0.0


_M2_STAGE1_HISTORY: Dict[str, _Module2Stage1History] = {}


REQUIRED_ORDER = [
    "dataset.select",
    "dataset.info",
    "dataset.class_counts",
    "dataset.class_distribution_preview",
    "dataset.sample_image",
    "image.channels_split",
]


def _get_next_missing_key(checklist: List[ChecklistItem]) -> Optional[str]:
    missing = {c.key for c in checklist if c.state == "missing"}
    for key in REQUIRED_ORDER:
        if key in missing:
            return key
    return None


def _local_hint_from_checklist(
    checklist: List[ChecklistItem],
    history: Optional[_StudentHistory] = None,
) -> str:
    def with_why(text: str, why: str) -> str:
        if history and history.repeat_count >= 1:
            return f"{text} because {why}."
        return text

    order = [c.key for c in checklist]
    missing = [c.key for c in checklist if c.state == "missing"]
    wrong_place = [c.key for c in checklist if c.state == "wrong_place"]

    if not order or "dataset.select" in missing:
        return with_why(
            "Start by choosing a dataset so we know what images to explore",
            "every other step depends on that choice",
        )
    if wrong_place:
        return with_why(
            "Try keeping all steps in one straight chain under the dataset so the flow makes sense",
            "order matters for how each result is interpreted",
        )

    next_key = next((k for k in REQUIRED_ORDER if k in missing), None)
    mention_name = bool(history and history.repeat_count >= 2)
    if next_key == "dataset.info":
        return with_why(
            (
                "Take a quick look at the dataset basics before moving on"
                if not mention_name
                else "Try the dataset info block next so the basics are clear"
            ),
            "those basics frame everything that follows",
        )
    if next_key == "dataset.class_counts":
        return with_why(
            (
                "Check how many examples each label has so you can spot tiny classes early"
                if not mention_name
                else "Try the class counts block next to see the label sizes"
            ),
            "rare classes can skew what a single sample seems to show",
        )
    if next_key == "dataset.class_distribution_preview":
        return with_why(
            (
                "Peek at the class balance to see if any label dominates"
                if not mention_name
                else "Try the class distribution preview block next to see balance"
            ),
            "imbalance changes how you should interpret later visuals",
        )
    if next_key == "dataset.sample_image":
        return with_why(
            (
                "Grab a single sample image so we can see what the data really looks like"
                if not mention_name
                else "Try the get sample image block next for a concrete example"
            ),
            "seeing a real example keeps the stats grounded",
        )
    if next_key == "image.channels_split":
        return with_why(
            (
                "Split the sample into color channels to see what each one contributes"
                if not mention_name
                else "Try the split RGB channels block next to inspect colors"
            ),
            "each channel can highlight different features",
        )

    return "Nice work so far keep going to complete the exploration flow."


def _history_key(req: AnalyzeRequest, request: Request) -> str:
    if req.client_signature:
        return req.client_signature
    client = request.client.host if request.client else "anon"
    return f"ip:{client}"


def _summarize_dataset(key: Optional[str]) -> str:
    if not key:
        return "dataset: none selected"
    try:
        info = dataset_info(key)
    except Exception:
        return f"dataset: {key} (details unavailable)"

    name = info.get("name") or key
    num_classes = info.get("num_classes")
    counts = info.get("approx_count") or {}
    if counts:
        min_count = min(counts.values())
        max_count = max(counts.values())
        if min_count <= 0:
            imbalance = "imbalance: unknown"
        else:
            ratio = max_count / min_count
            imbalance = f"imbalance: ~{ratio:.1f}x"
    else:
        imbalance = "imbalance: unknown"

    return f"dataset: {name} ({key}), num_classes={num_classes}, {imbalance}"


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


def _call_openrouter(prompt: str) -> str:
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="OPENROUTER_API_KEY not set")
    model = os.getenv("OPENROUTER_MODEL", "gpt-4o-mini")
    url = os.getenv("OPENROUTER_URL", "https://openrouter.ai/api/v1/chat/completions")
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 64,
        "temperature": 0.2,
    }
    max_attempts = 3
    backoff = 1.0
    last_error: Optional[Exception] = None

    for attempt in range(max_attempts):
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=60)
        except requests.RequestException as exc:
            last_error = exc
        else:
            if resp.status_code in (429, 502, 503, 504):
                last_error = HTTPException(
                    status_code=resp.status_code,
                    detail="OpenRouter rate limited or temporarily unavailable",
                )
            else:
                resp.raise_for_status()
                data = resp.json()
                if isinstance(data, dict) and data.get("choices"):
                    msg = data["choices"][0].get("message") or {}
                    return msg.get("content") or ""
                return ""

        if attempt < max_attempts - 1:
            time.sleep(backoff)
            backoff *= 2

    if isinstance(last_error, HTTPException):
        raise last_error
    raise HTTPException(status_code=502, detail="OpenRouter request failed")


@router.post("/analyze/module1/agent", response_model=AnalyzeAgentResponse)
def analyze_module1_with_agent(req: AnalyzeRequest, request: Request):
    analyzer = analyze_workspace(req)
    now = time.time()
    key = _history_key(req, request)
    history = _HISTORY.get(key) or _StudentHistory()

    next_missing_key = _get_next_missing_key(analyzer.checklist)
    wrong_place = any(c.state == "wrong_place" for c in analyzer.checklist)

    if not next_missing_key and not wrong_place:
        history.last_missing_key = None
        history.last_wrong_place = False
        history.repeat_count = 0

    if history.last_missing_key == next_missing_key and history.last_wrong_place == wrong_place:
        history.repeat_count += 1
    else:
        history.repeat_count = 0

    history.last_missing_key = next_missing_key
    history.last_wrong_place = wrong_place
    history.last_seen = now
    last_hint_text = history.last_hint or ""
    chain_order = ""
    last_block_type = ""
    if analyzer.chains:
        chain = analyzer.chains[0].blocks
        if chain:
            chain_order = " -> ".join(b.type for b in chain)
            last_block_type = chain[-1].type
    dataset_summary = _summarize_dataset(
        next((b.fields.get("DATASET") or b.fields.get("dataset") for b in analyzer.chains[0].blocks if b.type == "dataset.select"), None)
        if analyzer.chains
        else None
    )
    shared_context = (
        f"\n\nChain order: {chain_order or 'empty'}. "
        f"Last block: {last_block_type or 'none'}. "
        f"{dataset_summary}. "
        f"Student history: last_missing={history.last_missing_key}, wrong_place={history.last_wrong_place}, repeat_count={history.repeat_count}, last_hint={json.dumps(last_hint_text, ensure_ascii=True)}."
    )
    # Hint-only prompt: single next-step guidance, no full checklist, no block names
    if not next_missing_key and not wrong_place:
        prompt = (
            "You are a tutor for Module 1 (dataset exploration). "
            "The checklist shows everything is complete and in order. "
            "Respond with 1-2 sentences confirming the chain is complete and why the flow is good. "
            "You may mention block names. Be positive and concise."
        ) + shared_context
    elif next_missing_key == "dataset.select" and not wrong_place:
        prompt = (
            "You are a tutor for Module 1 (dataset exploration). "
            "The student has not selected a dataset yet. "
            "In 1-2 sentences, explain that they must choose a dataset first "
            "because every other step depends on it, and ask them to add the dataset.select block. "
            "Be gentle and clear. You may mention block names. "
            "If dataset summary is available, mention it briefly to ground the hint. "
            "Use a short analogy only occasionally if it helps. "
            "If repeat_count > 0, acknowledge the last hint and rephrase it."
        ) + shared_context
    elif wrong_place:
        prompt = (
            "You are a tutor for Module 1 (dataset exploration). "
            "The student placed one or more blocks before selecting a dataset. "
            "In 1-2 sentences, explain why dataset.select must come first, "
            "and ask them to move those blocks under the dataset.select block. "
            "Be gentle and clear. You may mention block names. "
            "If dataset summary is available, mention it briefly to ground the hint. "
            "Use a short analogy only occasionally if it helps. "
            "If repeat_count > 0, acknowledge the last hint and rephrase it."
        ) + shared_context
    else:
        prompt = (
        "You are a tutor for Module 1 (dataset exploration). "
        "Module 1 goal: help students inspect a dataset in this order: "
        "dataset.select -> dataset.info -> dataset.class_counts -> "
        "dataset.class_distribution_preview -> dataset.sample_image -> image.channels_split. "
        "Given the checklist and planned actions, respond with 2-3 sentences. "
        "First, briefly comment on the most recently added block (Last block). "
        "Then give a hint for ONLY the next missing step and explain briefly why it matters. "
        "Mention the relevant block name indirectly (blend it into the sentence), "
        "but do NOT explicitly instruct the student to add or place that block. "
        "Do NOT list multiple steps. Do NOT show the full checklist. "
        "Do NOT mention API/tool names. "
        "Speak in gentle, clear language. "
        "If dataset summary is available, mention it briefly to ground the hint. "
        "Use a short analogy only occasionally if it helps. "
        "If repeat_count > 0, acknowledge the last hint and rephrase it. "
        "Output 2-3 sentences, no bullets.\n\n"
        "If the student is repeating the same mistake, be a bit more explicit. "
        f"Checklist: {json.dumps([c.dict() for c in analyzer.checklist], ensure_ascii=True)}\n"
        f"Planned actions: {json.dumps([a.dict() for a in analyzer.planned_actions], ensure_ascii=True)}\n"
        ) + shared_context
    agent_text = _call_openrouter(prompt)

    history.last_hint = agent_text
    _HISTORY[key] = history

    return AnalyzeAgentResponse(analyzer=analyzer, agent_text=agent_text)


# Module 2 specific analyzer (mirrors apps/web/src/data/module2Stages.ts)
STAGE_REQUIREMENTS = [
    {
        "key": "stage1",
        "label": "Stage 1: Grayscale + Cleanup",
        "type": "pipeline",
        "required": [
            "m2.to_grayscale",
            "m2.brightness_contrast",
            "m2.blur_sharpen",
        ],
        "order": [
            "m2.to_grayscale",
            "m2.brightness_contrast",
            "m2.blur_sharpen",
        ],
    },
    {
        "key": "stage2",
        "label": "Stage 2: Resize & Pad",
        "type": "pipeline",
        "required": [
            "m2.to_grayscale",
            "m2.brightness_contrast",
            "m2.blur_sharpen",
            "m2.resize",
            "m2.pad",
        ],
        "order": [
            "m2.to_grayscale",
            "m2.brightness_contrast",
            "m2.blur_sharpen",
            "m2.resize",
            "m2.pad",
        ],
    },
    {
        "key": "stage3",
        "label": "Stage 3: Normalize",
        "type": "pipeline",
        "required": [
            "m2.to_grayscale",
            "m2.brightness_contrast",
            "m2.blur_sharpen",
            "m2.resize",
            "m2.pad",
            "m2.normalize",
        ],
        "order": [
            "m2.to_grayscale",
            "m2.brightness_contrast",
            "m2.blur_sharpen",
            "m2.resize",
            "m2.pad",
            "m2.normalize",
        ],
    },
    {
        "key": "stage4",
        "label": "Stage 4: Loop & Export",
        "type": "loop_export",
        "required": [
            "m2.to_grayscale",
            "m2.brightness_contrast",
            "m2.blur_sharpen",
            "m2.resize",
            "m2.pad",
            "m2.normalize",
        ],
        "order": [
            "m2.to_grayscale",
            "m2.brightness_contrast",
            "m2.blur_sharpen",
            "m2.resize",
            "m2.pad",
            "m2.normalize",
        ],
        "require_loop": True,
        "require_export": True,
    },
    {
        "key": "bonus",
        "label": "Bonus: Edge Detection",
        "type": "pipeline",
        "required": ["m2.edges"],
        "order": ["m2.edges"],
    },
]

M2_STAGE1_REQUIRED_ORDER = [
    "m2.to_grayscale",
    "m2.brightness_contrast",
    "m2.blur_sharpen",
]


def _map_m2_block_to_action(b: BlockModel, dataset_key: Optional[str], sample_conf: Optional[Dict[str, Any]]):
    t = b.type
    f = b.fields or {}
    if t == "m2.resize":
        mode = f.get("MODE") or f.get("mode") or "size"
        args = {"mode": mode}
        if mode == "size":
            args.update({"w": f.get("W"), "h": f.get("H"), "keep": f.get("KEEP")})
        elif mode == "fit":
            args.update({"max_side": f.get("MAXSIDE")})
        else:
            args.update({"pct": f.get("PCT")})
        return PlannedAction(action="resize", tool="resize", args=args, requires="get_sample")
    if t == "m2.crop_center":
        return PlannedAction(action="crop_center", tool="crop", args={"w": f.get("W"), "h": f.get("H")}, requires="get_sample")
    if t == "m2.pad":
        return PlannedAction(action="pad", tool="pad", args={"w": f.get("W"), "h": f.get("H"), "mode": f.get("MODE"), "color": [f.get("R"), f.get("G"), f.get("B")]}, requires="get_sample")
    if t == "m2.brightness_contrast":
        return PlannedAction(action="brightness_contrast", tool="brightness_contrast", args={"brightness": f.get("B"), "contrast": f.get("C")}, requires="get_sample")
    if t == "m2.blur_sharpen":
        return PlannedAction(action="blur_sharpen", tool="blur_sharpen", args={"blur": f.get("BLUR"), "sharpen": f.get("SHARP")}, requires="get_sample")
    if t == "m2.edges":
        return PlannedAction(action="edges", tool="edges", args={"method": f.get("METHOD"), "threshold": f.get("THRESH"), "overlay": f.get("OVERLAY")}, requires="get_sample")
    if t == "m2.to_grayscale":
        return PlannedAction(action="grayscale", tool="grayscale", args={}, requires="get_sample")
    if t == "m2.normalize":
        return PlannedAction(action="normalize", tool="normalize", args={"mode": f.get("MODE")}, requires="get_sample")
    if t == "m2.loop_dataset":
        return PlannedAction(action="loop_dataset", tool="loop_dataset", args={"subset": f.get("SUBSET"), "n": f.get("N"), "shuffle": f.get("SHUFFLE"), "progress_k": f.get("K")})
    if t == "m2.export_dataset":
        return PlannedAction(action="export_dataset", tool="export_dataset", args={"name": f.get("NAME"), "overwrite": f.get("OVERWRITE")}, requires="loop_dataset")
    return None


@router.post("/analyze/module2", response_model=AnalyzeResponse)
def analyze_module2(req: AnalyzeRequest):
    # Deterministic signature
    canonical = json.dumps(json.loads(req.json()), sort_keys=True, separators=(",", ":"))
    sig = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    # pick primary chain same as generic analyzer
    primary_chain = None
    for ch in req.chains:
        if any(b.type == "dataset.select" for b in ch.blocks):
            primary_chain = ch
            break
    if primary_chain is None and req.chains:
        primary_chain = req.chains[0]

    # dataset/sample extraction
    dataset_key = None
    sample_conf: Optional[Dict[str, Any]] = None
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

    # Build per-stage checklist
    checklist: List[ChecklistItem] = []
    types = [b.type for b in primary_chain.blocks] if primary_chain else []
    try:
        ds_idx = types.index("dataset.select")
    except ValueError:
        ds_idx = -1

    def _order_ok(order: List[str], idxs: Dict[str, int]) -> bool:
        last = -1
        for key in order:
            if key not in idxs:
                return False
            if idxs[key] <= last:
                return False
            last = idxs[key]
        return True

    for stage in STAGE_REQUIREMENTS:
        stage_key = stage["key"]
        label = stage["label"]
        state = "missing"
        required = stage["required"]
        order = stage.get("order", required)

        present_any = any(t in types for t in required)
        present_all = all(t in types for t in required)

        if stage["type"] == "loop_export":
            loop_idx = types.index("m2.loop_dataset") if "m2.loop_dataset" in types else -1
            export_idx = types.index("m2.export_dataset") if "m2.export_dataset" in types else -1

            if loop_idx == -1:
                state = "missing" if present_any or ds_idx == -1 else "missing"
            else:
                if ds_idx >= 0 and loop_idx <= ds_idx:
                    state = "wrong_place"
                elif stage.get("require_export") and export_idx != -1 and export_idx <= loop_idx:
                    state = "wrong_place"
                else:
                    # Only consider required blocks after the loop
                    idxs = {
                        t: types.index(t)
                        for t in required
                        if t in types and types.index(t) > loop_idx
                    }
                    has_all_after = len(idxs) == len(required)
                    if stage.get("require_export") and export_idx == -1:
                        state = "missing"
                    elif not has_all_after:
                        state = "missing"
                    elif not _order_ok(order, idxs):
                        state = "wrong_place"
                    else:
                        state = "ok"
        else:
            if present_any:
                # ensure it comes after dataset.select when applicable
                first_idxs = [types.index(t) for t in required if t in types]
                if ds_idx >= 0 and min(first_idxs) <= ds_idx:
                    state = "wrong_place"
                elif not present_all:
                    state = "missing"
                else:
                    idxs = {t: types.index(t) for t in required if t in types}
                    state = "ok" if _order_ok(order, idxs) else "wrong_place"
        checklist.append(ChecklistItem(key=stage_key, label=label, state=state))

    # Map planned actions (side-effect free descriptors)
    planned: List[PlannedAction] = []
    # ensure dataset info/sample planned first if present
    if primary_chain is not None:
        for b in primary_chain.blocks:
            if b.type == "dataset.info":
                planned.append(PlannedAction(action="dataset_info", tool="get_dataset_info", args={"dataset_key": dataset_key or ""}))
            if b.type == "dataset.sample_image":
                args = {"dataset_key": dataset_key or "", "mode": sample_conf.get("mode") if sample_conf else "random"}
                if sample_conf and sample_conf.get("mode") == "index":
                    args["index"] = sample_conf.get("index", 0)
                planned.append(PlannedAction(action="get_sample", tool="get_sample", args=args))

        for b in primary_chain.blocks:
            # skip dataset.* here (already handled)
            if b.type.startswith("dataset."):
                continue
            act = _map_m2_block_to_action(b, dataset_key, sample_conf)
            if act:
                planned.append(act)

    return AnalyzeResponse(signature=sig, chains=req.chains, checklist=checklist, planned_actions=planned)


def _analyze_module2_stage1_problem(req: AnalyzeRequest) -> Dict[str, Any]:
    primary_chain = None
    for ch in req.chains:
        if any(b.type == "dataset.select" for b in ch.blocks):
            primary_chain = ch
            break
    if primary_chain is None and req.chains:
        primary_chain = req.chains[0]

    chain_blocks = primary_chain.blocks if primary_chain else []
    chain_types = [b.type for b in chain_blocks]
    m2_types = [t for t in chain_types if t.startswith("m2.")]
    unexpected = [t for t in m2_types if t not in M2_STAGE1_REQUIRED_ORDER]
    missing = [t for t in M2_STAGE1_REQUIRED_ORDER if t not in m2_types]
    observed_required = [t for t in m2_types if t in M2_STAGE1_REQUIRED_ORDER]

    correct_prefix = M2_STAGE1_REQUIRED_ORDER[: len(observed_required)]
    order_wrong = observed_required != correct_prefix

    complete = (
        len(unexpected) == 0
        and len(missing) == 0
        and observed_required == M2_STAGE1_REQUIRED_ORDER
    )

    if complete:
        problem_type = "complete"
    elif unexpected:
        problem_type = "wrong_block"
    elif order_wrong:
        problem_type = "wrong_order"
    else:
        problem_type = "missing"

    next_missing = missing[0] if missing else None
    last_block = m2_types[-1] if m2_types else None
    wrong_block = unexpected[-1] if unexpected else None

    return {
        "problem_type": problem_type,
        "next_missing": next_missing,
        "last_block": last_block,
        "wrong_block": wrong_block,
        "m2_chain": m2_types,
        "full_chain": chain_types,
    }


@router.post("/analyze/module2/agent", response_model=AnalyzeAgentResponse)
def analyze_module2_with_agent(req: AnalyzeRequest, request: Request):
    analyzer = analyze_module2(req)
    now = time.time()
    key = _history_key(req, request) + ":module2-stage1"
    history = _M2_STAGE1_HISTORY.get(key) or _Module2Stage1History()

    stage1 = _analyze_module2_stage1_problem(req)
    problem_type = stage1["problem_type"]
    next_missing = stage1["next_missing"]
    wrong_block = stage1["wrong_block"]
    chain_text = " -> ".join(stage1["m2_chain"]) or "empty"
    full_chain_text = " -> ".join(stage1["full_chain"]) or "empty"
    expected_text = " -> ".join(M2_STAGE1_REQUIRED_ORDER)

    problem_key = f"{problem_type}|missing={next_missing}|wrong={wrong_block}|chain={chain_text}"

    if problem_type == "complete":
        history.repeat_count = 0
        history.last_problem_key = None
    elif history.last_problem_key == problem_key:
        history.repeat_count += 1
    else:
        history.repeat_count = 0

    history.last_problem_key = problem_key
    history.last_seen = now

    common_context = (
        f"\n\nCurrent preprocessing chain: {chain_text}. "
        f"Full chain: {full_chain_text}. "
        f"Expected Stage 1 order: {expected_text}. "
        f"Problem type: {problem_type}. "
        f"Next missing (if any): {next_missing}. "
        f"Wrong chosen block (if any): {wrong_block}. "
        f"Repeat count for same mistake: {history.repeat_count}."
    )

    if problem_type == "complete":
        prompt = (
            "You are Baymax-style tutor for VisionBlocks Module 2 Stage 1. "
            "The student has the correct three-block chain in the correct order. "
            "Respond in 1-2 short sentences: praise, confirm order correctness, and encourage pressing Next Test or Submit when appropriate. "
            "Friendly tone, no bullets."
        ) + common_context
    elif problem_type == "wrong_block":
        if history.repeat_count >= 2:
            prompt = (
                "You are Baymax-style tutor for VisionBlocks Module 2 Stage 1. "
                "Student repeatedly chose a wrong block. "
                "Now be explicit: name the exact correct block they need next and explain why that block fits Stage 1. "
                "Also explain briefly why the chosen wrong block does not fit this stage goal. "
                "Respond in 2-3 short sentences, no bullets, warm but clear."
            ) + common_context
        elif history.repeat_count == 1:
            prompt = (
                "You are Baymax-style tutor for VisionBlocks Module 2 Stage 1. "
                "Student repeated a wrong block choice once. "
                "Give an easier hint than before and explain why their chosen block is not suitable yet. "
                "Do NOT reveal the exact block name they need. "
                "Respond in 2-3 short sentences, no bullets."
            ) + common_context
        else:
            prompt = (
                "You are Baymax-style tutor for VisionBlocks Module 2 Stage 1. "
                "Student chose a wrong block. "
                "Explain what is wrong with that choice and give an indirect hint about the right kind of step. "
                "Do NOT reveal the exact missing block name. "
                "Respond in 2-3 short sentences, no bullets, supportive tone."
            ) + common_context
    elif problem_type == "wrong_order":
        if history.repeat_count >= 1:
            prompt = (
                "You are Baymax-style tutor for VisionBlocks Module 2 Stage 1. "
                "Student repeated order mistakes. "
                "Now state the correct full order directly and explain why this order is correct for preprocessing logic. "
                "Respond in 2-3 short sentences, no bullets."
            ) + common_context
        else:
            prompt = (
                "You are Baymax-style tutor for VisionBlocks Module 2 Stage 1. "
                "Blocks are mostly correct but order is wrong. "
                "Explain clearly that order is the issue and provide a guiding hint toward the correct order without listing the exact full chain verbatim. "
                "Respond in 2-3 short sentences, no bullets, gentle tone."
            ) + common_context
    else:
        if history.repeat_count >= 2:
            prompt = (
                "You are Baymax-style tutor for VisionBlocks Module 2 Stage 1. "
                "Student still cannot find the missing step after repeated tries. "
                "Now explicitly tell the exact block they should add next and explain why this is the correct block at this point. "
                "Respond in 2-3 short sentences, no bullets."
            ) + common_context
        elif history.repeat_count == 1:
            prompt = (
                "You are Baymax-style tutor for VisionBlocks Module 2 Stage 1. "
                "Student missed the same step again. "
                "Give an easier and more concrete hint than before, but still do not name the exact missing block. "
                "Respond in 2-3 short sentences, no bullets."
            ) + common_context
        else:
            prompt = (
                "You are Baymax-style tutor for VisionBlocks Module 2 Stage 1. "
                "A required step is missing. "
                "Give one indirect hint to help find the missing step without naming it directly. "
                "Respond in 2-3 short sentences, no bullets, friendly tone."
            ) + common_context

    agent_text = _call_openrouter(prompt)
    history.last_hint = agent_text
    _M2_STAGE1_HISTORY[key] = history

    return AnalyzeAgentResponse(analyzer=analyzer, agent_text=agent_text)
