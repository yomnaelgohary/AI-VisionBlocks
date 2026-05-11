from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

try:
    from langchain.memory import ConversationBufferMemory
except Exception:  # pragma: no cover - optional dependency
    ConversationBufferMemory = None  # type: ignore[assignment]

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
    # optional user id to align chat memory with analyzer hints
    user_id: Optional[str] = None
    # optional stage id for stage-aware tutoring (module 2)
    stage_id: Optional[str] = None


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


class ChatRequest(BaseModel):
    user_id: str
    message: str
    workspace_state: Optional[Dict[str, Any]] = None
    workspace_summary: Optional[Dict[str, Any]] = None


class ChatResponse(BaseModel):
    assistant_response: str
    last_hint: Optional[str] = None
    conversation_length: int = 0


@dataclass
class _ChatTurn:
    role: str
    content: str
    ts: float
    source: str = "chat"


@dataclass
class _ChatSession:
    turns: List[_ChatTurn] = field(default_factory=list)
    last_hint: Optional[str] = None
    memory: Any = None


class _StudentHistory(BaseModel):
    last_missing_key: Optional[str] = None
    last_wrong_place: bool = False
    repeat_count: int = 0
    last_hint: Optional[str] = None
    last_seen: float = 0.0


_HISTORY: Dict[str, _StudentHistory] = {}
_CHAT_HISTORY: Dict[str, _ChatSession] = {}


class _Module2StageHistory(BaseModel):
    last_problem_key: Optional[str] = None
    last_chain_key: Optional[str] = None
    last_wrong_block: Optional[str] = None
    wrong_block_repeat: int = 0
    repeat_count: int = 0
    last_hint: Optional[str] = None
    last_seen: float = 0.0


_M2_STAGE_HISTORY: Dict[str, _Module2StageHistory] = {}
_M4_STAGE_HISTORY: Dict[str, _Module2StageHistory] = {}


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


def _chat_history_key(user_id: str, request: Request) -> str:
    if user_id:
        return user_id
    client = request.client.host if request.client else "anon"
    return f"ip:{client}"


def _module_chat_key(prefix: str, user_id: str, request: Request) -> str:
    base = _chat_history_key(user_id, request)
    return f"{prefix}:{base}"


def _get_chat_session(key: str) -> _ChatSession:
    session = _CHAT_HISTORY.get(key)
    if session is None:
        session = _ChatSession()
        _CHAT_HISTORY[key] = session
    return session


def _ensure_langchain_memory(session: _ChatSession) -> Any:
    if ConversationBufferMemory is None:
        return None

    if session.memory is None:
        memory = ConversationBufferMemory(
            memory_key="history",
            input_key="message",
            output_key="assistant_response",
            return_messages=False,
        )
        for turn in session.turns:
            if turn.role == "user":
                memory.chat_memory.add_user_message(turn.content)
            elif turn.role == "assistant":
                memory.chat_memory.add_ai_message(turn.content)
        session.memory = memory

    return session.memory


def _append_chat_turn(
    key: str,
    role: str,
    content: str,
    source: str = "chat",
    dedupe: bool = False,
) -> _ChatSession:
    session = _get_chat_session(key)
    text = content.strip()
    if not text:
        return session

    if dedupe and session.turns:
        last = session.turns[-1]
        if last.role == role and last.content == text and last.source == source:
            return session

    turn = _ChatTurn(role=role, content=text, ts=time.time(), source=source)
    session.turns.append(turn)
    session.turns = session.turns[-200:]

    memory = _ensure_langchain_memory(session)
    if memory is not None:
        if role == "user":
            memory.chat_memory.add_user_message(text)
        elif role == "assistant":
            memory.chat_memory.add_ai_message(text)

    return session


def _workspace_state_summary(value: Any) -> str:
    if value is None:
        return "workspace: unavailable"

    try:
        if isinstance(value, dict):
            if isinstance(value.get("chains"), list):
                chains = []
                for chain in value.get("chains", [])[:8]:
                    if not isinstance(chain, dict):
                        continue
                    blocks = chain.get("blocks") or []
                    types = [
                        block.get("type")
                        for block in blocks
                        if isinstance(block, dict) and block.get("type")
                    ]
                    if types:
                        chains.append(" -> ".join(types))
                if chains:
                    return f"workspace chains: {'; '.join(chains)}"

            if isinstance(value.get("blocks"), list):
                blocks = []
                for block in value.get("blocks", [])[:20]:
                    if not isinstance(block, dict):
                        continue
                    block_type = block.get("type")
                    if block_type:
                        blocks.append(str(block_type))
                if blocks:
                    return f"workspace blocks: {' -> '.join(blocks)}"

        raw = json.dumps(value, ensure_ascii=True)
    except Exception:
        raw = str(value)

    if len(raw) > 4000:
        raw = raw[:4000] + "..."
    return f"workspace json: {raw}"


def _recent_chat_history_text(session: _ChatSession, limit: int = 12) -> str:
    lines: List[str] = []
    for turn in session.turns[-limit:]:
        prefix = "User" if turn.role == "user" else "Assistant"
        if turn.source == "hint" and turn.role == "assistant":
            prefix = "Hint"
        lines.append(f"{prefix}: {turn.content}")
    return "\n".join(lines) if lines else "Conversation is just starting."


def _latest_hint_for_key(key: str) -> Optional[str]:
    session = _CHAT_HISTORY.get(key)
    if session and session.last_hint:
        return session.last_hint
    history = _HISTORY.get(key)
    if history and history.last_hint:
        return history.last_hint
    return None


def _record_hint_in_chat_memory(key: str, hint_text: str) -> None:
    text = hint_text.strip()
    if not text:
        return

    session = _append_chat_turn(key, "assistant", text, source="hint", dedupe=True)
    session.last_hint = text


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
    chat_payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 300,
        "temperature": 0.2,
    }
    prompt_payload = {
        "model": model,
        "prompt": prompt,
        "max_tokens": 300,
        "temperature": 0.2,
    }
    max_attempts = 3
    backoff = 1.0
    last_error: Optional[Exception] = None

    for attempt in range(max_attempts):
        try:
            # Increased timeout to allow heavier reasoning for module-specific agents
            resp = requests.post(url, headers=headers, json=chat_payload, timeout=120)
        except requests.RequestException as exc:
            last_error = exc
        else:
            if resp.status_code in (429, 502, 503, 504):
                last_error = HTTPException(
                    status_code=resp.status_code,
                    detail="OpenRouter rate limited or temporarily unavailable",
                )
            else:
                try:
                    resp.raise_for_status()
                except requests.HTTPError as exc:
                    detail_text = ""
                    parsed: Dict[str, Any] = {}
                    try:
                        parsed = resp.json()
                        if isinstance(parsed, dict):
                            detail_text = parsed.get("error", {}).get("message") or parsed.get("message") or ""
                    except Exception:
                        detail_text = (resp.text or "")[:400]

                    # Some provider routes behind OpenRouter reject chat shape for certain models.
                    # Retry once with prompt-only payload when the error explicitly asks for prompt/messages.
                    requires_alt_shape = (
                        status_code == 400
                        and isinstance(detail_text, str)
                        and "prompt" in detail_text.lower()
                        and "messages" in detail_text.lower()
                    )
                    if requires_alt_shape:
                        try:
                            alt = requests.post(url, headers=headers, json=prompt_payload, timeout=120)
                            alt.raise_for_status()
                            alt_data = alt.json()
                            if isinstance(alt_data, dict) and alt_data.get("choices"):
                                msg = alt_data["choices"][0].get("message") or {}
                                if isinstance(msg, dict):
                                    return msg.get("content") or ""
                                text = alt_data["choices"][0].get("text")
                                return text or ""
                        except requests.RequestException:
                            pass

                    status_code = resp.status_code if resp.status_code >= 400 else 502
                    last_error = HTTPException(
                        status_code=status_code,
                        detail=(
                            f"OpenRouter request failed ({status_code}). "
                            f"model={model}, url={url}. {detail_text}".strip()
                        ),
                    )
                    if attempt < max_attempts - 1:
                        time.sleep(backoff)
                        backoff *= 2
                        continue
                    if isinstance(last_error, HTTPException):
                        raise last_error
                    raise exc
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
            "The checklist shows everything is complete. "
            "Respond with 1-2 short sentences: congratulate them, say the chain is complete, "
            "and tell them to Submit & Run, then go to Module 2."
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
        "Given the checklist and planned actions, respond with 1-2 short sentences. "
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
    prompt = "Style: 1-2 short sentences. Be direct, no greetings, no fluff.\n\n" + prompt
    prompt = "Style: 1-2 short sentences. Be direct, no greetings, no fluff.\n\n" + prompt
    prompt = "Style: 1-2 short sentences. Be direct, no greetings, no fluff.\n\n" + prompt
    agent_text = _call_openrouter(prompt)
    agent_text = _strip_healthcare_claims(agent_text)

    history.last_hint = agent_text
    _HISTORY[key] = history
    _record_hint_in_chat_memory(key, agent_text)

    return AnalyzeAgentResponse(analyzer=analyzer, agent_text=agent_text)


@router.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest, request: Request):
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    key = _chat_history_key(req.user_id, request)
    session = _append_chat_turn(key, "user", message, source="chat")

    latest_hint = _latest_hint_for_key(key)
    workspace_context = req.workspace_summary or req.workspace_state
    workspace_text = _workspace_state_summary(workspace_context)
    chat_history_text = _recent_chat_history_text(session)
    lower_message = message.lower()
    explanation_mode = any(
        phrase in lower_message
        for phrase in [
            "don't understand",
            "do not understand",
            "explain more",
            "why is this wrong",
            "why is that wrong",
            "why is it wrong",
            "what does this hint mean",
        ]
    )

    prompt_parts = [
        "You are the Module 1 chat assistant for VisionBlocks.",
        "Help the student understand dataset exploration and Blockly hints.",
        "Answer in 1-2 short sentences. Be direct and grounded in the current workspace.",
        "Do not invent blocks or steps that are not present in the workspace state.",
        "No greetings or extra encouragement; keep it concise.",
    ]
    if latest_hint:
        prompt_parts.append(f"Latest hint: {latest_hint}")
    if explanation_mode:
        prompt_parts.append(
            "The student is asking for clarification, so explicitly explain why the latest hint matters and what to inspect in the workspace."
        )
    prompt_parts.extend(
        [
            f"Workspace state: {workspace_text}",
            f"Conversation history:\n{chat_history_text}",
            f"Student message: {message}",
        ]
    )

    prompt = "\n\n".join(prompt_parts)

    try:
        assistant_response = _call_openrouter(prompt).strip()
    except Exception:
        if latest_hint:
            assistant_response = (
                f"The latest hint is: {latest_hint}. "
                f"Using the current workspace, I would inspect {workspace_text}."
            )
        else:
            assistant_response = (
                "Tell me what part feels unclear and I’ll explain it using the current workspace state."
            )

    if not assistant_response:
        assistant_response = (
            "I can help explain the current hint if you point me at the block or question that feels confusing."
        )

    _append_chat_turn(key, "assistant", assistant_response, source="chat")

    return ChatResponse(
        assistant_response=assistant_response,
        last_hint=latest_hint,
        conversation_length=len(session.turns),
    )


@router.post("/module4/chat", response_model=ChatResponse)
def module4_chat(req: ChatRequest, request: Request):
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    # Use module-scoped chat key so memory is isolated to Module 4
    base_key = _chat_history_key(req.user_id, request)
    key = _module_chat_key("m4", req.user_id or base_key, request)

    session = _append_chat_turn(key, "user", message, source="chat")

    latest_hint = _latest_hint_for_key(key)
    workspace_context = req.workspace_summary or req.workspace_state
    workspace_text = _workspace_state_summary(workspace_context)
    chat_history_text = _recent_chat_history_text(session)
    lower_message = message.lower()
    explanation_mode = any(
        phrase in lower_message
        for phrase in [
            "don't understand",
            "do not understand",
            "explain more",
            "why is this wrong",
            "what does this hint mean",
        ]
    )

    prompt_parts = [
        "You are the Module 4 chat assistant for VisionBlocks.",
        "Help the student understand model-building, training, and evaluation blocks in Blockly.",
        "Answer in 1-2 short sentences. Be direct and grounded in the current workspace.",
        "Do not invent blocks or steps that are not present in the workspace state.",
        "Do not say you are a healthcare or health care companion.",
        "No greetings or extra encouragement; keep it concise.",
    ]
    if latest_hint:
        prompt_parts.append(f"Latest hint: {latest_hint}")
    if explanation_mode:
        prompt_parts.append(
            "The student requests clarification—explain why the latest hint matters and what to inspect in the workspace."
        )
    prompt_parts.extend(
        [
            f"Workspace state: {workspace_text}",
            f"Conversation history:\n{chat_history_text}",
            f"Student message: {message}",
        ]
    )

    prompt = "\n\n".join(prompt_parts)

    try:
        assistant_response = _call_openrouter(prompt).strip()
    except Exception:
        if latest_hint:
            assistant_response = (
                f"The latest hint is: {latest_hint}. Using the current workspace, I would inspect {workspace_text}."
            )
        else:
            assistant_response = (
                "Tell me what part feels unclear and I’ll explain it using the current workspace state."
            )

    if not assistant_response:
        assistant_response = (
            "I can help explain the current hint if you point me at the block or question that feels confusing."
        )

    assistant_response = _strip_healthcare_claims(assistant_response)

    assistant_response = _strip_healthcare_claims(assistant_response)

    _append_chat_turn(key, "assistant", assistant_response, source="chat")

    return ChatResponse(
        assistant_response=assistant_response,
        last_hint=latest_hint,
        conversation_length=len(session.turns),
    )


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
        "label": "Stage 2: Resize, Pad & Normalize",
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
        "key": "stage3",
        "label": "Stage 3: Loop & Export",
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

M2_STAGE2_REQUIRED_ORDER = [
    "m2.to_grayscale",
    "m2.brightness_contrast",
    "m2.blur_sharpen",
    "m2.resize",
    "m2.pad",
    "m2.normalize",
]

M2_STAGE3_REQUIRED_ORDER = [
    "m2.to_grayscale",
    "m2.brightness_contrast",
    "m2.blur_sharpen",
    "m2.resize",
    "m2.pad",
    "m2.normalize",
]

M2_STAGE2_REQUIRED_FIELDS: Dict[str, Dict[str, Any]] = {
    "m2.brightness_contrast": {"B": 10, "C": 10},
    "m2.blur_sharpen": {"BLUR": 0, "SHARP": 1},
    "m2.resize": {"MODE": "size", "W": 150, "H": 150},
    "m2.pad": {"W": 150, "H": 150},
    "m2.normalize": {"MODE": "zero_one"},
}

_M2_FRIENDLY_BLOCK_NAMES: Dict[str, str] = {
    "m2.to_grayscale": "grayscale",
    "m2.brightness_contrast": "brightness and contrast",
    "m2.blur_sharpen": "blur and sharpen",
    "m2.resize": "resize",
    "m2.pad": "pad",
    "m2.normalize": "normalize",
    "m2.loop_dataset": "loop",
    "m2.export_dataset": "export",
    "m2.edges": "edge detection",
    "m2.crop_center": "center crop",
    "m2.sample_image": "sample image",
}

_M2_FRIENDLY_FIELD_NAMES: Dict[str, str] = {
    "B": "brightness",
    "C": "contrast",
    "BLUR": "blur",
    "SHARP": "sharpen",
    "MODE": "mode",
    "W": "width",
    "H": "height",
    "MAXSIDE": "max side",
    "PCT": "percent",
    "R": "red",
    "G": "green",
    "KEEP": "keep aspect ratio",
    "THRESH": "threshold",
    "OVERLAY": "overlay",
    "N": "count",
    "SUBSET": "subset",
    "NAME": "name",
    "OVERWRITE": "overwrite",
    "K": "step",
}


def _friendly_m2_block_name(block_type: str) -> str:
    return _M2_FRIENDLY_BLOCK_NAMES.get(block_type, block_type.replace("m2.", "").replace("_", " "))


def _friendly_m2_field_name(field_name: str) -> str:
    return _M2_FRIENDLY_FIELD_NAMES.get(field_name, field_name.lower())


def _friendly_m2_validation_errors(validation_errors: List[str]) -> List[str]:
    friendly_errors: List[str] = []
    for error in validation_errors:
        if " should be " not in error:
            friendly_errors.append(error)
            continue

        left, expected = error.split(" should be ", 1)
        block_type = left
        field_name = ""
        if "." in left:
            block_type, field_name = left.rsplit(".", 1)

        block_name = _friendly_m2_block_name(block_type)
        friendly_field = _friendly_m2_field_name(field_name)

        if block_type == "m2.brightness_contrast" and field_name in {"B", "C"}:
            friendly_errors.append(f"{friendly_field} should be {expected}")
        elif block_type == "m2.blur_sharpen" and field_name in {"BLUR", "SHARP"}:
            friendly_errors.append(f"{friendly_field} should be {expected}")
        elif block_type == "m2.resize" and field_name in {"W", "H"}:
            friendly_errors.append(f"{friendly_field} should be {expected}")
        elif block_type == "m2.pad" and field_name in {"W", "H"}:
            friendly_errors.append(f"{friendly_field} should be {expected}")
        else:
            friendly_errors.append(f"{block_name} {friendly_field} should be {expected}".strip())
    return friendly_errors


def _sanitize_m2_agent_text(text: str) -> str:
    sanitized = text

    replacements = [
        ("m2.brightness_contrast", "brightness and contrast"),
        ("m2.blur_sharpen", "blur and sharpen"),
        ("m2.to_grayscale", "grayscale"),
        ("m2.resize", "resize"),
        ("m2.pad", "pad"),
        ("m2.normalize", "normalize"),
        ("m2.loop_dataset", "loop"),
        ("m2.export_dataset", "export"),
        ("m2.edges", "edge detection"),
        ("m2.crop_center", "center crop"),
        ("m2.sample_image", "sample image"),
    ]

    for raw, friendly in replacements:
        sanitized = sanitized.replace(raw, friendly)

    sanitized = sanitized.replace(".B", " brightness").replace(".C", " contrast")
    sanitized = sanitized.replace(".BLUR", " blur").replace(".SHARP", " sharpen")
    sanitized = sanitized.replace(".W", " width").replace(".H", " height")
    sanitized = sanitized.replace(".MAXSIDE", " max side")
    sanitized = sanitized.replace(".PCT", " percent")
    sanitized = sanitized.replace(".MODE", " mode")
    sanitized = sanitized.replace(".THRESH", " threshold")
    sanitized = sanitized.replace(".OVERLAY", " overlay")
    sanitized = sanitized.replace(".SUBSET", " subset")
    sanitized = sanitized.replace(".NAME", " name")

    return sanitized


def _find_primary_chain(req: AnalyzeRequest) -> Optional[ChainModel]:
    for ch in req.chains:
        if any(b.type == "dataset.select" for b in ch.blocks):
            return ch
    if req.chains:
        return req.chains[0]
    return None


def _coerce_num(value: Any) -> Optional[float]:
    try:
        return float(value)
    except Exception:
        return None


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


def _analyze_module2_stage_problem(req: AnalyzeRequest, stage_id: str) -> Dict[str, Any]:
    primary_chain = _find_primary_chain(req)

    chain_blocks = primary_chain.blocks if primary_chain else []
    chain_types = [b.type for b in chain_blocks]
    m2_types = [t for t in chain_types if t.startswith("m2.")]

    required_order = M2_STAGE1_REQUIRED_ORDER
    stage_label = "Stage 1"

    if stage_id == "2":
        required_order = M2_STAGE2_REQUIRED_ORDER
        stage_label = "Stage 2"
    elif stage_id == "3":
        required_order = M2_STAGE3_REQUIRED_ORDER
        stage_label = "Stage 3"
    elif stage_id == "4":
        required_order = M2_STAGE2_REQUIRED_ORDER
        stage_label = "Stage 4"

    validation_errors: List[str] = []
    invalid_param_block: Optional[str] = None

    if stage_id == "3":
        loop_body_chain = next(
            (ch for ch in req.chains if ch.top_block_type == "m2.loop_dataset.body"),
            None,
        )
        loop_body_blocks = loop_body_chain.blocks if loop_body_chain else []
        loop_types = [b.type for b in loop_body_blocks if b.type.startswith("m2.")]

        loop_idx = chain_types.index("m2.loop_dataset") if "m2.loop_dataset" in chain_types else -1
        export_idx = chain_types.index("m2.export_dataset") if "m2.export_dataset" in chain_types else -1

        unexpected = [t for t in loop_types if t not in required_order]
        missing = [t for t in required_order if t not in loop_types]
        observed_required = [t for t in loop_types if t in required_order]
        correct_prefix = required_order[: len(observed_required)]
        order_wrong = observed_required != correct_prefix

        blocks_by_type: Dict[str, BlockModel] = {}
        for b in loop_body_blocks:
            if b.type.startswith("m2.") and b.type not in blocks_by_type:
                blocks_by_type[b.type] = b

        for block_type, expected_fields in M2_STAGE2_REQUIRED_FIELDS.items():
            blk = blocks_by_type.get(block_type)
            if not blk:
                continue

            for field_name, expected_value in expected_fields.items():
                actual_value = blk.fields.get(field_name)
                if isinstance(expected_value, (int, float)):
                    actual_num = _coerce_num(actual_value)
                    if actual_num is None or actual_num != float(expected_value):
                        validation_errors.append(
                            f"{block_type}.{field_name} should be {expected_value}"
                        )
                        invalid_param_block = invalid_param_block or block_type
                else:
                    if block_type == "m2.normalize" and field_name == "MODE":
                        normalized = str(actual_value or "")
                        allowed = {"zero_one", "ZERO_ONE", "0-1", "0_1"}
                        if normalized not in allowed:
                            validation_errors.append(
                                f"{block_type}.{field_name} should be zero_one"
                            )
                            invalid_param_block = invalid_param_block or block_type
                    elif str(actual_value) != str(expected_value):
                        validation_errors.append(
                            f"{block_type}.{field_name} should be {expected_value}"
                        )
                        invalid_param_block = invalid_param_block or block_type

        if loop_idx == -1:
            problem_type = "missing"
            next_missing = "m2.loop_dataset"
        elif export_idx == -1:
            problem_type = "missing"
            next_missing = "m2.export_dataset"
        elif export_idx <= loop_idx:
            problem_type = "wrong_order"
            next_missing = "m2.export_dataset"
        else:
            complete = (
                len(unexpected) == 0
                and len(missing) == 0
                and observed_required == required_order
                and len(validation_errors) == 0
            )

            if complete:
                problem_type = "complete"
            elif unexpected:
                problem_type = "wrong_block"
            elif order_wrong:
                problem_type = "wrong_order"
            elif validation_errors:
                problem_type = "invalid_params"
            else:
                problem_type = "missing"
            next_missing = missing[0] if missing else None

        last_block = loop_types[-1] if loop_types else None
        wrong_block = unexpected[-1] if unexpected else None

        return {
            "stage_id": stage_id,
            "stage_label": stage_label,
            "problem_type": problem_type,
            "next_missing": next_missing,
            "last_block": last_block,
            "wrong_block": wrong_block,
            "invalid_param_block": invalid_param_block,
            "validation_errors": validation_errors,
            "m2_chain": loop_types,
            "full_chain": chain_types,
            "expected_order": required_order,
        }

    unexpected = [t for t in m2_types if t not in required_order]
    missing = [t for t in required_order if t not in m2_types]
    observed_required = [t for t in m2_types if t in required_order]
    correct_prefix = required_order[: len(observed_required)]
    order_wrong = observed_required != correct_prefix

    if stage_id == "2":
        blocks_by_type: Dict[str, BlockModel] = {}
        for b in chain_blocks:
            if b.type.startswith("m2.") and b.type not in blocks_by_type:
                blocks_by_type[b.type] = b

        for block_type, expected_fields in M2_STAGE2_REQUIRED_FIELDS.items():
            blk = blocks_by_type.get(block_type)
            if not blk:
                continue

            for field_name, expected_value in expected_fields.items():
                actual_value = blk.fields.get(field_name)
                if isinstance(expected_value, (int, float)):
                    actual_num = _coerce_num(actual_value)
                    if actual_num is None or actual_num != float(expected_value):
                        validation_errors.append(
                            f"{block_type}.{field_name} should be {expected_value}"
                        )
                        invalid_param_block = invalid_param_block or block_type
                else:
                    if block_type == "m2.normalize" and field_name == "MODE":
                        normalized = str(actual_value or "")
                        allowed = {"zero_one", "ZERO_ONE", "0-1", "0_1"}
                        if normalized not in allowed:
                            validation_errors.append(
                                f"{block_type}.{field_name} should be zero_one"
                            )
                            invalid_param_block = invalid_param_block or block_type
                    elif str(actual_value) != str(expected_value):
                        validation_errors.append(
                            f"{block_type}.{field_name} should be {expected_value}"
                        )
                        invalid_param_block = invalid_param_block or block_type

    complete = (
        len(unexpected) == 0
        and len(missing) == 0
        and observed_required == required_order
        and len(validation_errors) == 0
    )

    if complete:
        problem_type = "complete"
    elif unexpected:
        problem_type = "wrong_block"
    elif order_wrong:
        problem_type = "wrong_order"
    elif validation_errors:
        problem_type = "invalid_params"
    else:
        problem_type = "missing"

    next_missing = missing[0] if missing else None
    last_block = m2_types[-1] if m2_types else None
    wrong_block = unexpected[-1] if unexpected else None

    return {
        "stage_id": stage_id,
        "stage_label": stage_label,
        "problem_type": problem_type,
        "next_missing": next_missing,
        "last_block": last_block,
        "wrong_block": wrong_block,
        "invalid_param_block": invalid_param_block,
        "validation_errors": validation_errors,
        "m2_chain": m2_types,
        "full_chain": chain_types,
        "expected_order": required_order,
    }


M4_STAGE1_REQUIRED_ORDER = [
    "dataset.select",
    "m3.set_split_ratio",
    "m3.apply_split",
    "m4.model_init",
    "m4.layer_conv2d",
    "m4.layer_pool",
    "m4.layer_dense",
    "m4.model_summary",
]

M4_STAGE2_REQUIRED_ORDER = [
    "dataset.select",
    "m3.set_split_ratio",
    "m3.apply_split",
    "m4.model_init",
    "m4.layer_conv2d",
    "m4.layer_pool",
    "m4.layer_dense",
    "m4.model_summary",
    "m4.train_hparams",
    "m4.train_start",
    "m4.eval_test",
    "dataset.sample_image",
    "m4.predict_sample",
]


def _friendly_m4_label(block_type: Optional[str]) -> str:
    if not block_type:
        return ""
    labels = {
        "dataset.select": "use dataset",
        "m3.set_split_ratio": "set split ratio",
        "m3.apply_split": "apply split",
        "m4.model_init": "start new model",
        "m4.layer_conv2d": "add conv layer",
        "m4.layer_pool": "add pooling layer",
        "m4.layer_dense": "add dense layer",
        "m4.model_summary": "show model summary",
        "m4.train_hparams": "training setup",
        "m4.train_start": "start training",
        "m4.eval_test": "evaluate on test set",
        "dataset.sample_image": "get sample image",
        "m4.predict_sample": "predict current sample",
    }
    return labels.get(block_type, block_type.replace("m3.", "").replace("m4.", "").replace("dataset.", ""))


def _sanitize_m4_agent_text(text: str) -> str:
    if not text:
        return text
    for t in M4_STAGE2_REQUIRED_ORDER:
        text = text.replace(t, _friendly_m4_label(t))
    return text


def _strip_healthcare_claims(text: str) -> str:
    if not text:
        return text
    lowered = text.lower()
    banned = [
        "health care companion",
        "healthcare companion",
        "health-care companion",
        "i am your healthcare companion",
        "i am your health care companion",
    ]
    if not any(b in lowered for b in banned):
        return text

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    cleaned_lines = [
        ln
        for ln in lines
        if not any(b in ln.lower() for b in banned)
    ]
    return "\n".join(cleaned_lines) or "I'm here to help with your module task."


def _analyze_module4_stage_problem(req: AnalyzeRequest, stage_id: str) -> Dict[str, Any]:
    primary_chain = _find_primary_chain(req)
    chain_blocks = primary_chain.blocks if primary_chain else []
    chain_types = [b.type for b in chain_blocks]

    expected = M4_STAGE1_REQUIRED_ORDER if stage_id == "1" else M4_STAGE2_REQUIRED_ORDER
    found = [t for t in chain_types if t in expected]
    missing = [t for t in expected if t not in found]
    unexpected = [t for t in chain_types if t.startswith("m3.") or t.startswith("m4.") or t.startswith("dataset.")]
    unexpected = [t for t in unexpected if t not in expected]

    order_wrong = False
    idxs: Dict[str, int] = {}
    for t in expected:
        if t in chain_types:
            idxs[t] = chain_types.index(t)
    last = -1
    for t in expected:
        if t in idxs:
            if idxs[t] <= last:
                order_wrong = True
                break
            last = idxs[t]

    if len(unexpected) == 0 and len(missing) == 0 and not order_wrong:
        problem_type = "complete"
    elif unexpected:
        problem_type = "wrong_block"
    elif order_wrong:
        problem_type = "wrong_order"
    else:
        problem_type = "missing"

    return {
        "stage_id": stage_id,
        "problem_type": problem_type,
        "next_missing": missing[0] if missing else None,
        "wrong_block": unexpected[-1] if unexpected else None,
        "full_chain": chain_types,
        "expected_order": expected,
    }


def _analyze_module4_stage1_problem(req: AnalyzeRequest) -> Dict[str, Any]:
    return _analyze_module4_stage_problem(req, "1")


@router.post("/analyze/module4", response_model=AnalyzeResponse)
def analyze_module4(req: AnalyzeRequest):
    canonical = json.dumps(json.loads(req.json()), sort_keys=True, separators=(",", ":"))
    sig = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    stage_id = str(req.stage_id or "1")
    checklist: List[ChecklistItem] = []

    if stage_id in {"1", "2", "3"}:
        expected_order = M4_STAGE1_REQUIRED_ORDER if stage_id == "1" else M4_STAGE2_REQUIRED_ORDER
        primary_chain = _find_primary_chain(req)
        chain_types = [b.type for b in primary_chain.blocks] if primary_chain else []

        last = -1
        for t in expected_order:
            label = t.replace("m3.", "").replace("m4.", "").replace("dataset.", "")
            if t not in chain_types:
                state = "missing"
            else:
                idx = chain_types.index(t)
                state = "ok" if idx > last else "wrong_place"
                if state == "ok":
                    last = idx
            checklist.append(ChecklistItem(key=t, label=label, state=state))

    return AnalyzeResponse(signature=sig, chains=req.chains, checklist=checklist, planned_actions=[])


@router.post("/analyze/module4/agent", response_model=AnalyzeAgentResponse)
def analyze_module4_with_agent(req: AnalyzeRequest, request: Request):
    analyzer = analyze_module4(req)
    stage_id = str(req.stage_id or "1")
    if stage_id not in {"1", "2", "3"}:
        return AnalyzeAgentResponse(
            analyzer=analyzer,
            agent_text="Stage analyzer is currently enabled for Module 4 Stage 1, Stage 2, and Stage 3 quiz.",
        )

    now = time.time()
    key = _history_key(req, request) + f":module4-stage{stage_id}"
    history = _M4_STAGE_HISTORY.get(key) or _Module2StageHistory()
    problem = _analyze_module4_stage_problem(req, stage_id)

    chain_key = " -> ".join(problem["full_chain"]) or "empty"
    student_moved = history.last_chain_key is not None and history.last_chain_key != chain_key

    problem_key = (
        f"{problem['problem_type']}|missing={problem['next_missing']}|"
        f"wrong={problem['wrong_block']}|chain={' -> '.join(problem['full_chain'])}"
    )

    if problem["problem_type"] == "complete":
        history.repeat_count = 0
        history.last_problem_key = None
    elif history.last_problem_key == problem_key:
        history.repeat_count += 1
    else:
        history.repeat_count = 0

    history.last_problem_key = problem_key
    history.last_chain_key = chain_key
    if problem["problem_type"] == "wrong_block" and problem["wrong_block"]:
        if history.last_wrong_block == problem["wrong_block"]:
            history.wrong_block_repeat += 1
        else:
            history.wrong_block_repeat = 0
        history.last_wrong_block = problem["wrong_block"]
    else:
        history.last_wrong_block = None
        history.wrong_block_repeat = 0
    history.last_seen = now

    chain_text = " -> ".join(problem["full_chain"]) or "empty"
    expected_text = " -> ".join(problem["expected_order"])
    stage_label = "Module 4 Stage 1" if stage_id == "1" else "Module 4 Stage 3 Quiz"
    is_pipeline_empty = len(problem["full_chain"]) == 0
    common_context = (
        f"\n\nCurrent chain: {chain_text}. "
        f"Expected stage order: {expected_text}. "
        f"Problem type: {problem['problem_type']}. "
        f"Next missing: {problem['next_missing']}. "
        f"Wrong block: {problem['wrong_block']}. "
        f"Repeat count: {history.repeat_count}. "
        f"Student moved since last hint: {student_moved}. "
        f"Wrong-block repeat: {history.wrong_block_repeat}."
    )

    # Special case: EMPTY PIPELINE on FIRST ATTEMPT - introduce the workflow, don't assume prior choices
    if is_pipeline_empty and history.repeat_count == 0:
        if stage_id == "1":
            prompt = (
                f"You are an educational AI tutor for VisionBlocks {stage_label}. "
                "The student is starting fresh with an empty workspace. Introduce the workflow concept:\n"
                "1) Explain that they're about to build a machine learning pipeline.\n"
                "2) Ask: what is the FIRST thing that must happen in any ML project before you can build or test a model?\n"
                "3) Guide them toward the conceptual step without naming the block directly (e.g., 'what do you need to prepare from your dataset?').\n"
                "Keep it conversational and exploratory, 2-3 sentences. Goal: spark their thinking about the workflow."
            ) + common_context
        else:  # stage_id == "3" (quiz)
            prompt = (
                f"You are an educational AI tutor for VisionBlocks {stage_label}. "
                "The student is starting a quiz to arrange a complete ML pipeline from scratch. Introduce the task:\n"
                "1) Explain that they'll arrange blocks in the correct order for a full ML workflow.\n"
                "2) Ask: which step comes FIRST in a machine learning project—before model building, training, or evaluation?\n"
                "3) Encourage them to think about the logical sequence and start by dragging the first block.\n"
                "Keep it engaging and thought-provoking, 2-3 sentences. Goal: guide discovery, not instruction."
            ) + common_context
    elif problem["problem_type"] == "complete":
        prompt = (
            f"You are an educational AI tutor for VisionBlocks {stage_label}. "
            "The student successfully arranged the entire pipeline. Congratulate them warmly, "
            "explain in 1 sentence why this complete sequence makes sense for the ML workflow, "
            "and encourage them to submit. Keep it celebratory and brief (2-3 sentences max)."
        ) + common_context
    elif problem["problem_type"] == "wrong_order":
        # First attempt: teach *why* ordering matters, not just fix it
        if history.repeat_count == 0:
            prompt = (
                f"You are an educational AI tutor for VisionBlocks {stage_label}. "
                "The student has blocks in the wrong sequence. DON'T just tell them the correct order. Instead:\n"
                "1) Point out ONE adjacent pair that's wrong (e.g., 'I notice X is placed before Y').\n"
                "2) Explain WHY that order is problematic for the ML pipeline (what does X produce that Y needs?).\n"
                "3) Guide them to think about the logical data flow, not just follow a recipe.\n"
                "Keep it conversational and focused on understanding, not memorization (2-3 sentences)."
            ) + common_context
        # Repeated mistake: be clearer but still educational
        elif history.repeat_count == 1:
            prompt = (
                f"You are an educational AI tutor for VisionBlocks {stage_label}. "
                "The student still has blocks out of order (they struggled with this before). "
                "Now be more direct but still educational:\n"
                "1) Name the specific issue (e.g., a block needs to come after another block).\n"
                "2) Briefly explain the reason (e.g., 'because you need prepared data before building the model').\n"
                "3) Suggest one specific move to try.\n"
                "Use 2-3 short sentences, supportive tone."
            ) + common_context
        # Multiple repeats: be direct but still explain
        else:
            prompt = (
                f"You are an educational AI tutor for VisionBlocks {stage_label}. "
                "The student has repeatedly struggled with block ordering. Help them succeed:\n"
                "1) Clearly state the exact fix needed.\n"
                "2) Remind them of the reason in 1 simple phrase (e.g., 'to ensure data flows correctly').\n"
                "3) Encourage them that this understanding will help with future models.\n"
                "Use 2 sentences, direct but encouraging."
            ) + common_context
    elif problem["problem_type"] == "wrong_block":
        # First time: explain the block's role
        if history.wrong_block_repeat == 0:
            prompt = (
                f"You are an educational AI tutor for VisionBlocks {stage_label}. "
                f"The student placed a block that doesn't belong in this stage ({problem.get('wrong_block', 'a block')}). "
                "Guide them to understand why:\n"
                "1) Identify the block they chose and what it does.\n"
                "2) Explain why it doesn't fit this stage (e.g., 'this is for training, but you haven't built your model yet').\n"
                "3) Ask them to think: what is this stage's purpose? What should come here instead?\n"
                "Use 2-3 sentences to prompt reflection, not give the answer."
            ) + common_context
        # Repeated mistake: be clearer
        elif history.wrong_block_repeat == 1:
            prompt = (
                f"You are an educational AI tutor for VisionBlocks {stage_label}. "
                f"The student chose a wrong block again. They're struggling, so help more directly:\n"
                "1) Confirm: this block is not meant for this stage—it belongs in a later stage.\n"
                f"2) Remind them: this stage is about preparing data or building the model. "
                "3) Suggest: look for a block that directly supports that goal.\n"
                "Use 2 short sentences, stay supportive."
            ) + common_context
        # Multiple repeats: simplify further
        else:
            prompt = (
                f"You are an educational AI tutor for VisionBlocks {stage_label}. "
                f"The student keeps choosing the wrong block ({problem.get('wrong_block', 'a block')}). "
                "Simplify and support:\n"
                "1) This block does not belong here—it's for a different part of the ML workflow.\n"
                "2) This stage needs a block that prepares data or builds the model. "
                "3) Try a different block from the toolbox.\n"
                "Use very simple language, 2 sentences."
            ) + common_context
    else:  # missing block
        # First attempt: teach data flow concept
        if history.repeat_count == 0:
            prompt = (
                f"You are an educational AI tutor for VisionBlocks {stage_label}. "
                f"The student's pipeline is incomplete—a required step is missing. "
                "Teach them to think through the data flow:\n"
                "1) Point out what they have done so far and what the pipeline is missing.\n"
                "2) Ask: what must happen next in a real ML workflow before you can move forward?\n"
                "3) Hint at the concept (e.g., 'you've loaded data, now what do you need to do before building a model?').\n"
                "Encourage them to find the answer themselves—don't name the block directly. Use 2-3 sentences."
            ) + common_context
        # Repeated mistake: be more direct
        elif history.repeat_count == 1:
            prompt = (
                f"You are an educational AI tutor for VisionBlocks {stage_label}. "
                "The student is still missing the same block. "
                "Be more direct now:\n"
                "1) Name the missing step and what it does.\n"
                "2) Explain why it matters in the workflow.\n"
                "3) Encourage them: try dragging a block that matches this description.\n"
                "Use 2 short sentences."
            ) + common_context
        # Multiple repeats: very direct
        else:
            prompt = (
                f"You are an educational AI tutor for VisionBlocks {stage_label}. "
                "The student still hasn't added the missing piece. Let's simplify:\n"
                "1) You are missing a key step in the pipeline.\n"
                "2) This step helps [briefly explain its role].\n"
                "3) Find it in the toolbox and add it after the current last block.\n"
                "Keep it very simple and action-oriented, 2 sentences."
            ) + common_context

            # end of prompt-building branches

    # Ensure `agent_text` is always assigned. If a prompt was built, call the LLM;
    # otherwise provide a deterministic fallback message.
    if 'prompt' in locals() and prompt:
        try:
            prompt = "Style: 1-2 short sentences. Be direct, no greetings, no fluff.\n\n" + prompt
            raw = _call_openrouter(prompt)
            agent_text = _sanitize_m4_agent_text(raw)
            agent_text = _strip_healthcare_claims(agent_text)
        except Exception as exc:  # keep endpoint stable when LLM fails
            agent_text = f"LLM error: {str(exc)}"
    else:
        agent_text = "No hint available for this situation."

    history.last_hint = agent_text
    _M4_STAGE_HISTORY[key] = history

    return AnalyzeAgentResponse(analyzer=analyzer, agent_text=agent_text)


@router.post("/analyze/module2/agent", response_model=AnalyzeAgentResponse)
def analyze_module2_with_agent(req: AnalyzeRequest, request: Request):
    analyzer = analyze_module2(req)
    now = time.time()
    stage_id = str(req.stage_id or "1")
    if stage_id not in {"1", "2", "3", "4"}:
        stage_id = "1"

    key = _history_key(req, request) + f":module2-stage{stage_id}"
    chat_key = _chat_history_key(req.user_id or "", request) + f":module2-stage{stage_id}"
    history = _M2_STAGE_HISTORY.get(key) or _Module2StageHistory()

    stage_problem = _analyze_module2_stage_problem(req, stage_id)
    stage_label = stage_problem["stage_label"]
    problem_type = stage_problem["problem_type"]
    next_missing = stage_problem["next_missing"]
    wrong_block = stage_problem["wrong_block"]
    invalid_param_block = stage_problem["invalid_param_block"]
    validation_errors = stage_problem["validation_errors"]
    chain_text = " -> ".join(stage_problem["m2_chain"]) or "empty"
    full_chain_text = " -> ".join(stage_problem["full_chain"]) or "empty"
    expected_text = " -> ".join(stage_problem["expected_order"])

    problem_key = (
        f"{problem_type}|missing={next_missing}|wrong={wrong_block}|"
        f"invalid={invalid_param_block}|chain={chain_text}|"
        f"validation={json.dumps(validation_errors, ensure_ascii=True)}"
    )

    if problem_type == "complete":
        history.repeat_count = 0
        history.last_problem_key = None
    elif history.last_problem_key == problem_key:
        history.repeat_count += 1
    else:
        history.repeat_count = 0

    history.last_problem_key = problem_key
    history.last_seen = now

    if stage_id == "3":
        # Keep Stage 3 hints conceptual and avoid leaking full ordered answers.
        common_context = (
            f"\n\nCurrent preprocessing chain: {chain_text}. "
            f"Full chain: {full_chain_text}. "
            f"Problem type: {problem_type}. "
            f"Next missing (if any): {next_missing}. "
            f"Wrong chosen block (if any): {wrong_block}. "
            f"Repeat count for same mistake: {history.repeat_count}."
        )
    else:
        common_context = (
            f"\n\nCurrent preprocessing chain: {chain_text}. "
            f"Full chain: {full_chain_text}. "
            f"Expected {stage_label} order: {expected_text}. "
            f"Problem type: {problem_type}. "
            f"Next missing (if any): {next_missing}. "
            f"Wrong chosen block (if any): {wrong_block}. "
            f"Invalid parameter block (if any): {invalid_param_block}. "
            f"Validation details: {json.dumps(validation_errors, ensure_ascii=True)}. "
            f"Repeat count for same mistake: {history.repeat_count}."
        )

    if stage_id == "4":
        friendly_block = _friendly_m2_block_name(invalid_param_block or wrong_block or next_missing or "m2.normalize")
        friendly_missing = _friendly_m2_block_name(next_missing or "m2.normalize")
        friendly_wrong = _friendly_m2_block_name(wrong_block or invalid_param_block or "")

        if problem_type == "complete":
            prompt = (
                "You are Baymax-style tutor for VisionBlocks Module 2 Stage 4 (Quiz: Missing Normalize). "
                "The student solved the quiz by placing the missing normalize block in the right spot. "
                "Respond in 1-2 short sentences: praise the success, confirm the chain is now complete, and encourage submitting. "
                "Do not mention internal block ids."
            ) + common_context
        elif problem_type == "wrong_block":
            prompt = (
                "You are Baymax-style tutor for VisionBlocks Module 2 Stage 4 (Quiz: Missing Normalize). "
                "The student chose a block that does not belong in the missing slot. "
                f"Explain briefly why '{friendly_wrong}' does not fit here, using the current chain context. "
                f"Give an indirect hint that the missing step is the '{friendly_missing}' block after pad. "
                "Do not reveal the exact code identifier. Respond in 2-3 short sentences, no bullets, warm and clear."
            ) + common_context
        elif problem_type == "wrong_order":
            prompt = (
                "You are Baymax-style tutor for VisionBlocks Module 2 Stage 4 (Quiz: Missing Normalize). "
                "The student has the right blocks but the order is wrong. "
                "Explain that normalize needs to come after resize and pad because the data must be fully framed first. "
                "Give a short indirect hint that the missing step belongs at the end of the preprocessing chain. "
                "Do not mention internal block ids. Respond in 2-3 short sentences, no bullets."
            ) + common_context
        elif problem_type == "invalid_params":
            prompt = (
                "You are Baymax-style tutor for VisionBlocks Module 2 Stage 4 (Quiz: Missing Normalize). "
                "The student is working on the quiz chain and some parameter values are off. "
                f"Explain why the '{friendly_block}' block's current settings do not match the stage goal, using the visible chain context. "
                "Give one indirect, human-friendly hint that helps them inspect the block and adjust the values. "
                "Do not mention internal block ids or exact code names. Respond in 2-3 short sentences, no bullets."
            ) + common_context
        else:
            prompt = (
                "You are Baymax-style tutor for VisionBlocks Module 2 Stage 4 (Quiz: Missing Normalize). "
                "A required block is still missing from the quiz chain. "
                f"Use the chain context to explain why the missing step is '{friendly_missing}' and why it should come after pad. "
                "Give one indirect hint only, without naming the exact code identifier. Respond in 2-3 short sentences, no bullets, friendly tone."
            ) + common_context

        prompt = (
            "Style: 1-2 short sentences. Be direct, no greetings, no fluff. "
            "Do not say you are a healthcare or health care companion.\n\n"
        ) + prompt
        agent_text = _call_openrouter(prompt)
        agent_text = _sanitize_m2_agent_text(agent_text)
        agent_text = _strip_healthcare_claims(agent_text)
        history.last_hint = agent_text
        _M2_STAGE_HISTORY[key] = history
        return AnalyzeAgentResponse(analyzer=analyzer, agent_text=agent_text)

    # Deterministic parameter guidance to avoid LLM hallucinated values.
    if problem_type == "invalid_params" and validation_errors:
        exact_values = "; ".join(_friendly_m2_validation_errors(validation_errors))
        if stage_id == "3":
            agent_text = (
                "Your block order is correct, but some parameter values in the loop body are off. "
                f"Set these exact values: {exact_values}."
            )
        else:
            agent_text = (
                "Your block order is correct, but some parameter values are off. "
                f"Set these exact values: {exact_values}."
            )
        agent_text = _sanitize_m2_agent_text(agent_text)
        history.last_hint = agent_text
        _M2_STAGE_HISTORY[key] = history
        return AnalyzeAgentResponse(analyzer=analyzer, agent_text=agent_text)

    if problem_type == "complete":
        prompt = (
            f"You are Baymax-style tutor for VisionBlocks Module 2 {stage_label}. "
            "The student has the correct chain in the correct order and valid values for this stage. "
            "Respond in 1-2 short sentences: praise, confirm order correctness, and encourage pressing Next Test or Submit when appropriate. "
            "Friendly tone, no bullets."
        ) + common_context
    elif problem_type == "wrong_block":
        if history.repeat_count >= 2:
            prompt = (
                f"You are Baymax-style tutor for VisionBlocks Module 2 {stage_label}. "
                "Student repeatedly chose a wrong block. "
                "Now be explicit: name the exact correct block they need next and explain why that block fits this stage. "
                "Also explain briefly why the chosen wrong block does not fit this stage goal. "
                "Respond in 2-3 short sentences, no bullets, warm but clear."
            ) + common_context
        elif history.repeat_count == 1:
            prompt = (
                f"You are Baymax-style tutor for VisionBlocks Module 2 {stage_label}. "
                "Student repeated a wrong block choice once. "
                "Give an easier hint than before and explain why their chosen block is not suitable yet. "
                "Do NOT reveal the exact block name they need. "
                "Respond in 2-3 short sentences, no bullets."
            ) + common_context
        else:
            prompt = (
                f"You are Baymax-style tutor for VisionBlocks Module 2 {stage_label}. "
                "Student chose a wrong block. "
                "Explain what is wrong with that choice and give an indirect hint about the right kind of step. "
                "Do NOT reveal the exact missing block name. "
                "Respond in 2-3 short sentences, no bullets, supportive tone."
            ) + common_context
    elif problem_type == "wrong_order":
        if history.repeat_count >= 1:
            prompt = (
                f"You are Baymax-style tutor for VisionBlocks Module 2 {stage_label}. "
                "Student repeated order mistakes. "
                "Now state the correct full order directly and explain why this order is correct for preprocessing logic. "
                "Respond in 2-3 short sentences, no bullets."
            ) + common_context
        else:
            prompt = (
                f"You are Baymax-style tutor for VisionBlocks Module 2 {stage_label}. "
                "Blocks are mostly correct but order is wrong. "
                "Explain clearly that order is the issue and provide a guiding hint toward the correct order without listing the exact full chain verbatim. "
                "Respond in 2-3 short sentences, no bullets, gentle tone."
            ) + common_context
    elif problem_type == "invalid_params":
        if history.repeat_count >= 1:
            prompt = (
                f"You are Baymax-style tutor for VisionBlocks Module 2 {stage_label}. "
                "The student has the right blocks in the right order but wrong parameter values. "
                "Be explicit now: name the exact block fields and the exact values to set. "
                "Use ONLY values that appear in Validation details. Never invent ranges or alternate numbers. "
                "If Validation details includes m2.brightness_contrast.B/C, copy those values exactly. "
                "Respond in 2-3 short sentences, no bullets, clear and friendly."
            ) + common_context
        else:
            prompt = (
                f"You are Baymax-style tutor for VisionBlocks Module 2 {stage_label}. "
                "The student has the right blocks in the right order but parameter values are off. "
                "Give one concrete hint about which block values need adjustment, without dumping a long checklist. "
                "Use ONLY values that appear in Validation details. Never invent ranges or alternate numbers. "
                "If Validation details includes m2.brightness_contrast.B/C, copy those values exactly. "
                "Respond in 2-3 short sentences, no bullets."
            ) + common_context
    else:
        if stage_id == "3" and next_missing == "m2.loop_dataset":
            if history.repeat_count >= 2:
                prompt = (
                    "You are the AI assistant for VisionBlocks Module 2 Stage 3 (Loop & Export). "
                    "The student keeps missing the same first step. "
                    "Give a clearer nudge that this stage starts with a repeating structure over many images, then briefly explain why that matters. "
                    "Do NOT list the full pipeline. Do NOT enumerate exact block order. Keep it supportive in 2-3 short sentences, no bullets."
                ) + common_context
            elif history.repeat_count == 1:
                prompt = (
                    "You are the AI assistant for VisionBlocks Module 2 Stage 3 (Loop & Export). "
                    "The student repeated the same start mistake once. "
                    "Give a clearer hint than before that this stage begins with a repeating structure over the dataset, but avoid command-like wording. "
                    "Do NOT list full block sequence or exact order. Use 2-3 short sentences, no bullets, friendly tone."
                ) + common_context
            else:
                prompt = (
                    "You are the AI assistant for VisionBlocks Module 2 Stage 3 (Loop & Export). "
                    "This is the beginning of the stage and the student has not placed the first key structure yet. "
                    "Give a gentle indirect hint that this mission starts with repetition over the dataset before export, without naming exact block IDs. "
                    "Do NOT list full block sequence or exact order. Use 2-3 short sentences, no bullets, warm and clear."
                ) + common_context
        elif stage_id == "3" and next_missing == "m2.export_dataset":
            if history.repeat_count >= 1:
                prompt = (
                    "You are the AI assistant for VisionBlocks Module 2 Stage 3 (Loop & Export). "
                    "The student is repeating the same missing final step. "
                    "Give a clearer hint that after repeated processing, one final save action should happen outside the loop. "
                    "Do NOT list the entire recipe or exact ordered block names. Respond in 2-3 short sentences, no bullets, supportive tone."
                ) + common_context
            else:
                prompt = (
                    "You are the AI assistant for VisionBlocks Module 2 Stage 3 (Loop & Export). "
                    "The loop structure exists but the final save action is missing. "
                    "Give a hint that after processing everything in the loop, there should be one final step that writes results out. "
                    "Do NOT list full sequence or exact order. Respond in 2-3 short sentences, no bullets."
                ) + common_context
        elif stage_id == "3":
            if history.repeat_count >= 1:
                prompt = (
                    "You are the AI assistant for VisionBlocks Module 2 Stage 3 (Loop & Export). "
                    "The student is still missing part of the loop-body recipe. "
                    "Give a clearer hint that the loop body should contain the recipe in a sensible flow, while keeping a coaching tone. "
                    "Give only one next-step hint. Do NOT enumerate the full sequence or exact order. Respond in 2-3 short sentences, no bullets."
                ) + common_context
            else:
                prompt = (
                    "You are the AI assistant for VisionBlocks Module 2 Stage 3 (Loop & Export). "
                    "A required piece is still missing in this stage. "
                    "Gently hint that the loop should contain the complete preprocessing recipe before the final export step. "
                    "Give only one next-step hint. Do NOT enumerate full sequence or exact order. Respond in 2-3 short sentences, no bullets, friendly tone."
                ) + common_context
        elif history.repeat_count >= 2:
            prompt = (
                f"You are Baymax-style tutor for VisionBlocks Module 2 {stage_label}. "
                "Student still cannot find the missing step after repeated tries. "
                "Now explicitly tell the exact block they should add next and explain why this is the correct block at this point. "
                "Respond in 2-3 short sentences, no bullets."
            ) + common_context
        elif history.repeat_count == 1:
            prompt = (
                f"You are Baymax-style tutor for VisionBlocks Module 2 {stage_label}. "
                "Student missed the same step again. "
                "Give an easier and more concrete hint than before, but still do not name the exact missing block. "
                "Respond in 2-3 short sentences, no bullets."
            ) + common_context
        else:
            prompt = (
                f"You are Baymax-style tutor for VisionBlocks Module 2 {stage_label}. "
                "A required step is missing. "
                "Give one indirect hint to help find the missing step without naming it directly. "
                "Respond in 2-3 short sentences, no bullets, friendly tone."
            ) + common_context

    prompt = (
        "Style: 1-2 short sentences. Be direct, no greetings, no fluff. "
        "Do not say you are a healthcare or health care companion.\n\n"
    ) + prompt
    agent_text = _call_openrouter(prompt)
    agent_text = _sanitize_m2_agent_text(agent_text)
    agent_text = _strip_healthcare_claims(agent_text)
    history.last_hint = agent_text
    _M2_STAGE_HISTORY[key] = history
    # Also record the hint into the chat memory for module2 so the chat endpoint can reference it
    try:
        _record_hint_in_chat_memory(chat_key, agent_text)
    except Exception:
        pass

    return AnalyzeAgentResponse(analyzer=analyzer, agent_text=agent_text)


class Module2ChatRequest(BaseModel):
    user_id: str
    message: str
    workspace_state: Optional[Dict[str, Any]] = None
    workspace_summary: Optional[Dict[str, Any]] = None
    stage_id: Optional[str] = None


@router.post("/module2/chat", response_model=ChatResponse)
def module2_chat(req: Module2ChatRequest, request: Request):
    message = (req.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    stage_id = str(req.stage_id or "1")
    key = _chat_history_key(req.user_id or "", request) + f":module2-stage{stage_id}"
    session = _append_chat_turn(key, "user", message, source="chat")

    latest_hint = _latest_hint_for_key(key)
    workspace_context = req.workspace_summary or req.workspace_state
    workspace_text = _workspace_state_summary(workspace_context)
    chat_history_text = _recent_chat_history_text(session)

    lower_message = message.lower()
    explanation_mode = any(
        phrase in lower_message
        for phrase in [
            "don't understand",
            "do not understand",
            "explain more",
            "why is this wrong",
            "what does this hint mean",
        ]
    )

    prompt_parts = [
        "You are a tutor for VisionBlocks Module 2 (image preprocessing).",
        "Help the student understand the preprocessing pipeline and Blockly hints.",
        "Answer in 1-2 short sentences. Be direct and grounded in the current workspace.",
        "Do not invent blocks or steps that are not present in the workspace state.",
        "Do not say you are a healthcare or health care companion.",
        "No greetings or extra encouragement; keep it concise.",
    ]
    if stage_id in {"1", "2", "4"}:
        prompt_parts.append(
            "Correct order for this pipeline is: grayscale → brightness/contrast → blur/sharpen → resize → pad → normalize."
        )
    if stage_id == "3":
        prompt_parts.append(
            "Stage 3 uses a loop over the dataset; the preprocessing chain belongs inside the loop and export happens after the loop."
        )
    if stage_id == "4":
        prompt_parts.append(
            "This is a quiz: the chain is already built and only the normalize block is missing."
        )
        prompt_parts.append(
            "Normalize must come AFTER pad. Do not say pad is the last step."
        )
    if latest_hint:
        prompt_parts.append(f"Latest hint: {latest_hint}")
    if explanation_mode:
        prompt_parts.append(
            "The student is asking for clarification, so explicitly explain why the latest hint matters and what to inspect in the workspace."
        )
    prompt_parts.extend([
        f"Workspace state: {workspace_text}",
        f"Conversation history:\n{chat_history_text}",
        f"Student message: {message}",
    ])

    prompt = "\n\n".join(prompt_parts)

    try:
        assistant_response = _call_openrouter(prompt).strip()
    except Exception:
        if latest_hint:
            assistant_response = (
                f"The latest hint is: {latest_hint}. "
                f"Using the current workspace, I would inspect {workspace_text}."
            )
        else:
            assistant_response = (
                "Tell me what part feels unclear and I’ll explain it using the current workspace state."
            )

    if not assistant_response:
        assistant_response = (
            "I can help explain the current hint if you point me at the block or question that feels confusing."
        )

    assistant_response = _sanitize_m2_agent_text(assistant_response)
    assistant_response = _strip_healthcare_claims(assistant_response)

    _append_chat_turn(key, "assistant", assistant_response, source="chat")

    session = _CHAT_HISTORY.get(key) or _get_chat_session(key)

    return ChatResponse(
        assistant_response=assistant_response,
        last_hint=latest_hint,
        conversation_length=len(session.turns) if session else 0,
    )
