# AI System Design: VisionBlocks Educational AI Tutoring System

## 1. MODEL SELECTION

### LLM Provider
- **Provider Name**: OpenRouter
- **API Endpoint**: `https://api.openrouter.ai/v1/chat/completions`
- **Environment Variables**: 
  - `OPENROUTER_API_KEY`: Required API authentication
  - `OPENROUTER_MODEL`: Model name (read from environment in apps/api/app/routes/agent.py:44)

### Model Identifier
- **Model String**: `"gpt-4o-mini"` (default across all AI endpoints)
- **Location**: apps/api/app/routes/agent.py line 44 (env read) and implied in analyzer.py (no explicit model string found—inferred from OPENROUTER_MODEL environment variable)

### API Parameters
- **max_tokens**: 
  - Module 1 hints: `300` (apps/api/app/routes/analyzer.py:_call_openrouter function, Line ~600)
  - Module 2/4 agents: `300` (via _call_openrouter shared function)
  - Example usage: `128` (apps/api/app/routes/agent.py:22, but this is example/demo code)
- **temperature**: `0.2` (consistent across all calls)
  - apps/api/app/routes/analyzer.py:_call_openrouter (Line ~600)
  - apps/api/app/routes/agent.py:22
- **timeout**: `120` seconds (apps/api/app/routes/analyzer.py:_call_openrouter function)

### Retry & Error Handling Mechanism
- **max_attempts**: `3` retries
- **Backoff strategy**: Exponential (1.0s → 2.0s → 4.0s)
- **HTTP Status Codes Handled**: 429 (rate limit), 502 (bad gateway), 503 (service unavailable), 504 (gateway timeout)
- **Fallback Payload Format**: If chat-style payload fails, attempts prompt-only payload format for model compatibility
- **Location**: apps/api/app/routes/analyzer.py:_call_openrouter (Line ~550-700)

### Evidence of Multiple Model Support
- **agent.py call_openrouter()** function accepts `model: str` parameter (Line ~17), allowing runtime model selection
- No explicit testing/switching code found in codebase (single hardcoded model in production: gpt-4o-mini)
- Architecture designed for multi-model support but currently monolithic (gpt-4o-mini only)

### Function Implementation: _call_openrouter()
**Location**: apps/api/app/routes/analyzer.py lines 550-700
**Signature**: `def _call_openrouter(prompt: str) -> str`
**Payload Structure**:
```python
chat_payload = {
    "model": OPENROUTER_MODEL,
    "messages": [{"role": "user", "content": prompt}],
    "max_tokens": 300,
    "temperature": 0.2
}
```
**Return**: Raw text response from LLM (string)

---

## 2. AGENTIC ARCHITECTURE

### Workspace Monitoring Trigger & Data Flow

#### Frontend Workspace Change Detection
**File**: apps/web/src/app/module1/page.tsx
**Lines**: 560-570 (onChange listener), 979-1060 (instantFeedback function)

**Trigger Mechanism**:
1. Blockly workspace emits `onChange` event whenever blocks are added/removed/reordered
2. Event debounced by `WORKSPACE_CHANGE_DEBOUNCE_MS = 300ms` (Line 21)
3. After 300ms silence, `instantFeedback()` executes
4. `instantFeedback()` captures workspace snapshot via `workspaceToAnalyzePayload()` (Line 1-90)

**Workspace Snapshot Format**:
```typescript
{
  chains: [
    {
      top_block_type: string | null,
      blocks: [
        { type: string, fields: Record<string, unknown> },
        ...
      ]
    },
    ...
  ],
  client_signature?: string
}
```

**Data Collection**:
- `getTopChains(ws)` extracts all top-level chains from workspace
- `blockToModel(b)` converts each block to `{type: string, fields: object}`
- Includes `clientSignatureRef.current` for user session tracking (localStorage persisted ID, Line 295-305)

#### Backend Analysis Request
**File**: apps/api/app/routes/analyzer.py
**Endpoint**: `POST /analyze/module1/agent`
**Request Type**: AnalyzeRequest (BaseModel)
**Required Fields**: chains, client_signature (optional), user_id (optional)

**Response Type**: AnalyzeAgentResponse (BaseModel)
```python
{
    "analyzer": AnalyzeResponse,
    "agent_text": str
}
```

### Planning Steps (Checklist & Planned Actions)

#### Step 1: Deterministic Workspace Analysis
**Function**: `analyze_workspace()` (apps/api/app/routes/analyzer.py lines 400-550)
**Outputs**:
1. **Signature**: SHA256 hash of canonical JSON payload (deterministic for deduplication)
2. **Checklist**: List of ChecklistItem objects with states ("ok", "wrong_place", "missing")
3. **Planned Actions**: List of PlannedAction objects (inferred from workspace state)

**ChecklistItem Structure**:
```python
ChecklistItem(
    key: str,           # block type identifier (e.g., "dataset.select")
    label: str,         # friendly name (e.g., "Use Dataset")
    state: str          # "ok" | "wrong_place" | "missing"
)
```

**REQUIRED_ORDER for Module 1** (apps/api/app/routes/analyzer.py line 175):
```python
REQUIRED_ORDER = [
    "dataset.select",
    "dataset.info",
    "dataset.class_counts",
    "dataset.class_distribution_preview",
    "dataset.sample_image",
    "image.channels_split"
]
```

#### Step 2: Student History Tracking
**Data Structure**: _StudentHistory (apps/api/app/routes/analyzer.py lines 235-246)
```python
class _StudentHistory(BaseModel):
    last_missing_key?: str           # Last missing block type tracked
    last_wrong_place: bool           # Was previous hint about wrong placement?
    repeat_count: int                # Escalation counter (incremented when same mistake repeated)
    last_hint?: str                  # Previous hint text
    last_seen: float                 # Timestamp
```

**Tracking Variables**:
- `_HISTORY: Dict[str, _StudentHistory]` (Module 1 hints by history_key)
- `_M2_STAGE_HISTORY: Dict[str, _Module2StageHistory]` (Module 2 stages)
- `_M4_STAGE_HISTORY: Dict[str, _Module2StageHistory]` (Module 4 stages)

#### Step 3: Agent-Specific Agents
**Module 1 Agent**: `analyze_module1_with_agent(req, request)` (apps/api/app/routes/analyzer.py line 676)
**Module 2 Stage Agent**: `analyze_module2_with_agent(req, request)` (apps/api/app/routes/analyzer.py line 1940)
**Module 4 Stage Agent**: `analyze_module4_with_agent(req, request)` (apps/api/app/routes/analyzer.py line 1820)

### Timeout Constants

**WORKSPACE_CHANGE_DEBOUNCE_MS**: 
- **Value**: `300ms`
- **Location**: apps/web/src/app/module1/page.tsx line 21
- **Purpose**: Debounce workspace onChange events before triggering instantFeedback
- **Usage**: apps/web/src/app/module1/page.tsx line 562-568 (setTimeout in onChange listener)

**ANALYZER_REQUEST_TIMEOUT_MS**:
- **Value**: `12000ms` (12 seconds)
- **Location**: apps/web/src/app/module1/page.tsx line 22
- **Purpose**: Abort analyzer/agent API request if response exceeds timeout
- **Usage**: apps/web/src/app/module1/page.tsx line 1020 (controller.signal in fetch)

**CHAT_REQUEST_TIMEOUT_MS**:
- **Value**: `15000ms` (15 seconds)
- **Location**: apps/web/src/app/module1/page.tsx line 23
- **Purpose**: Abort chat API request if response exceeds timeout
- **Usage**: apps/web/src/app/module1/page.tsx line 491 (controller.signal in fetch)

**AGENT_THROTTLE_MS**:
- **Value**: `3500ms` (3.5 seconds minimum between agent calls)
- **Location**: apps/web/src/app/module1/page.tsx line 20
- **Purpose**: Prevent API call spam by throttling consecutive agent requests
- **Usage**: apps/web/src/app/module1/page.tsx line 1033-1048 (elapsed check)

### Stage/Module Detection

#### Module 1 Detection
**Implicit**: Default module, no stage parameter
**Detection Method**: Checks for "dataset.select" block in workspace (primary chain identification)
**Function**: `_find_primary_chain(req: AnalyzeRequest)` (apps/api/app/routes/analyzer.py line 920)
```python
# Returns first chain containing "dataset.select", or first chain if none found
for ch in req.chains:
    if any(b.type == "dataset.select" for b in ch.blocks):
        return ch
if req.chains:
    return req.chains[0]
```

#### Module 2 Stage Detection
**Parameter**: `req.stage_id` (required, values: "1", "2", "3", "4")
**Stage Requirements**: M2_STAGE1_REQUIRED_ORDER, M2_STAGE2_REQUIRED_ORDER, M2_STAGE3_REQUIRED_ORDER, M2_STAGE4_REQUIRED_ORDER
**Location**: apps/api/app/routes/analyzer.py lines 820-870
**Detection Logic**: `_analyze_module2_stage_problem(req, stage_id)` checks current blocks against stage-specific REQUIRED_ORDER

#### Module 4 Stage Detection
**Parameter**: `req.stage_id` (required, values: "1", "2", "3")
**Stage Requirements**: M4_STAGE1_REQUIRED_ORDER, M4_STAGE2_REQUIRED_ORDER
**Location**: apps/api/app/routes/analyzer.py lines 1590-1610
**Detection Logic**: `_analyze_module4_stage_problem(req, stage_id)` matches blocks to expected order

---

## 3. HINT GENERATION & ESCALATION

### Prompt Structure Patterns

#### Module 1 Hint Generation Prompts
**Function**: `analyze_module1_with_agent(req, request)` (apps/api/app/routes/analyzer.py lines 676-750)

**Escalation Condition Detection**:
```python
if repeat_count increases:
    history.repeat_count += 1
else:
    history.repeat_count = 0

if repeat_count > 0:
    add "acknowledge the last hint and rephrase it" to prompt
```

**Five Prompt Variants (Based on Checklist State)**:

1. **Completion Prompt** (all blocks "ok"):
   ```
   "Congratulate them, say the chain is complete, encourage submission"
   Context: repeat_count=0, all checklist items state="ok"
   ```
   Location: apps/api/app/routes/analyzer.py line 700

2. **Dataset.select Missing Prompt** (critical dependency):
   ```
   "Must choose a dataset first because every other step depends on it"
   Context: next_missing_key = "dataset.select"
   ```
   Location: apps/api/app/routes/analyzer.py line 705

3. **Wrong Place Prompt** (blocks out of order):
   ```
   "Use dataset must come first"
   Context: Some block state="wrong_place"
   ```
   Location: apps/api/app/routes/analyzer.py line 710

4. **Next Missing Step Prompt** (normal case):
   ```
   "Briefly comment on most recently added block, then give ONLY next missing step hint"
   Context: next_missing_key identified, repeat_count may vary
   Structure:
   - If repeat_count > 0: "Acknowledge the last hint and rephrase it with more explanation"
   - Include: chain_order, last_block_type, dataset_summary, repeat_count, last_hint in context
   ```
   Location: apps/api/app/routes/analyzer.py line 715-720

5. **Fallback Local Hint** (if API fails):
   ```
   _local_hint_from_checklist(checklist, history)
   Returns block-specific hint text without AI
   ```
   Location: apps/api/app/routes/analyzer.py line 725

#### Module 2 Stage Agent Prompts
**Function**: `analyze_module2_with_agent(req, request)` (apps/api/app/routes/analyzer.py lines 1940-2250)

**Stage 4 (Quiz) Prompts** (apps/api/app/routes/analyzer.py lines 1970-2005):

- **Complete**: "Praise success, confirm chain complete, encourage submitting. Do not mention block ids."
- **Wrong Block**: "Explain why chosen block doesn't fit, give indirect hint. Do not reveal exact code identifier."
- **Wrong Order**: "Explain normalize must come after pad. Give short indirect hint without mentioning block ids."
- **Invalid Params**: "Explain parameter values don't match stage goal, give concrete hint without code names."
- **Missing**: "Use chain context to explain why missing step needed, give indirect hint without naming exact code."

**Stages 1-3 Prompts** (apps/api/app/routes/analyzer.py lines 2010-2250):

**Problem Type: COMPLETE**
```
"Student has correct chain in correct order with valid values.
Respond in 1-2 short sentences: praise, confirm order correctness, 
encourage pressing Next Test or Submit. Friendly tone, no bullets."
```

**Problem Type: WRONG_BLOCK**
- **repeat_count == 0** (first attempt): "Explain what is wrong, give indirect hint, do NOT reveal block name"
- **repeat_count == 1** (second attempt): "Give easier hint, explain why chosen block unsuitable, do NOT reveal exact block name"
- **repeat_count >= 2** (repeated mistakes): "Be explicit now: name exact correct block, explain why it fits this stage"

**Problem Type: WRONG_ORDER**
- **repeat_count == 0**: "Explain order is issue, provide guiding hint without listing exact full chain"
- **repeat_count >= 1**: "State correct full order directly, explain why this order correct for preprocessing logic"

**Problem Type: INVALID_PARAMS**
- **repeat_count == 0**: "Give one concrete hint about which block values need adjustment, use ONLY Validation details values"
- **repeat_count >= 1**: "Be explicit now: name exact block fields and exact values to set, copy values from Validation details only"

**Problem Type: MISSING**
- **Stage 3 + m2.loop_dataset**:
  - **repeat_count == 0**: "Give gentle indirect hint about repeating structure, avoid naming block IDs"
  - **repeat_count == 1**: "Give clearer hint, avoid command wording, do NOT list full sequence"
  - **repeat_count >= 2**: "Give clearer nudge about repeating structure, explain why it matters"
  
- **Stage 3 + m2.export_dataset**:
  - **repeat_count == 0**: "Hint that after loop processing, final save action should happen"
  - **repeat_count >= 1**: "Clearer hint that after loop, final save action happens outside loop"

- **Stage 3 + Other Blocks**: Uses `stage3_role_hints` dict with semantic descriptions of block purposes
  - **repeat_count == 0**: "Give indirect hint using current chain"
  - **repeat_count == 1**: "Make hint a little clearer than before"
  - **repeat_count >= 2**: "Explicitly tell exact block and explain why correct at this point"

- **Other Stages**:
  - **repeat_count == 0**: "Give one indirect hint without naming block directly"
  - **repeat_count == 1**: "Give easier, more concrete hint, do NOT name exact block"
  - **repeat_count >= 2**: "Explicitly tell exact block they should add, explain why correct"

#### Module 4 Stage Agent Prompts
**Function**: `analyze_module4_with_agent(req, request)` (apps/api/app/routes/analyzer.py lines 1820-1920)

**Empty Pipeline + First Attempt**:
```
"Introduce workflow concept. Explain they're building ML pipeline. 
Ask: what FIRST thing must happen in any ML project before model building?
Guide toward conceptual step without naming block. Keep conversational, 2-3 sentences."
```

**Complete Chain**:
```
"Congratulate warmly, explain in 1 sentence why sequence makes sense, 
encourage submission. Keep celebratory and brief, 2-3 sentences max."
```

**Wrong Order**:
- **repeat_count == 0**: "Point out ONE adjacent pair that's wrong. Explain WHY order problematic (data flow). Guide to think logically, 2-3 sentences."
- **repeat_count == 1**: "More direct but educational. Name specific issue, briefly explain reason, suggest one specific move. 2-3 short sentences, supportive."
- **repeat_count >= 2**: "Clearly state exact fix needed. Remind reason in 1 simple phrase. Encourage that understanding helps future models. 2 sentences, direct but encouraging."

**Wrong Block**:
- **repeat_count == 0**: "Identify block, explain why doesn't fit stage. Ask them to think: what is this stage's purpose? 2-3 sentences to prompt reflection."
- **repeat_count == 1**: "Confirm block not meant for this stage—belongs later. Remind this stage about data/model. Suggest look for block supporting that goal. 2 short sentences, supportive."
- **repeat_count >= 2**: "Very simple language. Block doesn't belong here—it's for different part. This stage needs data prep or model building block. Try different block. 2 sentences."

**Missing Block**:
- **repeat_count == 0**: "Point out what done, what pipeline missing. Ask: what must happen next in real ML workflow? Hint at concept without naming block. 2-3 sentences, encourage self-discovery."
- **repeat_count == 1**: "More direct. Name missing step and what it does. Explain why matters in workflow. Encourage try dragging matching block. 2 short sentences."
- **repeat_count >= 2**: "Very simple. You missing key step. Step helps [briefly explain role]. Find in toolbox, add after last block. 2 sentences, action-oriented."

### Escalation Tracking Variables

**_StudentHistory** (Module 1):
```python
repeat_count: int        # Escalation counter (0 = first attempt, 1+ = repeated same mistake)
last_missing_key: Optional[str]
last_wrong_place: bool
last_hint: Optional[str]
last_seen: float        # Timestamp for timeout/session detection
```

**_Module2StageHistory** (Module 2 & Module 4):
```python
last_problem_key: Optional[str]     # Composite key tracking problem state
last_chain_key: Optional[str]       # Current block chain representation
last_wrong_block: Optional[str]     # Most recent wrong block (for tracking wrong_block_repeat)
wrong_block_repeat: int             # Repetition counter for wrong block attempts
repeat_count: int                   # Escalation counter for same problem
last_hint: Optional[str]
last_seen: float
```

**Escalation Logic** (apps/api/app/routes/analyzer.py lines 710-730):
```python
problem_key = f"{problem_type}|missing={next_missing}|wrong={wrong_block}|chain={chain_text}"

if problem_type == "complete":
    history.repeat_count = 0
    history.last_problem_key = None
elif history.last_problem_key == problem_key:
    history.repeat_count += 1  # Same problem again, escalate
else:
    history.repeat_count = 0    # New problem, reset counter
```

### Attempt Tracking (Repeat Count Indexing)
- **Attempt 1** (repeat_count == 0): Introductory hint, encourage discovery
- **Attempt 2** (repeat_count == 1): Intermediate hint, more direct guidance
- **Attempt 3** (repeat_count >= 2): Explicit instruction, minimized ambiguity

### Student Struggle Tracking
**Tracked via**: `repeat_count` in _StudentHistory and _Module2StageHistory
**Indicates**: Number of times student has repeated same mistake (same problem_key)
**Used for**: Escalating hint directness based on struggle severity

**Module 2 Bonus Tracking** (stage_id == "4"):
- `wrong_block_repeat: int` tracks consecutive wrong block selections in quiz context
- `last_wrong_block: str` stores the problematic block type for comparison

### Fallback Hint Generation: _local_hint_from_checklist()
**Location**: apps/api/app/routes/analyzer.py lines 149-170
**Purpose**: Non-AI hint fallback when API unavailable
**Signature**: `def _local_hint_from_checklist(checklist: List[ChecklistItem], history: Optional[_StudentHistory] = None) -> str`

**Logic**:
1. Find first ChecklistItem with state == "missing"
2. If repeat_count >= 1: Add "because {reason}" explanation
3. Return block-specific hint text

**Block-Specific Hints**:
```python
{
    "dataset.info": "Check the dataset info (shape, classes, distribution)",
    "dataset.class_counts": "Get the class counts from the dataset",
    "dataset.class_distribution_preview": "Visualize the class distribution",
    "dataset.sample_image": "Get a sample image from the dataset",
    "image.channels_split": "Split the RGB channels to see each component"
}
```

### Missing Block Detection: _get_next_missing_key()
**Location**: apps/api/app/routes/analyzer.py lines 141-148
**Signature**: `def _get_next_missing_key(checklist: List[ChecklistItem]) -> Optional[str]`
**Logic**: Iterates REQUIRED_ORDER array, returns first key where state == "missing"
**Used for**: Determining which block to hint about next in escalation prompts

---

## 4. CHAT GROUNDING & CONTEXT MANAGEMENT

### Chat Session Structure: _ChatSession
**Location**: apps/api/app/routes/analyzer.py lines 255-273
**Dataclass Structure**:
```python
@dataclass
class _ChatSession:
    turns: List[_ChatTurn]           # Message history
    last_hint: Optional[str] = None  # Most recent hint from analyzer
    memory: Any = None               # LangChain ConversationBufferMemory (optional)
```

**_ChatTurn Dataclass**:
```python
@dataclass
class _ChatTurn:
    role: str                        # "user" | "assistant"
    content: str                     # Message text
    ts: float                        # Timestamp
    source: str = "chat"             # "chat" | "hint" (hint source indicates from analyzer, not user)
```

### Chat History Storage
**Global Dictionary**: `_CHAT_HISTORY: Dict[str, _ChatSession]` (apps/api/app/routes/analyzer.py line 291)
**Session Key Generation**: `_chat_history_key(user_id, request)` (apps/api/app/routes/analyzer.py lines 309-321)
```python
# Returns: f"{user_id}:{client_ip}"
# Used for per-user, per-session isolation
```

**Module-Scoped Isolation**: `_module_chat_key(module: str, user_id: str, request)` (apps/api/app/routes/analyzer.py line 323)
```python
# Returns: f"{user_id}:{client_ip}:module{module}"
# Keeps Module 2, Module 3/4 chat histories separate
```

### Turn Limit (Rolling Window)
**Default Limit**: Last `200` turns
**Location**: apps/api/app/routes/analyzer.py line 349
**Function**: `_append_chat_turn(key, role, content, source, dedupe)`
```python
session.turns = session.turns[-200:]  # Keep only last 200 turns
```
**Purpose**: Prevent unbounded token growth in prompt context injection

### Workspace State Injection
**Function**: `_workspace_state_summary(value: Any) -> str` (apps/api/app/routes/analyzer.py line 367)
**Compression Limit**: Max 4000 characters
**Format Options**:
1. **If workspace has chains**: `"workspace chains: block1 -> block2; block3 -> block4"`
2. **If workspace has blocks**: `"workspace blocks: block1, block2, ..."`
3. **Fallback JSON**: `"workspace json: {...}"`

**Injection Location in Prompt**: Appended before student message in chat endpoint (apps/api/app/routes/analyzer.py line 875)
```python
f"Workspace state: {workspace_text}"
```

### Hint vs. Question Differentiation

**Explanation Mode Detection** (apps/api/app/routes/analyzer.py line 861-869):
```python
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
        "what does this hint mean"
    ]
)
```

**Module 1 Chat Behavior**:
- If explanation_mode: "Explicitly explain why the latest hint matters"
- If normal question: Provide general tutor guidance grounded in workspace

**Module 2 Chat Behavior**:
- If explanation_mode: "Explicitly explain why the latest hint matters and what to inspect"
- If normal question: Help understand preprocessing pipeline

### LangChain Memory Integration
**Optional Dependency**: Conditional import with try/except (apps/api/app/routes/analyzer.py line 13)
```python
try:
    from langchain.memory import ConversationBufferMemory
except ImportError:
    ConversationBufferMemory = None
```

**Initialization**: `_ensure_langchain_memory(key)` (apps/api/app/routes/analyzer.py lines 327-333)
```python
def _ensure_langchain_memory(key: str):
    session = _get_chat_session(key)
    if session.memory is None and ConversationBufferMemory is not None:
        session.memory = ConversationBufferMemory(
            memory_key="history",
            input_key="message",
            output_key="assistant_response",
            return_messages=False
        )
```

**Memory Recording**: `_append_chat_turn()` updates memory (apps/api/app/routes/analyzer.py lines 345-365)
```python
if ConversationBufferMemory is not None and session.memory:
    session.memory.chat_memory.add_user_message(content)
    # or
    session.memory.chat_memory.add_ai_message(content)
```

### Chat History Retrieval
**Function**: `_recent_chat_history_text(session: _ChatSession, limit: int = 12) -> str` (apps/api/app/routes/analyzer.py line 387)
**Default Limit**: Last 12 turns
**Format**: 
```
User: {content}
Assistant: {content}
User: {content}
Assistant: {content}
...
```
**Special Handling**: Turns with source=="hint" labeled as "Hint:" instead of "Assistant:"
**Location**: Used in chat prompts to inject recent conversation context (apps/api/app/routes/analyzer.py line 875)

### Chat Endpoints

#### Module 1 Chat Endpoint
**Route**: `POST /chat`
**Request**: ChatRequest (user_id, message, workspace_state, workspace_summary)
**Response**: ChatResponse (assistant_response, last_hint, conversation_length)
**Function**: `chat(req, request)` (apps/api/app/routes/analyzer.py line 751-900)
**Session Key**: `_chat_history_key(req.user_id, request)` (per-user, per-IP isolation)

#### Module 2 Chat Endpoint
**Route**: `POST /module2/chat`
**Request**: Module2ChatRequest (user_id, message, workspace_state, workspace_summary, stage_id)
**Response**: ChatResponse (assistant_response, last_hint, conversation_length)
**Function**: `module2_chat(req, request)` (apps/api/app/routes/analyzer.py line 2300+)
**Session Key**: `_chat_history_key(req.user_id, request) + f":module2-stage{stage_id}"` (stage-scoped)

#### Module 3/4 Chat Endpoint
**Route**: `POST /module4/chat` (Note: endpoint name is "module4" but handles both Module 3 and 4 based on stage_id)
**Request**: ChatRequest with stage_id
**Response**: ChatResponse
**Function**: `module4_chat(req, request)` (apps/api/app/routes/analyzer.py line 900+)
**Session Key**: `_module_chat_key("m4", req.user_id, request)` (module 3/4 isolated)

### Chat Prompt Injection Structure
**Full Prompt Parts** (apps/api/app/routes/analyzer.py lines 865-880):
1. System role: "You are the Module X chat assistant for VisionBlocks"
2. Context bounds: "Help student understand [module purpose]"
3. Response constraints: "Answer in X sentences. Be direct."
4. Latest hint: `f"Latest hint: {latest_hint}"` (if available)
5. Workspace context: `f"Workspace state: {workspace_text}"` (compressed, <4000 chars)
6. Chat history: `f"Conversation history:\n{chat_history_text}"` (last 12 turns)
7. Student message: `f"Student message: {message}"`
8. Explanation mode adjustment: If true, adds "explicitly explain why the latest hint matters"

### Hint Reference Tracking
**Function**: `_latest_hint_for_key(key: str) -> Optional[str]` (apps/api/app/routes/analyzer.py)
**Logic**: Searches _CHAT_HISTORY[key] for most recent turn with source == "hint", returns its content
**Usage**: Appended to chat prompts to ensure AI responses reference the latest guidance

---

## Supporting Data Structures

### Data Models (Pydantic BaseModel)
- **BlockModel**: type, fields
- **ChainModel**: top_block_type, blocks
- **AnalyzeRequest**: chains, client_signature (optional), user_id (optional), stage_id (optional)
- **ChecklistItem**: key, label, state ("ok" | "wrong_place" | "missing")
- **PlannedAction**: action, tool, args, requires (optional)
- **AnalyzeResponse**: signature, chains, checklist, planned_actions
- **AnalyzeAgentResponse**: analyzer, agent_text
- **ChatRequest**: user_id, message, workspace_state (optional), workspace_summary (optional)
- **ChatResponse**: assistant_response, last_hint (optional), conversation_length

### Post-Generation Sanitization

#### Block Name Sanitization
**Function**: `_sanitize_m1_agent_text(text)` (apps/api/app/routes/analyzer.py line 127)
**Purpose**: Replace code block names with friendly versions
**Mappings** (M1_FRIENDLY_BLOCK_NAMES dict):
```python
"dataset.select" → "use dataset"
"dataset.info" → "dataset info"
"image.channels_split" → "split RGB channels (preview)"
# ... and others
```

**Function**: `_sanitize_m2_agent_text(text)` (apps/api/app/routes/analyzer.py line 1050)
**Module 2 Mappings**:
```python
"m2.to_grayscale" → "convert to grayscale"
"m2.resize" → "resize image"
"m2.normalize" → "normalize pixels"
# ... and others
```

**Function**: `_sanitize_m4_agent_text(text)` (apps/api/app/routes/analyzer.py line 1525)
**Module 4 Mappings**:
```python
"m4.model_init" → "start new model"
"m4.layer_conv2d" → "add conv layer"
"m4.train_start" → "start training"
# ... and others
```

#### Healthcare Claims Removal
**Function**: `_strip_healthcare_claims(text: str) -> str` (apps/api/app/routes/analyzer.py line 1531)
**Purpose**: Filter AI responses to prevent healthcare companion claims
**Banned Phrases**:
```python
[
    "health care companion",
    "healthcare companion",
    "health-care companion",
    "i am your healthcare companion",
    "i am your health care companion"
]
```
**Fallback Text**: If all lines removed, returns "I'm here to help with your module task."
**Applied After**: All AI generation (_call_openrouter) in hint/chat endpoints

---

## Implementation Summary: AI Request Flow (Module 1)

```
Frontend Workspace Change
  ↓
[300ms debounce: WORKSPACE_CHANGE_DEBOUNCE_MS]
  ↓
instantFeedback() captures workspace snapshot
  ↓
POST /analyze/module1/agent with ChainModel list
  ↓
analyze_workspace() generates checklist + signature
  ↓
analyze_module1_with_agent() checks _StudentHistory
  ↓
[Escalation Decision: repeat_count]
  ↓
Generate prompt with context (chain_order, repeat_count, last_hint, dataset_summary)
  ↓
_call_openrouter(prompt, max_tokens=300, temperature=0.2)
  [Retry logic: 3 attempts, exponential backoff 1s→2s→4s]
  ↓
_sanitize_m1_agent_text() → _strip_healthcare_claims()
  ↓
Return AnalyzeAgentResponse(agent_text)
  ↓
[12s timeout: ANALYZER_REQUEST_TIMEOUT_MS]
  ↓
Frontend displays hint via setAgentCard()
```

---

**Document Status**: Complete extraction of AI system design from VisionBlocks codebase
**Extraction Date**: Current session
**Source Files**:
- apps/api/app/routes/analyzer.py (primary: ~2300 lines)
- apps/api/app/routes/agent.py (example: ~50 lines)
- apps/web/src/app/module1/page.tsx (frontend: ~1600 lines)
- apps/web/src/app/module2/(shared)/StageRunner.tsx (not extensively read)
