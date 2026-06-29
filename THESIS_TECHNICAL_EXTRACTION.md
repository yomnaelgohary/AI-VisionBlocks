# VISIONBLOCKS: TECHNICAL IMPLEMENTATION EXTRACTION
## For Bachelor Thesis Technical Methodology Chapter

**Document Purpose:** Factual implementation details extracted from codebase. No inferences. All claims directly verifiable from source code.

**Extraction Rules Applied:**
- ✓ Only information existing in codebase
- ✓ Actual file names, folder names, class names, function names included
- ✓ All AI-specific functionality excluded (LLM, RAG, embeddings, hint generation, chatbot logic)
- ✓ No thesis-ready prose—raw structured data only
- ✓ File/function references precise and locatable

---

# 3.2.1 SYSTEM ARCHITECTURE

## Architecture Style

**Pattern:** Client-Server (REST API)

**Frontend:** Single-Page Web Application (Next.js with file-based routing)

**Backend:** API-first microservices pattern (FastAPI with modular routers)

**Communication:** HTTP/HTTPS REST over JSON

**Evidence:**
- Frontend: [apps/web/next.config.ts](apps/web/next.config.ts) defines Next.js build configuration
- Backend: [apps/api/app/main.py](apps/api/app/main.py) instantiates FastAPI application with CORS middleware
- API design: 9 routers (health, datasets, preprocess, split, model, evaluate, predict, train, analyzer)

---

## System Components

### 1. **Frontend Web Application**

**Purpose:** Visual block-based programming interface; workspace rendering; user input handling

**Technology Stack:**
- Framework: Next.js 15.5.14 with Turbopack
- Runtime: React 19.1.0
- Language: TypeScript 5 (strict mode enabled)
- Styling: Tailwind CSS 4 with PostCSS
- Animation: Framer Motion 12.23.24
- Icons: Lucide React 0.553.0
- Visual Programming: Blockly 12.3.1 with workspace search and zoom-to-fit plugins

**Folder Structure:**
```
apps/web/src/
├── app/
│   ├── layout.tsx              # Root layout
│   ├── page.tsx                # Home/module selection
│   ├── globals.css             # Global styles
│   ├── module1/
│   │   └── page.tsx            # Module 1 page
│   ├── module2/
│   │   ├── layout.tsx          # Module 2 metadata
│   │   ├── page.tsx            # Stage selection landing
│   │   ├── [stage]/
│   │   │   └── page.tsx        # Stage runner for given [stage]
│   │   └── (shared)/
│   │       └── StageRunner.tsx # Stage runner component (~2000+ lines)
│   ├── module4/                # Module 3 (internal naming module4)
│   │   ├── layout.tsx          # Module 4 metadata
│   │   ├── page.tsx            # Stage selection landing
│   │   ├── [stage]/
│   │   │   └── page.tsx        # Stage runner for given [stage]
│   │   └── (shared)/
│   │       └── StageRunner.tsx # Stage runner component
├── components/
│   ├── BaymaxPanel.tsx         # Module 1 AI character panel (EXCLUDED)
│   ├── CNNBuddyPanel.tsx       # Module 3 AI character panel (EXCLUDED)
│   ├── DrawerNav.tsx           # Navigation drawer component
│   ├── InfoModal.tsx           # Block info modal (on-demand)
│   ├── MissionChecklist.tsx    # Module 1 progress tracker
│   ├── MissionChecklistM3.tsx  # Module 3 progress tracker
│   ├── MissionChecklistStage.tsx # Stage checklist component
│   ├── OutputPanel.tsx         # Result/visualization output display
│   ├── PixelwiseCharacter.tsx  # Character rendering
│   ├── SubmissionModal.tsx     # Stage completion confirmation
│   ├── TargetPanel.tsx         # Stage instructions/objectives display
│   ├── Toolbox.ts             # Module 1 block definitions
│   ├── toolboxModule2.ts      # Module 2 block definitions
│   ├── toolboxModule3.ts      # Module 3 split/bias block definitions
│   └── toolboxModule4.ts      # Module 3 model/training block definitions
├── data/
│   ├── datasets.json           # Dataset metadata index
│   ├── module2Stages.ts        # Module 2 stage configuration (4 stages)
│   ├── module4Stages.ts        # Module 3 stage configuration (3 stages)
│   └── (other stage configs)
├── lib/
│   └── blockly/
│       ├── index.ts            # Blockly block definitions (~500+ lines)
│       └── theme.ts            # Blockly LightTheme and DarkTheme
└── public/                      # Static assets
```

**Key Entry Points:**
- [apps/web/src/app/layout.tsx](apps/web/src/app/layout.tsx) - Root React layout
- [apps/web/src/app/page.tsx](apps/web/src/app/page.tsx) - Home page with module selection
- [apps/web/tsconfig.json](apps/web/tsconfig.json) - TypeScript configuration (ES2017 target, strict mode)

### 2. **Backend API Server**

**Purpose:** Workspace validation; dataset/image operations; model building/training; service orchestration

**Technology Stack:**
- Framework: FastAPI 0.135.0+
- Server: Uvicorn 0.18.0+ (ASGI)
- Language: Python 3.8+
- ML/DL: TensorFlow 2.15.0 (CPU variant)
- Image Processing: OpenCV 4.10.1 (headless), Pillow 10.0.0
- Data Validation: Pydantic 2.9.2
- Data Science: NumPy 2.1.3
- Optional: LangChain 0.2.17 (for conversation memory)

**Folder Structure:**
```
apps/api/
├── app/
│   ├── main.py                 # FastAPI app initialization
│   ├── core/
│   │   └── config.py           # Settings (datasets path, preview max size, etc.)
│   ├── models/
│   │   └── schemas.py          # Pydantic models (request/response types)
│   ├── routes/
│   │   ├── health.py           # GET /health
│   │   ├── datasets.py         # GET /datasets, /datasets/{key}/*
│   │   ├── preprocess.py       # POST /preprocess/apply, /preprocess/batch_export
│   │   ├── split.py            # POST /split/preview, /split/apply, /split/balance, /split/bias
│   │   ├── model.py            # POST /model/build, /model/save, /model/load
│   │   ├── train.py            # POST /train/start
│   │   ├── evaluate.py         # GET /evaluate/test
│   │   ├── predict.py          # POST /predict/sample
│   │   ├── analyzer.py         # POST /analyze, /analyze/module1/agent (CONTAINS AI LOGIC—EXCLUDED)
│   │   └── agent.py            # Utility functions (weather API, OpenRouter calls—EXCLUDED)
│   ├── services/
│   │   ├── datasets.py         # Dataset indexing, loading, metadata
│   │   ├── image_ops.py        # Image operations (resize, pad, normalize, grayscale, etc.)
│   │   ├── split_service.py    # Train/test split logic, bias detection
│   │   ├── model_service.py    # CNN model building, training, evaluation, prediction
│   │   └── model_viz/          # Model diagram generation (excluded—AI visualization)
│   ├── third_party/            # External integrations
│   │   ├── plotneuralnet_adapter.py
│   │   └── plotneuralnet/      # LaTeX-based neural network visualization (excluded)
│   ├── scripts/                # Utility scripts
│   └── data/
│       ├── datasets/           # Actual image datasets (organized by key)
│       ├── created_models/     # Saved Keras models (HDF5 format)
│       └── model_diagrams/     # Generated model visualizations
├── requirements.txt            # Python dependencies
├── pytest.ini                  # Test configuration
└── .env (not in repo)          # Environment variables (OPENROUTER_API_KEY, OPENROUTER_MODEL, etc.)
```

**Key Entry Points:**
- [apps/api/app/main.py](apps/api/app/main.py) - FastAPI application setup

### 3. **Data Storage Layer**

**Purpose:** Persistent storage of datasets, models, and metadata

**Storage Locations:**
- Datasets: `apps/api/data/datasets/{dataset_key}/`
  - Structure: `images/{class}/{image_file}`
  - Metadata: `index.csv` (columns: id, path, class, split) or `metadata.json`
- Models: `apps/api/data/created_models/`
  - Format: HDF5 (Keras native format)
  - Naming: `{dataset_key}/{model_name}.h5`
- Model Diagrams: `apps/api/data/model_diagrams/` (PNG)
- Session State: In-memory Python dictionaries (ephemeral)

**File Formats:**
- Dataset Images: JPEG (`.jpg`, `.jpeg`), PNG (`.png`)
- Models: HDF5 (`.h5`) via TensorFlow/Keras
- Metadata: CSV, JSON
- API Responses: JSON

### 4. **Validation & Processing Engine**

**Purpose:** Non-AI workspace validation; parameter checking; block order verification

**Key Components:**

**Workspace Analysis** ([apps/api/app/routes/analyzer.py](apps/api/app/routes/analyzer.py) - partial):
- Function: `_get_next_missing_key()` - identifies next required missing block
- Function: `_local_hint_from_checklist()` - generates local (non-AI) validation feedback
- Data: `REQUIRED_ORDER` list for Module 1 block sequence validation
- Checklist states: "ok", "wrong_place", "missing"

**Block Validation** ([apps/api/app/routes/preprocess.py](apps/api/app/routes/preprocess.py)):
- Request model: `ApplyRequest` - contains dataset_key, image path, ops list
- Validation: `load_dataset_image()` - checks file exists, valid path
- Validation: `apply_pipeline()` - executes ops sequentially

**Parameter Validation** ([apps/api/app/services/split_service.py](apps/api/app/services/split_service.py)):
- Function: `preview_split()` - validates train_pct in range [1, 99]
- Function: `apply_split()` - enforces train/test split consistency
- Validation: `check_bias_train()` - detects class imbalance with threshold

**Stage Completion Detection** (Frontend - [apps/web/src/app/module2/(shared)/StageRunner.tsx](apps/web/src/app/module2/(shared)/StageRunner.tsx)):
- Validation happens after submission
- Checks: required blocks present + correct order + parameters match expected values

### 5. **Output Generation & Rendering**

**Purpose:** Visual feedback for user actions (images, charts, text output)

**Output Types:**

**Image Outputs** ([apps/api/app/services/image_ops.py](apps/api/app/services/image_ops.py)):
- Function: `pil_to_data_url()` - converts PIL Image to base64 data URL
- Format: `data:image/jpeg;base64,...` or `data:image/png;base64,...`
- Quality: JPEG quality 90

**Dataset Visualizations** ([apps/api/app/routes/datasets.py](apps/api/app/routes/datasets.py)):
- Response model: `SampleResponse` - contains image_data_url
- Response model: `SplitChannelsResponse` - contains r_data_url, g_data_url, b_data_url
- Response model: `GrayResponse` - contains image_data_url for grayscale preview

**Output Panel Component** ([apps/web/src/components/OutputPanel.tsx](apps/web/src/components/OutputPanel.tsx)):
- Renders `LogItem[]` array
- Supports log kinds: "info", "preview", "warn", "error", "image", "card", "chart", "images"
- Image items: `{ kind: "image", src: string, caption?: string }`
- Card items: `{ kind: "card", title: string, lines: string[] }`
- Chart items: `{ kind: "chart", title: string, data: { label: string, percent: number }[] }`

---

## Frontend–Backend Communication

### Communication Protocol

**Mechanism:** HTTP/REST over JSON

**Transport:** HTTPS (production) / HTTP (development)

**CORS Configuration** ([apps/api/app/main.py](apps/api/app/main.py)):
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### HTTP Methods Used

| Method | Purpose | Example |
|--------|---------|---------|
| GET | Safe read operations | `/datasets`, `/datasets/{key}/info`, `/evaluate/test` |
| POST | State-changing operations | `/model/build`, `/train/start`, `/predict/sample` |

### Request/Response Format

**Base URL:** `process.env.NEXT_PUBLIC_API_URL` (frontend environment variable)

**Request Format:**
- Content-Type: `application/json`
- Body: JSON-serialized Pydantic model
- Example: [apps/api/app/routes/model.py](apps/api/app/routes/model.py) `BuildReq` model
  ```python
  class BuildReq(BaseModel):
      dataset_key: str
      spec: ModelSpecModel
      use_active_split: bool = True
  ```

**Response Format:**
- Content-Type: `application/json`
- Body: JSON-serialized Pydantic model
- HTTP Status: 200 OK, 400 Bad Request, 404 Not Found
- Error format: `{"detail": "error message"}`
- Example success: `{"ok": true, "signature": "...", "chains": [...], "checklist": [...]}`

**Timeouts (Frontend)**:
- Analyzer timeout: 12,000 ms (ANALYZER_REQUEST_TIMEOUT_MS)
- Chat timeout: 15,000 ms (CHAT_REQUEST_TIMEOUT_MS)
- Workspace debounce: 300 ms (WORKSPACE_CHANGE_DEBOUNCE_MS)

### Relevant Files Implementing Communication

**Frontend API Calls:**
- [apps/web/src/app/module1/page.tsx](apps/web/src/app/module1/page.tsx) - Dataset loading, sample fetching, preprocessing
- [apps/web/src/app/module2/(shared)/StageRunner.tsx](apps/web/src/app/module2/(shared)/StageRunner.tsx) - Stage submission, workspace validation
- [apps/web/src/app/module4/(shared)/StageRunner.tsx](apps/web/src/app/module4/(shared)/StageRunner.tsx) - Model building, training
- Helper function: `fetchJSON<T>()` pattern for typed HTTP requests

**Backend Request Handling:**
- [apps/api/app/routes/](apps/api/app/routes/) - 9 router modules
- Each router includes Pydantic request/response models

---

## General Data Flow

### Flow 1: User Adds Block to Workspace (Continuous)

1. **User Action:** Drags block from Blockly toolbox into workspace canvas
2. **Blockly Event:** `workspace_change` event fires
3. **Frontend Captures Workspace:**
   - Extract all top-level blocks: [apps/web/src/app/module1/page.tsx](apps/web/src/app/module1/page.tsx) function `getTopChains(ws)`
   - Convert to chain model: function `blockToModel(b)` extracts `{type, fields}`
   - Build payload: function `workspaceToAnalyzePayload(ws)` → `AnalyzeRequest`
4. **Frontend Debounces:** 300 ms wait for more workspace changes
5. **Frontend Sends Request:** POST to `/analyze` with workspace state
6. **Backend Processes:**
   - [apps/api/app/routes/analyzer.py](apps/api/app/routes/analyzer.py) function `analyze_workspace(req: AnalyzeRequest)` 
   - Builds checklist: iterate REQUIRED_ORDER, check block presence and order
   - Generates planned actions: map blocks to backend operations
   - Returns: `AnalyzeResponse` with signature, checklist, planned_actions
7. **Frontend Renders Feedback:**
   - Updates checklist display
   - (AI feedback excluded from this flow)
8. **Backend Executes Planned Actions (on demand):**
   - Example: Block = "dataset.info" → calls `GET /datasets/{key}/info`
   - Response returned to frontend
   - Frontend renders in OutputPanel

### Flow 2: User Submits Stage

1. **User Action:** Clicks "Submit" button in stage interface
2. **Frontend Collects Workspace:**
   - Get current blocks via `getTopChains(ws)`
   - Serialize to JSON
   - Extract block types and parameters
3. **Frontend Sends Validation Request:**
   - Payload includes: blocks list with types and field values
   - Includes stage_id for stage-specific validation
4. **Backend Validates (Stage-Specific Logic):**
   - Check required blocks present: stage config `requiredBlocks`
   - Check block order: stage config `expectedOrder`
   - Check parameters: stage-specific validation rules
   - Returns: success/failure with reason
5. **Frontend Shows Result:**
   - Success: Display SubmissionModal with celebration
   - Failure: Show error message, allow retry
6. **Frontend Stores Progress:**
   - Updates local state
   - Marks stage complete (ephemeral, session-scoped)
7. **Frontend Enables Next Stage:** Navigate to next stage or show completion

### Flow 3: Preprocessing Operations (Module 2)

1. **User constructs preprocessing pipeline** in Blockly workspace (e.g., grayscale → brightness/contrast → blur/sharpen)
2. **User clicks "Run" or submits**
3. **Frontend extracts blocks:** getTopChains() + blockToModel()
4. **Frontend converts to operation specs:**
   - Blockly block type "m2.to_grayscale" → Op spec `{type: "to_grayscale"}`
   - Each block's fields → op parameters
5. **Frontend sends POST /preprocess/apply:**
   ```json
   {
     "dataset_key": "recyclables-mini",
     "path": "images/plastic/Image_9.jpg",
     "ops": [
       {"type": "to_grayscale"},
       {"type": "brightness_contrast", "b": 10, "c": 10},
       {"type": "blur_sharpen", "blur": 0, "sharp": 1}
     ]
   }
   ```
6. **Backend processes ([apps/api/app/routes/preprocess.py](apps/api/app/routes/preprocess.py)):**
   - `preprocess_apply(req: ApplyRequest)` handler
   - Load image: [apps/api/app/services/image_ops.py](apps/api/app/services/image_ops.py) `load_dataset_image()`
   - Apply pipeline: `apply_pipeline(before_img, req.ops)` → iterates ops, applies each transformation
   - Each op calls corresponding function: `op_to_grayscale()`, `op_resize()`, `op_pad()`, `op_normalize()`, etc.
   - Returns: before/after images as base64 data URLs + output shape
7. **Frontend receives response:**
   ```json
   {
     "before_data_url": "data:image/jpeg;base64,...",
     "after_data_url": "data:image/png;base64,...",
     "after_shape": [150, 150, 3]
   }
   ```
8. **Frontend renders:** OutputPanel displays before/after images

### Flow 4: Model Building (Module 3 Stage 1)

1. **User constructs model block chain:** dataset.select → set_split_ratio → apply_split → model_init → layer_conv2d → layer_pool → layer_dense → model_summary
2. **User clicks "Submit"**
3. **Frontend extracts:** chains of blocks with their parameters
4. **Frontend sends POST /model/build:**
   ```json
   {
     "dataset_key": "recyclables-mini",
     "spec": {
       "name": "my-model",
       "layers": [
         {"type": "conv2d", "params": {"filters": 32, "kernel": 3}},
         {"type": "pool", "params": {"kind": "max", "size": 2}},
         {"type": "dense", "params": {"units": 128}}
       ]
     }
   }
   ```
5. **Backend processes ([apps/api/app/routes/model.py](apps/api/app/routes/model.py) + [apps/api/app/services/model_service.py](apps/api/app/services/model_service.py)):**
   - `model_build(body: BuildReq)` → calls `build_model_for_dataset()`
   - Infer input shape: `_infer_input_shape()` → fixed 150×150×3 (from Module 2 preprocessing standard)
   - Build Keras Sequential model:
     ```python
     model = keras.Sequential(name=spec.name)
     model.add(layers.Input(shape=(150, 150, 3)))
     for layer_spec in spec.layers:
         if layer_spec.type == "conv2d":
             model.add(layers.Conv2D(...))
         elif layer_spec.type == "pool":
             model.add(layers.MaxPooling2D(...) or layers.AvgPool2D(...))
         elif layer_spec.type == "dense":
             model.add(layers.Dense(...))
     ```
   - Auto-insert Flatten before first dense layer if needed
   - Store model in memory: `_ACTIVE_MODELS[dataset_key]`
   - Generate model summary: `_capture_model_summary(model)` → list of string lines
   - Return: `{ok: true, model_summary: [...], params: {...}}`
6. **Frontend receives:** Model summary and status
7. **Frontend displays:** Model structure in OutputPanel

### Flow 5: Training (Module 3 Stage 2)

1. **User constructs full pipeline:** [includes model_init + layers + train_hparams + train_start + eval_test + predict_sample]
2. **User clicks "Submit"**
3. **Frontend sends POST /train/start:**
   ```json
   {
     "dataset_key": "recyclables-mini",
     "epochs": 5,
     "batch": 32
   }
   ```
4. **Backend processes ([apps/api/app/routes/train.py](apps/api/app/routes/train.py)):**
   - `train_start(body: TrainReq)` → calls `train_active_model()`
   - Retrieve active model: `_ACTIVE_MODELS[dataset_key]`
   - Get split indices: [apps/api/app/services/split_service.py](apps/api/app/services/split_service.py) `get_active_split_indices()`
   - Prepare training data:
     - Load all training images
     - Apply preprocessing (150×150, normalized)
     - Create numpy arrays
   - Compile model: `model.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])`
   - Train: `model.fit(train_x, train_y, epochs=5, batch_size=32, validation_split=0.1)`
   - Return: `{ok: true, epochs: 5, final_loss: X, final_accuracy: Y}`
5. **Frontend receives:** Training results
6. **Frontend displays:** Training metrics in OutputPanel

---

## External Integrations (Non-AI)

### 1. **TensorFlow/Keras Integration**

**Service Name:** TensorFlow (tensorflow-cpu)

**Purpose:** Neural network model building, training, evaluation

**Location:** [apps/api/app/services/model_service.py](apps/api/app/services/model_service.py)

**Key Functions:**
- `build_model_for_dataset(dataset_key, spec_dict)` - Creates Keras Sequential model
- `train_active_model(dataset_key, epochs, batch_size)` - Trains model on dataset
- `evaluate_active_model_on_test()` - Evaluates on test split
- `predict_on_sample(dataset_key, path)` - Single-image prediction

**Usage Pattern:**
```python
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers

model = keras.Sequential(name="my-model")
model.add(layers.Input(shape=(150, 150, 3)))
model.add(layers.Conv2D(32, kernel_size=3, activation='relu'))
model.add(layers.MaxPooling2D(pool_size=2))
model.add(layers.Flatten())
model.add(layers.Dense(128, activation='relu'))
model.add(layers.Dense(num_classes, activation='softmax'))
model.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])
```

### 2. **OpenCV Integration**

**Service Name:** OpenCV (opencv-python-headless)

**Purpose:** Image processing (resize, blur, sharpen, grayscale, edge detection, etc.)

**Location:** [apps/api/app/services/image_ops.py](apps/api/app/services/image_ops.py)

**Key Operations:**
- `cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)` - Convert to grayscale
- `cv2.resize(image, (w, h))` - Resize image
- `cv2.copyMakeBorder()` - Pad image
- `cv2.GaussianBlur()` - Blur
- `cv2.filter2D()` / `cv2.Laplacian()` - Sharpen/edge detection
- `cv2.cvtColor(image, cv2.COLOR_RGB2BGR)` - RGB ↔ BGR conversion

**Helper Functions:**
- `_pil_to_cv_bgr(img: Image.Image) -> np.ndarray` - PIL → OpenCV format
- `_cv_bgr_to_pil(cv_img: np.ndarray) -> Image.Image` - OpenCV → PIL format

### 3. **Pillow (PIL) Integration**

**Service Name:** Pillow (Pillow>=10.0.0)

**Purpose:** Image loading, format conversion, data URL encoding

**Location:** [apps/api/app/services/image_ops.py](apps/api/app/services/image_ops.py)

**Key Functions:**
- `Image.open(path)` - Load image file
- `img.convert("RGB")` - Mode conversion
- `img.save(buffer, format="JPEG", quality=90)` - Save to buffer
- `base64.b64encode()` - Encode buffer to base64 data URL

### 4. **NumPy Integration**

**Service Name:** NumPy (numpy>=2.1.3)

**Purpose:** Numerical array operations for image data

**Location:** [apps/api/app/services/image_ops.py](apps/api/app/services/image_ops.py)

**Usage:**
- Image pixel array manipulation
- Normalization calculations
- Train/test data array creation

### 5. **Blockly Integration**

**Service Name:** Blockly (blockly@12.3.1)

**Purpose:** Visual block-based programming interface

**Location:** [apps/web/src/lib/blockly/index.ts](apps/web/src/lib/blockly/index.ts)

**Plugins Used:**
- `@blockly/plugin-workspace-search@^10.1.2` - Search functionality
- `@blockly/zoom-to-fit@^7.0.3` - Zoom to fit view

**Plugins:**
```typescript
import * as BlocklyNS from "blockly/core";
import * as BlocklyPython from "blockly/python";

export const Blockly = BlocklyNS;
export const pythonGenerator = BlocklyPython.pythonGenerator;
```

**Workspace Configuration:** See [apps/web/src/lib/blockly/index.ts](apps/web/src/lib/blockly/index.ts)

### 6. **Framer Motion Integration**

**Service Name:** Framer Motion (framer-motion@^12.23.24)

**Purpose:** Animations and transitions

**Locations:**
- [apps/web/src/app/page.tsx](apps/web/src/app/page.tsx) - Module selection card animations
- [apps/web/src/app/module2/page.tsx](apps/web/src/app/module2/page.tsx) - Stage card animations
- `whileHover={{ y: -8 }}` - Lift on hover
- `whileTap={{ scale: 0.98 }}` - Scale on tap

### 7. **Lucide React Integration**

**Service Name:** Lucide React (lucide-react@^0.553.0)

**Purpose:** Icon rendering

**Locations:**
- [apps/web/src/app/page.tsx](apps/web/src/app/page.tsx) - Module icons (BookOpen, Layers, Brain, ChevronRight)
- [apps/web/src/components/](apps/web/src/components/) - Various icon uses

### 8. **Pydantic Integration**

**Service Name:** Pydantic (pydantic>=2.9.2)

**Purpose:** Data validation and serialization for all API requests/responses

**Location:** [apps/api/app/models/schemas.py](apps/api/app/models/schemas.py)

**Request Models (Sample):**
```python
class ApplyRequest(BaseModel):
    dataset_key: str
    path: str
    ops: List[Dict[str, Any]] = Field(default_factory=list)

class TrainReq(BaseModel):
    dataset_key: str
    epochs: int = Field(5, ge=1, le=50)
    batch: int = Field(32, ge=1, le=512)
```

**Response Models:**
```python
class ApplyResponse(BaseModel):
    dataset_key: str
    path: str
    before_data_url: str
    after_data_url: str
    after_shape: tuple
```

### 9. **Python-Multipart Integration**

**Service Name:** python-multipart (python-multipart>=0.0.9)

**Purpose:** Form data handling (if file uploads implemented)

**Status:** Included in requirements but may not be actively used in current code

### 10. **Environment Variables (python-dotenv)**

**Service Name:** python-dotenv

**Purpose:** Load .env file for environment configuration

**Location:** [apps/api/app/routes/analyzer.py](apps/api/app/routes/analyzer.py)

**Variables Supported:**
- `OPENROUTER_API_KEY` - For LLM integration (EXCLUDED from documentation)
- `OPENROUTER_MODEL` - Model selection (EXCLUDED)
- `NEXT_PUBLIC_API_URL` - Frontend API endpoint
- Custom settings via Pydantic Settings

---

## Architecture Diagram Information

### Components to Include

1. **Frontend (Web Browser)**
   - Blockly Workspace
   - Component Hierarchy
   - State Management (React hooks)
   - HTTP Client

2. **Backend (FastAPI Server)**
   - 9 Router Modules
   - Service Layer (3 services)
   - TensorFlow/Keras Integration
   - File System Access

3. **Data Storage**
   - Dataset Directory Tree
   - Model Storage (HDF5)
   - Session State (In-Memory)

4. **External Libraries**
   - TensorFlow/Keras
   - OpenCV
   - Blockly
   - Pydantic

### Connections and Data Flow

```
USER
  ↓
[Browser]
  ├─ Blockly Workspace (visual programming)
  ├─ React Components (UI rendering)
  └─ Fetch HTTP Client
      ↓
      ↓ JSON over HTTP/REST
      ↓
[FastAPI Server]
  ├─ CORS Middleware
  ├─ Router: health
  ├─ Router: datasets
  ├─ Router: preprocess → ImageOps Service
  ├─ Router: split → SplitService
  ├─ Router: model → ModelService → TensorFlow
  ├─ Router: train → ModelService → TensorFlow
  ├─ Router: evaluate → ModelService → TensorFlow
  ├─ Router: predict → ModelService → TensorFlow
  └─ Router: analyzer (AI-specific—EXCLUDED)
      ↓
      ↓ File I/O / Database Access
      ↓
[Data Storage]
  ├─ /data/datasets/{dataset_key}/
  │   ├─ images/{class}/{image}
  │   ├─ index.csv (or metadata.json)
  │   └─ split cache
  ├─ /data/created_models/{dataset_key}/{model_name}.h5
  └─ In-Memory State
      ├─ _ACTIVE_MODELS[dataset_key]
      ├─ _ACTIVE_SPECS[dataset_key]
      ├─ _ACTIVE_SPLITS[dataset_key]
      └─ Chat/History Caches
```

### Data Flow Arrows

- **User Input → Frontend:** Blockly drag-drop, clicks
- **Frontend → Backend:** POST/GET HTTP requests (JSON)
- **Backend → Frontend:** JSON responses
- **Frontend → User:** Rendered UI components, visualizations
- **Backend → File System:** Read datasets, write models, read/write metadata
- **Backend → TensorFlow:** Model construction, training, evaluation
- **Backend → OpenCV:** Image processing operations
- **TensorFlow → File System:** Save/load models

---

# TECHNOLOGY STACK

## Frontend Stack

| Component | Package | Version | Purpose |
|-----------|---------|---------|---------|
| Framework | Next.js | 15.5.14 | React meta-framework with file-based routing |
| Runtime | React | 19.1.0 | UI component framework |
| Language | TypeScript | 5 | Type-safe JavaScript variant |
| CSS Framework | Tailwind CSS | 4 | Utility-first CSS |
| CSS Processing | @tailwindcss/postcss | 4 | PostCSS integration for Tailwind |
| PostCSS | (built-in) | - | CSS transformation |
| Bundler | Turbopack | (in Next.js 15) | Fast JavaScript bundler |
| Animation | Framer Motion | 12.23.24 | React animation library |
| Icons | Lucide React | 0.553.0 | Icon component library |
| Visual Programming | Blockly | 12.3.1 | Visual block-based programming editor |
| Blockly: Workspace Search | @blockly/plugin-workspace-search | 10.1.2 | Search blocks in workspace |
| Blockly: Zoom-to-Fit | @blockly/zoom-to-fit | 7.0.3 | Auto-zoom to fit workspace |

**Configuration Files:**
- [apps/web/tsconfig.json](apps/web/tsconfig.json) - TypeScript configuration (ES2017 target, strict mode)
- [apps/web/next.config.ts](apps/web/next.config.ts) - Next.js configuration
- [apps/web/eslint.config.mjs](apps/web/eslint.config.mjs) - ESLint configuration (ignored during build)
- [apps/web/postcss.config.mjs](apps/web/postcss.config.mjs) - PostCSS configuration

---

## Backend Stack

| Component | Package | Version | Purpose |
|-----------|---------|---------|---------|
| Framework | FastAPI | >=0.135.0 | Python async web framework |
| Server | Uvicorn | >=0.18.0 | ASGI server for FastAPI |
| Runtime | Python | 3.8+ | Programming language |
| ML Framework | TensorFlow | >=2.15.0 (CPU) | Deep learning library |
| Image Processing | OpenCV | >=4.10.1.26 (headless) | Computer vision library |
| Image Format | Pillow | >=10.0.0 | Python Imaging Library |
| Data Validation | Pydantic | >=2.9.2 | Data validation and serialization |
| Settings | Pydantic Settings | >=2.6.1 | Configuration management |
| Numerical Computing | NumPy | >=2.1.3 | Numerical Python library |
| HTTP Client | Requests | >=2.28.0 | HTTP library for Python |
| Form Data | python-multipart | >=0.0.9 | Form/file upload handling |
| Optional: Conversation Memory | LangChain | >=0.2.17 | Conversation management (optional dependency) |
| Environment Variables | python-dotenv | (implicit) | Load .env files |

**Configuration Files:**
- [apps/api/requirements.txt](apps/api/requirements.txt) - Python dependencies
- [apps/api/pytest.ini](apps/api/pytest.ini) - Test configuration
- [apps/api/app/core/config.py](apps/api/app/core/config.py) - Application settings

---

## Other Dependencies

| Category | Package | Version | Purpose | Location |
|----------|---------|---------|---------|----------|
| **Frontend Build** | @types/react | ^19 | TypeScript types for React | Dev dependency |
| | @types/react-dom | ^19 | TypeScript types for ReactDOM | Dev dependency |
| | @types/node | ^20 | TypeScript types for Node.js | Dev dependency |
| | @eslint/eslintrc | ^3 | ESLint config | Dev dependency |
| | eslint | ^9 | JavaScript linter | Dev dependency |
| | eslint-config-next | 15.5.4 | ESLint config for Next.js | Dev dependency |
| **Monorepo** | (Workspaces) | - | Yarn/npm workspaces for monorepo | [package.json](package.json) defines workspace paths |
| **Shared** | packages/shared | - | Shared code between apps | Located in [packages/shared/](packages/shared/) |

---

# 3.2.2 FRONTEND

## Frontend Overview

**Framework:** Next.js 15.5.14 with React 19.1.0 and TypeScript 5

**Entry Point Files:**
- [apps/web/next.config.ts](apps/web/next.config.ts) - Next.js configuration
- [apps/web/src/app/layout.tsx](apps/web/src/app/layout.tsx) - Root React layout component
- [apps/web/src/app/page.tsx](apps/web/src/app/page.tsx) - Home page with module selection
- [apps/web/tsconfig.json](apps/web/tsconfig.json) - TypeScript compiler options

**Application Structure:**
- **Type:** Single Page Application (SPA) with server-side rendering (Next.js App Router)
- **Routing:** File-based routing using Next.js App Router
- **State Management:** React hooks (useState, useRef, useEffect, useMemo, useCallback)
- **Styling:** Tailwind CSS 4 with utility classes
- **Component Library:** Custom React components (no external UI library)

---

## Folder Structure

```
apps/web/src/
├── app/
│   ├── layout.tsx
│   │   └─ Root layout; imports fonts (Geist, Geist_Mono)
│   │   └─ Global styles: globals.css
│   │   └─ Sets metadata
│   ├── page.tsx
│   │   └─ Home page (/); module card grid with Framer Motion animations
│   │   └─ Navigation bar with links to modules
│   │   └─ Hero section with gradient text
│   ├── globals.css
│   │   └─ Global Tailwind styles and custom utility classes
│   │
│   ├── module1/
│   │   └── page.tsx
│   │       └─ Module 1 entry page; displays mission
│   │       └─ Includes Blockly workspace initialization
│   │       └─ Fetches datasets from API
│   │       └─ Handles workspace changes and submissions
│   │
│   ├── module2/
│   │   ├── layout.tsx
│   │       └─ Metadata: "Module 2 · Image preprocessing missions"
│   │   ├── page.tsx
│   │       └─ Stage selection landing page (/module2)
│   │       └─ Maps module2Stages.ts into stage cards
│   │       └─ Each card links to /module2/{stage}
│   │   ├── [stage]/
│   │   │   └── page.tsx
│   │   │       └─ Dynamic route for /module2/{stage}
│   │   │       └─ Renders StageRunner component with stage-specific config
│   │   └── (shared)/
│   │       └── StageRunner.tsx (~2000+ lines)
│   │           └─ Main stage execution component
│   │           └─ Blockly workspace management
│   │           └─ Stage validation logic (non-AI)
│   │           └─ Workspace capture and serialization
│   │           └─ Output panel rendering
│   │           └─ Stage checklist display
│   │
│   ├── module4/
│   │   ├── layout.tsx
│   │       └─ Metadata: "Module 3 · Building, training, and evaluating models"
│   │   │       └─ (NOTE: Internal route is /module4, user-facing is Module 3)
│   │   ├── page.tsx
│   │       └─ Stage selection landing page (/module4)
│   │       └─ Maps module4Stages.ts into stage cards
│   │       └─ Each card links to /module4/{stage}
│   │   ├── [stage]/
│   │   │   └── page.tsx
│   │   │       └─ Dynamic route for /module4/{stage}
│   │   │       └─ Renders StageRunner component with stage-specific config
│   │   └── (shared)/
│   │       └── StageRunner.tsx (~2000+ lines)
│   │           └─ Main stage execution component for Module 3
│   │           └─ Model building, training, evaluation workflow
│   │           └─ Stage-specific validation logic
│   │
│   └── module1/
│       └── page.tsx
│           └─ Single continuous mission (no stages)
│
├── components/
│   ├── BaymaxPanel.tsx (AI-specific—EXCLUDED)
│   ├── CNNBuddyPanel.tsx (AI-specific—EXCLUDED)
│   ├── DrawerNav.tsx
│   │   └─ Side navigation drawer component
│   ├── InfoModal.tsx
│   │   └─ Modal displaying block information
│   │   └─ Triggered by clicking info icon on blocks
│   │   └─ Shows block description and usage
│   ├── MissionChecklist.tsx
│   │   └─ Module 1 progress tracker
│   │   └─ Displays checklist of blocks to use
│   ├── MissionChecklistM3.tsx
│   │   └─ Module 3 progress tracker
│   ├── MissionChecklistStage.tsx
│   │   └─ Generic stage checklist component
│   │   └─ Reusable for all modules
│   │   └─ Props: checklist items, completion state
│   ├── OutputPanel.tsx
│   │   └─ Displays results from Blockly execution
│   │   └─ Renders images, charts, text, cards
│   │   └─ Auto-scrolls to latest output
│   │   └─ Clear button to reset
│   ├── PixelwiseCharacter.tsx
│   │   └─ Character rendering component
│   ├── SubmissionModal.tsx
│   │   └─ Stage completion confirmation modal
│   │   └─ Shows success message and next button
│   ├── TargetPanel.tsx
│   │   └─ Right sidebar displaying stage instructions
│   │   └─ Shows current objectives and help text
│   ├── Toolbox.ts
│   │   └─ Module 1 block definitions (JSON structure)
│   ├── toolboxModule2.ts
│   │   └─ Module 2 block toolbox (preprocessing blocks)
│   ├── toolboxModule3.ts
│   │   └─ Module 3 split/bias block toolbox
│   ├── toolboxModule4.ts
│   │   └─ Module 3 model/training block toolbox (used with module4Stages)
│   └── (other components)
│
├── data/
│   ├── datasets.json
│   │   └─ Dataset metadata index
│   ├── module2Stages.ts
│   │   └─ Stage configuration for Module 2 (4 stages)
│   │   └─ Type: StageConfig[] for pipeline stages
│   ├── module4Stages.ts
│   │   └─ Stage configuration for Module 3 (3 stages)
│   │   └─ Type: StageConfig[] for model/training stages
│   └── (other data files)
│
├── lib/
│   └── blockly/
│       ├── index.ts
│       │   └─ Blockly block definitions (~500+ lines)
│       │   └─ Block registry: Blockly.Blocks["type_name"] = { init: ... }
│       │   └─ Python generator: pythonGenerator.forBlock["type_name"] = function() { ... }
│       │   └─ Helper functions: appendInfo(), setStatement(), etc.
│       │   └─ Exports: Blockly, pythonGenerator, setDatasetOptions()
│       └── theme.ts
│           └─ Blockly themes (LightTheme, DarkTheme)
│           └─ Theme colors: workspaceBackgroundColour, toolboxColour, etc.
│
└── public/
    └─ Static assets (if any)
```

**Responsibility of Each Major Folder:**

- **`app/`** - Next.js App Router pages and layouts; defines routing structure
- **`components/`** - Reusable React components (panels, modals, UI elements)
- **`data/`** - Static configuration data (stage definitions, datasets metadata)
- **`lib/`** - Utilities and libraries (Blockly setup, themes)
- **`public/`** - Static assets (images, fonts, etc.)

---

## Component Structure

**Major Components (High-Level Overview):**

| Component | File Path | Purpose | Props/Inputs | Parent |
|-----------|-----------|---------|--------------|--------|
| HomePage | [apps/web/src/app/page.tsx](apps/web/src/app/page.tsx) | Module selection landing | None | (root) |
| Module1Page | [apps/web/src/app/module1/page.tsx](apps/web/src/app/module1/page.tsx) | Module 1 workspace | None | (root) |
| Module2Index | [apps/web/src/app/module2/page.tsx](apps/web/src/app/module2/page.tsx) | Stage selection for Module 2 | None | (root) |
| Module2Stage | [apps/web/src/app/module2/[stage]/page.tsx](apps/web/src/app/module2/%5Bstage%5D/page.tsx) | Render stage runner | params.stage | (root) |
| StageRunner | [apps/web/src/app/module2/(shared)/StageRunner.tsx](apps/web/src/app/module2/(shared)/StageRunner.tsx) | Stage execution (Module 2) | stageConfig | Module2Stage |
| Module4Index | [apps/web/src/app/module4/page.tsx](apps/web/src/app/module4/page.tsx) | Stage selection for Module 3 | None | (root) |
| Module4Stage | [apps/web/src/app/module4/[stage]/page.tsx](apps/web/src/app/module4/%5Bstage%5D/page.tsx) | Render stage runner | params.stage | (root) |
| StageRunner | [apps/web/src/app/module4/(shared)/StageRunner.tsx](apps/web/src/app/module4/(shared)/StageRunner.tsx) | Stage execution (Module 3) | stageConfig | Module4Stage |
| OutputPanel | [apps/web/src/components/OutputPanel.tsx](apps/web/src/components/OutputPanel.tsx) | Display results | logs: LogItem[], onClear | StageRunner |
| TargetPanel | [apps/web/src/components/TargetPanel.tsx](apps/web/src/components/TargetPanel.tsx) | Stage instructions | stageConfig | StageRunner |
| MissionChecklistStage | [apps/web/src/components/MissionChecklistStage.tsx](apps/web/src/components/MissionChecklistStage.tsx) | Checklist display | checklist: ChecklistItem[] | StageRunner |
| InfoModal | [apps/web/src/components/InfoModal.tsx](apps/web/src/components/InfoModal.tsx) | Block info popup | title, text | StageRunner |
| SubmissionModal | [apps/web/src/components/SubmissionModal.tsx](apps/web/src/components/SubmissionModal.tsx) | Stage complete | onNext | StageRunner |

**Component Tree (Hierarchy):**

```
<RootLayout>
  ├─ <HomePage>
  │   └─ Module selection cards
  │
  ├─ <Module1Page>
  │   └─ Blockly workspace + OutputPanel + TargetPanel
  │
  ├─ <Module2Layout>
  │   ├─ <Module2Index>
  │   │   └─ Stage card grid
  │   └─ <Module2Stage [stage]>
  │       └─ <StageRunner>
  │           ├─ Blockly workspace
  │           ├─ <OutputPanel>
  │           ├─ <TargetPanel>
  │           ├─ <MissionChecklistStage>
  │           ├─ <InfoModal> (conditional)
  │           └─ <SubmissionModal> (conditional)
  │
  ├─ <Module4Layout>
  │   ├─ <Module4Index>
  │   │   └─ Stage card grid
  │   └─ <Module4Stage [stage]>
  │       └─ <StageRunner>
  │           ├─ Blockly workspace
  │           ├─ <OutputPanel>
  │           ├─ <TargetPanel>
  │           ├─ <MissionChecklistStage>
  │           ├─ <InfoModal> (conditional)
  │           └─ <SubmissionModal> (conditional)
```

---

## Routing

**Routing Library:** Next.js App Router (file-based)

**Route Definitions:**

| Route | File | Component | Purpose |
|-------|------|-----------|---------|
| `/` | [app/page.tsx](apps/web/src/app/page.tsx) | HomePage | Home/module selection |
| `/module1` | [app/module1/page.tsx](apps/web/src/app/module1/page.tsx) | Module1Page | Module 1 workspace |
| `/module2` | [app/module2/page.tsx](apps/web/src/app/module2/page.tsx) | Module2Index | Module 2 stage selection |
| `/module2/[stage]` | [app/module2/[stage]/page.tsx](apps/web/src/app/module2/%5Bstage%5D/page.tsx) | Module2Stage | Module 2 stage runner |
| `/module4` | [app/module4/page.tsx](apps/web/src/app/module4/page.tsx) | Module4Index | Module 3 stage selection |
| `/module4/[stage]` | [app/module4/[stage]/page.tsx](apps/web/src/app/module4/%5Bstage%5D/page.tsx) | Module4Stage | Module 3 stage runner |

**Route Groups:**
- `(shared)` folder in module2 and module4 - Shared components not exposed as routes

**Protected Routes:** None (all routes publicly accessible; no authentication)

**URL Parameters:**
- `/module2/[stage]` - stage number (1, 2, 3, 4 for Module 2)
- `/module4/[stage]` - stage number (1, 2, 3 for Module 3)

---

## Blockly Integration

### Blockly Initialization

**Main Initialization File:** [apps/web/src/lib/blockly/index.ts](apps/web/src/lib/blockly/index.ts)

**Initialization Steps (from StageRunner usage):**

1. **Import Blockly:**
   ```typescript
   import { Blockly, setDatasetOptions } from "@/lib/blockly";
   import { DarkTheme, LightTheme } from "@/lib/blockly/theme";
   ```

2. **Create Workspace:**
   ```typescript
   const workspace = Blockly.inject('blockly-container', {
       toolbox: toolboxJson,
       theme: DarkTheme,
       grid: { spacing: 20, length: 3, colour: '#ccc', snap: true },
       zoom: { controls: true, wheel: true, startScale: 1.0, maxScale: 3, minScale: 0.3 },
       trashcan: true,
       comments: true,
       disable: true,
       sounds: false,
       css: false,
       rtl: false,
   });
   ```

3. **Set Dataset Options:**
   ```typescript
   setDatasetOptions(datasets.map(d => ({ name: d.name, key: d.key })));
   ```

4. **Register Event Listeners:**
   ```typescript
   workspace.addChangeListener(onWorkspaceChange);
   ```

5. **Load Saved Workspace (optional):**
   ```typescript
   const xml = Blockly.Xml.textToDom(savedWorkspaceXml);
   Blockly.Xml.domToWorkspace(xml, workspace);
   ```

**Key Functions Exported from index.ts:**
- `Blockly` - Blockly namespace (core)
- `pythonGenerator` - Python code generator
- `setDatasetOptions(pairs)` - Set available datasets in dropdown
- Block definitions via `Blockly.Blocks["type_name"]` registry

### Blockly Configuration

**Workspace Options** (from StageRunner):
- **Toolbox:** Module-specific JSON toolbox (Datasets, Preprocessing, Model, Training, etc.)
- **Theme:** LightTheme or DarkTheme
- **Grid:** 20px spacing, snapping enabled
- **Zoom:** Enabled (wheel + controls)
- **Trashcan:** Enabled (delete blocks)
- **Comments:** Enabled (block comments)
- **Disabled by default** (flag for disabling)

**Themes Defined** ([apps/web/src/lib/blockly/theme.ts](apps/web/src/lib/blockly/theme.ts)):

**LightTheme ("visionblocks-light"):**
- Workspace background: #E3E8F4 (soft grey-blue)
- Toolbox background: #D7DEEF (darker)
- Scroll bar color: #CBD5F5 (indigo-grey)
- Insertion marker: #38BDF8 (sky-400)

**DarkTheme ("visionblocks-dark"):**
- Workspace background: #020617 (slate-950)
- Toolbox background: #020617
- Scroll bar: #4B5563
- Insertion marker: #38BDF8

### Block Definitions

**Block Definition Files:**

1. **Module 1 Blocks** ([apps/web/src/lib/blockly/index.ts](apps/web/src/lib/blockly/index.ts), lines 1-~300):
   - Category: Datasets (Color: #0ea5e9 - blue)
     - `dataset.select` - Dropdown to choose dataset
     - `dataset.info` - Get dataset info
     - `dataset.class_counts` - Get class counts
     - `dataset.class_distribution_preview` - Get class distribution
     - `dataset.sample_image` - Random or indexed sample
   - Category: Images (Color: #22c55e - green)
     - `image.channels_split` - Split RGB channels
     - `image.to_grayscale_preview` - Grayscale preview
     - `image.show` - Display image with title
     - `image.shape` - Get image dimensions

2. **Module 2 Blocks** ([apps/web/src/lib/blockly/index.ts](apps/web/src/lib/blockly/index.ts), continuation):
   - Category: Preprocessing (Color: #a78bfa - violet)
     - `m2.to_grayscale` - Convert to grayscale
     - `m2.brightness_contrast` - Adjust brightness/contrast (fields: B, C)
     - `m2.blur_sharpen` - Blur or sharpen (fields: BLUR, SHARP)
     - `m2.resize` - Resize image (fields: MODE, W, H, KEEP)
     - `m2.pad` - Pad image (fields: W, H, MODE, R, G, B)
     - `m2.normalize` - Normalize pixels (field: MODE)
     - `m2.edges` - Edge detection (fields: METHOD, THRESHOLD, OVERLAY)
     - `m2.loop_dataset` - Loop over dataset
     - `m2.export_dataset` - Export processed dataset

3. **Module 3 Blocks** (in [apps/web/src/lib/blockly/index.ts](apps/web/src/lib/blockly/index.ts)):
   - Category: Splitting & Bias (Color: #f472b6 - pink)
     - `m3.set_split_ratio` - Set train/test ratio (field: RATIO)
     - `m3.apply_split` - Apply split
     - `m3.check_bias_train` - Check training data bias
     - `m3.balance_train` - Balance training data
   - Category: Model (Color: #8b5cf6 - purple)
     - `m4.model_init` - Initialize model
     - `m4.layer_conv2d` - Conv layer (fields: FILTERS, KERNEL, STRIDE, PADDING)
     - `m4.layer_pool` - Pooling layer (fields: KIND, SIZE)
     - `m4.layer_dense` - Dense layer (field: UNITS)
     - `m4.model_summary` - Model summary
   - Category: Training (Color: #06b6d4 - cyan)
     - `m4.train_hparams` - Training hyperparameters (fields: EPOCHS, BATCH)
     - `m4.train_start` - Start training
   - Category: Evaluation (Color: #f59e0b - amber)
     - `m4.eval_test` - Evaluate on test set
     - `m4.predict_sample` - Predict on sample image

**Block Registration Process:**

1. Define block via `Blockly.Blocks["block_type"] = { init: function() { ... } }`
2. Inside `init()`:
   - `this.appendDummyInput()` or `this.appendValueInput()` - Add input rows
   - `.appendField()` - Add text labels
   - `.appendField(new FieldType(...), "FIELD_NAME")` - Add editable fields
   - `setStatement(this)` - Make connectable in sequence
   - `this.setColour(COLOR_CODE)` - Set block color
   - `appendInfo(this, text)` - Add info icon and tooltip

3. Define Python code generation via `pythonGenerator.forBlock["block_type"] = function() { ... }`

**Block Types (by category):**

| Category | Block Type | Fields | Purpose |
|----------|-----------|--------|---------|
| Datasets | dataset.select | DATASET | Choose dataset dropdown |
| | dataset.info | (none) | Get dataset metadata |
| | dataset.class_counts | (none) | Get class counts |
| | dataset.class_distribution_preview | (none) | Get distribution % |
| | dataset.sample_image | MODE, INDEX | Get sample |
| Images | image.channels_split | (none) | Split RGB |
| | image.show | TITLE | Display image |
| Preprocessing | m2.to_grayscale | (none) | Grayscale conversion |
| | m2.brightness_contrast | B, C | Brightness/contrast adjust |
| | m2.blur_sharpen | BLUR, SHARP | Blur/sharpen |
| | m2.resize | MODE, W, H, KEEP | Resize |
| | m2.pad | W, H, MODE, R, G, B | Pad |
| | m2.normalize | MODE | Normalize |
| | m2.edges | METHOD, THRESHOLD, OVERLAY | Edge detection |
| Splitting | m3.set_split_ratio | RATIO | Set split ratio |
| | m3.apply_split | (none) | Apply split |
| Model | m4.model_init | (none) | Init model |
| | m4.layer_conv2d | FILTERS, KERNEL, STRIDE, PADDING | Conv layer |
| | m4.layer_pool | KIND, SIZE | Pool layer |
| | m4.layer_dense | UNITS | Dense layer |
| | m4.model_summary | (none) | Model summary |
| Training | m4.train_hparams | EPOCHS, BATCH | Training config |
| | m4.train_start | (none) | Start training |
| Evaluation | m4.eval_test | (none) | Evaluate |
| | m4.predict_sample | (none) | Predict |

**Toolbox Configuration JSON Files:**
- Module 1: [apps/web/src/components/Toolbox.ts](apps/web/src/components/Toolbox.ts)
- Module 2: [apps/web/src/components/toolboxModule2.ts](apps/web/src/components/toolboxModule2.ts)
- Module 3 (Split): [apps/web/src/components/toolboxModule3.ts](apps/web/src/components/toolboxModule3.ts)
- Module 3 (Model): [apps/web/src/components/toolboxModule4.ts](apps/web/src/components/toolboxModule4.ts)

---

## Workspace State Management

### Workspace Capture

**Purpose:** Extract blocks from Blockly workspace and convert to JSON for backend transmission

**Extraction Functions** (from StageRunner):

1. **Get Top Chains:**
   ```typescript
   function getTopChains(ws: WorkspaceSvg): BlocklyBlock[][] {
       const tops = ws.getTopBlocks(true) as BlocklyBlock[];
       const chains: BlocklyBlock[][] = [];
       for (const top of tops) {
           const chain: BlocklyBlock[] = [];
           for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) 
               chain.push(b);
           chains.push(chain);
       }
       return chains;
   }
   ```

2. **Convert Block to Model:**
   ```typescript
   function blockToModel(b: BlocklyBlock): { type: string; fields: Record<string, unknown> } {
       const fields: Record<string, unknown> = {};
       for (const input of b.inputList || []) {
           for (const field of input.fieldRow || []) {
               const name = (field as any).name as string | undefined;
               if (!name) continue;
               const val = (field as any).getValue?.() ?? (field as any).getText?.();
               fields[name] = val;
           }
       }
       return { type: b.type, fields };
   }
   ```

3. **Build Analyze Payload:**
   ```typescript
   function workspaceToAnalyzePayload(ws: WorkspaceSvg, clientSignature?: string) {
       const chains = getTopChains(ws).map((chain) => ({
           top_block_type: chain[0]?.type ?? null,
           blocks: chain.map(blockToModel),
       }));
       return clientSignature ? { chains, client_signature: clientSignature } : { chains };
   }
   ```

**Events Monitored:**
- `workspace_change` event - Triggered on block add/remove/move/property change
- Debounced: 300ms (`WORKSPACE_CHANGE_DEBOUNCE_MS`)

### Serialization

**Format:** JSON (via Blockly.Xml internally, exposed as AnalyzeRequest)

**Workspace Request Model:**
```typescript
interface AnalyzeRequest {
    chains: ChainModel[];
    client_signature?: string;
    user_id?: string;
    stage_id?: string;
}

interface ChainModel {
    top_block_type: string | null;
    blocks: BlockModel[];
}

interface BlockModel {
    type: string;
    fields: Record<string, unknown>;
}
```

**Serialization Methods:**
- **To JSON (for API):** `workspaceToAnalyzePayload()` → JSON object
- **To XML (for storage):** `Blockly.Xml.workspaceToDom(workspace)` → XML DOM
- **From XML (for loading):** `Blockly.Xml.domToWorkspace(xmlDom, workspace)`

**State Preservation:** Not persisted to disk in current implementation (session-scoped only)

### Persistence

**Local State:**
- Blockly workspace XML maintained in memory only
- State lost on page refresh
- No localStorage integration

**Session Storage:**
- Stored in React component state: `useState<BlocklyBlock[]>([])`
- Cleared when user navigates away or refreshes

**Backend Storage:**
- **Models:** Saved to disk via `/model/save` endpoint → HDF5 file
- **Datasets:** Original datasets stored on disk; processed datasets exported to new folder
- **Session History:** In-memory Python dictionaries (not persisted)

---

## User Progress Tracking

### Stage Progress Tracking

**Module 2 Progress Tracking:**
- Stages defined in: [apps/web/src/data/module2Stages.ts](apps/web/src/data/module2Stages.ts)
- 4 stages: ids 1, 2, 3, 4
- Linear progression (must complete stage 1 before unlocking stage 2)

**Module 3 Progress Tracking:**
- Stages defined in: [apps/web/src/data/module4Stages.ts](apps/web/src/data/module4Stages.ts)
- 3 stages: ids 1, 2, 3
- Linear progression

**Completion Status Storage:**
- Frontend: Not persisted (in-memory only)
- No database or localStorage tracking
- Progress visible only within current session

**Completion Detection:**
- Triggered when user clicks "Submit"
- Backend validates blocks against stage requirements
- Returns success/failure with checklist
- Frontend displays SubmissionModal on success
- User clicks "Next Stage" to continue

---

## Validation Requests

### Where Frontend Calls Backend

**API Calls by Component:**

**1. Module 1 (Dataset Exploration):**
   - GET `/datasets` - Load dataset list
   - GET `/datasets/{key}/info` - Get dataset metadata
   - GET `/datasets/{key}/sample` - Get sample image
   - GET `/datasets/{key}/grayscale` - Get grayscale preview
   - GET `/datasets/{key}/split_channels` - Get RGB channel split
   - POST `/analyze` - Validate workspace structure

**2. Module 2 (Image Preprocessing):**
   - GET `/datasets` - Load dataset list
   - POST `/preprocess/apply` - Apply preprocessing ops
   - POST `/preprocess/batch_export` - Batch process and export dataset
   - POST `/split/preview` - Preview train/test split
   - POST `/split/apply` - Apply split
   - POST `/analyze` - Validate workspace

**3. Module 3 (Model Building):**
   - GET `/datasets` - Load dataset list
   - POST `/split/preview` - Preview split
   - POST `/split/apply` - Apply split
   - POST `/split/bias` - Check class bias
   - POST `/split/balance` - Balance training data
   - POST `/model/build` - Build CNN model
   - POST `/train/start` - Start training
   - GET `/evaluate/test` - Evaluate on test set
   - POST `/predict/sample` - Predict on sample
   - POST `/analyze` - Validate workspace

**Payload Structures:**

**POST /preprocess/apply:**
```typescript
{
    dataset_key: "recyclables-mini",
    path: "images/plastic/Image_9.jpg",
    ops: [
        { type: "to_grayscale" },
        { type: "brightness_contrast", b: 10, c: 10 }
    ]
}
```

**POST /model/build:**
```typescript
{
    dataset_key: "recyclables-mini",
    spec: {
        name: "my-model",
        layers: [
            { type: "conv2d", params: { filters: 32, kernel: 3 } },
            { type: "pool", params: { kind: "max", size: 2 } },
            { type: "dense", params: { units: 128 } }
        ]
    }
}
```

**POST /train/start:**
```typescript
{
    dataset_key: "recyclables-mini",
    epochs: 5,
    batch: 32
}
```

**Functions That Make Requests:**
- `fetchJSON<T>(url, init?)` - Wrapper for fetch with type safety
- Called from event handlers: `onWorkspaceChange()`, `onSubmitStage()`, `onRunBlocks()`

---

## Output Rendering

### Dataset Outputs

**Display Component:** [apps/web/src/components/OutputPanel.tsx](apps/web/src/components/OutputPanel.tsx)

**Dataset Info Cards:**
```typescript
// Card output
{ 
    kind: "card", 
    title: "Dataset Info", 
    lines: [
        "Name: Recyclables (Mini)",
        "Classes: 3 (plastic, metal, paper)",
        "Total images: 120"
    ] 
}
```

**Dataset Distribution Charts:**
```typescript
// Chart output
{
    kind: "chart",
    title: "Class Distribution",
    data: [
        { label: "plastic", percent: 40 },
        { label: "metal", percent: 35 },
        { label: "paper", percent: 25 }
    ]
}
```

### Image Outputs

**Image Display:**
```typescript
// Single image
{
    kind: "image",
    src: "data:image/png;base64,...",
    caption: "Original image"
}

// Multiple images
{
    kind: "images",
    items: [
        { src: "data:image/png;base64,...", caption: "Grayscale" },
        { src: "data:image/png;base64,...", caption: "Brightened" }
    ]
}
```

**Image Rendering:**
- Images displayed in `<img>` tags
- Base64 data URL as src
- Responsive sizing: `max-w-full`
- Rounded corners: `rounded-lg`
- Border and shadow

### Charts/Visualizations

**Chart Display:**
```typescript
// Chart rendering (simple HTML table or text)
kind: "chart" → 
{
    title: "Class Distribution (%)",
    data: [
        { label: "class1", percent: 33 },
        { label: "class2", percent: 42 },
        { label: "class3", percent: 25 }
    ]
}

// Rendered as:
<div>
    <h3>Class Distribution (%)</h3>
    <div>class1: ▰▰▰ 33%</div>
    <div>class2: ▰▰▰▰ 42%</div>
    <div>class3: ▰▰ 25%</div>
</div>
```

**Supported Visualizations:**
- Text summaries
- Card-based info display
- Simple bar chart representation
- Image gallery (before/after)

### Model Outputs

**Model Summary Display:**
```typescript
// Array of summary lines (from TensorFlow model.summary())
[
    "Model: 'my-model'",
    "_________________________________________________________________",
    " Layer (type)                Output Shape              Param #",
    "=================================================================",
    " input (InputLayer)          (None, 150, 150, 3)       0",
    " conv2d (Conv2D)             (None, 148, 148, 32)      896",
    " max_pooling2d (MaxPooling2D)(None, 74, 74, 32)        0",
    " flatten (Flatten)           (None, 175232)            0",
    " dense (Dense)               (None, 128)               22429696",
    " dense (Dense)               (None, 3)                 387",
    "=================================================================",
    "Total params: 22,430,979",
    "Trainable params: 22,430,979",
    "Non-trainable params: 0"
]

// Rendered as:
{ kind: "card", title: "Model Summary", lines: [...] }
```

**Training Results Display:**
```typescript
{
    kind: "card",
    title: "Training Complete",
    lines: [
        "Epochs: 5",
        "Final Loss: 0.245",
        "Final Accuracy: 92.5%"
    ]
}
```

**Evaluation Results Display:**
```typescript
{
    kind: "card",
    title: "Evaluation Results",
    lines: [
        "Test Accuracy: 89.3%",
        "Test Loss: 0.342"
    ]
}
```

---

## Forms and User Input Handling

**State Management Approach:** React hooks (useState, useRef, useEffect)

**Form Handling Libraries:** None (vanilla React state management)

**Input Types in Blockly:**

1. **Dropdown Fields** (FieldDropdown):
   ```typescript
   new (Blockly as any).FieldDropdown(
       [["option1", "value1"], ["option2", "value2"]],
       optionalValidator
   )
   ```
   - Example: `dataset.select` DATASET field
   - Example: `m2.resize` MODE field ("size" or "fit")

2. **Number Fields** (FieldNumber):
   ```typescript
   new (Blockly as any).FieldNumber(initialValue, minVal, maxVal, step)
   ```
   - Example: `m2.brightness_contrast` B, C fields
   - Example: `m4.layer_conv2d` FILTERS, KERNEL fields

3. **Text Input Fields** (FieldTextInput):
   ```typescript
   new (Blockly as any).FieldTextInput(initialValue, optionalValidator)
   ```
   - Example: `image.show` TITLE field

4. **Boolean Toggle Fields** (FieldToggle) - if used:
   - Example: `m2.resize` KEEP field

**Stage Submission Form:**
- Button: "Submit" or "Run"
- Triggers workspace validation
- Shows success/failure modal
- No explicit form, button event handler triggers validation

---

## Frontend Screenshots to Include (Recommendations)

**Screenshot 1: Home Page**
- **Content:** Module selection grid with 3 module cards
- **Why It's Useful:** Shows the three-module structure; illustrates Framer Motion animations and card design
- **Suggested Caption:** "VisionBlocks home page with three sequential learning modules"

**Screenshot 2: Module 2 Stage 1 Workspace**
- **Content:** Blockly workspace with preprocessing blocks, output panel showing before/after images
- **Why It's Useful:** Demonstrates core workflow—block selection, workspace visualization, image output
- **Suggested Caption:** "Module 2 Stage 1: Student builds grayscale + cleanup preprocessing pipeline"

**Screenshot 3: Blockly Toolbox (Module 2 Preprocessing)**
- **Content:** Expanded toolbox showing preprocessing block categories (grayscale, resize, pad, normalize, etc.)
- **Why It's Useful:** Shows block organization and naming; illustrates category color-coding
- **Suggested Caption:** "Module 2 Blockly toolbox with preprocessing block categories"

**Screenshot 4: Output Panel with Images**
- **Content:** Before/after image comparison (original vs. preprocessed)
- **Why It's Useful:** Shows real-time visual feedback mechanism
- **Suggested Caption:** "Real-time image processing output showing before/after comparison"

**Screenshot 5: Stage Checklist**
- **Content:** MissionChecklistStage component showing completed, pending, and wrong-order blocks
- **Why It's Useful:** Shows validation UI and checklist state transitions
- **Suggested Caption:** "Stage completion checklist with block status indicators"

**Screenshot 6: Module 3 Model Building Workspace**
- **Content:** Blockly workspace with model blocks (conv, pool, dense), model summary in output
- **Why It's Useful:** Shows Model-building workflow; demonstrates model layer composition
- **Suggested Caption:** "Module 3 Stage 1: Student designs CNN architecture using model blocks"

**Screenshot 7: Module 3 Model Summary Output**
- **Content:** Model architecture summary (layer types, parameters, total params)
- **Why It's Useful:** Shows detailed model information output
- **Suggested Caption:** "Model summary output showing architecture details and parameter counts"

**Screenshot 8: Submission Modal**
- **Content:** Success modal with celebration message and "Next Stage" button
- **Why It's Useful:** Shows completion feedback and progression UX
- **Suggested Caption:** "Stage completion confirmation modal"

---

# 3.2.3 BACKEND

## Backend Overview

**Programming Language:** Python 3.8+

**Framework:** FastAPI 0.135.0+ (modern async Python web framework)

**Server:** Uvicorn 0.18.0+ (ASGI server)

**Entry Point:** [apps/api/app/main.py](apps/api/app/main.py)

**Port:** 8000 (default Uvicorn)

**Documentation:** FastAPI auto-generates OpenAPI/Swagger docs at `/docs`

---

## Backend Folder Structure

```
apps/api/
├── app/
│   ├── main.py
│   │   └─ FastAPI app initialization
│   │   └─ CORS middleware configuration
│   │   └─ Router includes
│   │   └─ Startup event (dataset warmup)
│   │
│   ├── core/
│   │   └── config.py
│   │       └─ Settings class (Pydantic BaseSettings)
│   │       └─ DATASETS_DIR, PREVIEW_MAX_SIDE, etc.
│   │
│   ├── models/
│   │   └── schemas.py
│   │       └─ Request/response Pydantic models
│   │       └─ DatasetListItem, DatasetInfo, SampleResponse, etc.
│   │
│   ├── routes/
│   │   ├── health.py
│   │   │   └─ GET /health
│   │   ├── datasets.py
│   │   │   └─ GET /datasets, /datasets/{key}/info, /datasets/{key}/sample, etc.
│   │   ├── preprocess.py
│   │   │   └─ POST /preprocess/apply, /preprocess/batch_export
│   │   ├── split.py
│   │   │   └─ POST /split/preview, /split/apply, /split/balance, /split/bias
│   │   ├── model.py
│   │   │   └─ POST /model/build, /model/save, /model/load
│   │   ├── train.py
│   │   │   └─ POST /train/start
│   │   ├── evaluate.py
│   │   │   └─ GET /evaluate/test
│   │   ├── predict.py
│   │   │   └─ POST /predict/sample
│   │   ├── analyzer.py (AI-specific—EXCLUDED)
│   │   └── agent.py (utility functions—EXCLUDED)
│   │
│   ├── services/
│   │   ├── datasets.py
│   │   │   └─ Dataset indexing, loading, sampling
│   │   │   └─ Functions: list_datasets(), dataset_info(), sample_from_dataset()
│   │   ├── image_ops.py
│   │   │   └─ Image processing operations
│   │   │   └─ Functions: op_resize(), op_pad(), op_normalize(), apply_pipeline()
│   │   ├── split_service.py
│   │   │   └─ Train/test split logic
│   │   │   └─ Functions: preview_split(), apply_split(), check_bias_train()
│   │   ├── model_service.py
│   │   │   └─ Model building, training, evaluation
│   │   │   └─ Functions: build_model_for_dataset(), train_active_model()
│   │   └── model_viz/
│   │       └─ Model visualization (diagram generation—excluded)
│   │
│   ├── third_party/
│   │   ├── plotneuralnet_adapter.py (excluded)
│   │   └── plotneuralnet/ (external library—excluded)
│   │
│   ├── scripts/
│   │   └─ Utility scripts (if any)
│   │
│   └── data/
│       ├── datasets/
│       │   ├── recyclables-mini/ (example dataset)
│       │   │   ├── images/
│       │   │   │   ├── plastic/
│       │   │   │   ├── metal/
│       │   │   │   └── paper/
│       │   │   ├── index.csv (or metadata.json)
│       │   │   └── split_cache/ (temporary split state)
│       │   └── (other datasets)
│       ├── created_models/
│       │   ├── recyclables-mini/
│       │   │   ├── model-1.h5
│       │   │   └── model-2.h5
│       │   └── (other dataset models)
│       ├── model_diagrams/ (generated PNG diagrams—excluded)
│       └── model_viz/ (intermediate files—excluded)
│
├── requirements.txt
│   └─ Python dependencies
├── pytest.ini
│   └─ Test configuration
└── .env (not in repo)
    └─ Environment variables: OPENROUTER_API_KEY, OPENROUTER_MODEL, etc.
```

**Responsibility of Each Folder:**

- **`app/`** - Application source code
- **`core/`** - Configuration and settings
- **`models/`** - Pydantic data models (schemas)
- **`routes/`** - API endpoint handlers (9 modules)
- **`services/`** - Business logic and service classes
- **`third_party/`** - External integrations
- **`data/`** - Data files (datasets, models, cache)

---

## API Layer

### All API Endpoints

#### **1. Health Check**

| Endpoint | Method | Route | File | Function | Purpose |
|----------|--------|-------|------|----------|---------|
| Health | GET | `/health` | [routes/health.py](apps/api/app/routes/health.py) | `health()` | Check API status |

**Request:** None  
**Response:**
```json
{ "status": "ok" }
```

---

#### **2. Datasets**

| Endpoint | Method | Route | File | Function | Purpose |
|----------|--------|-------|------|----------|---------|
| List Datasets | GET | `/datasets` | [routes/datasets.py](apps/api/app/routes/datasets.py) | `get_datasets()` | Get available datasets |
| Dataset Info | GET | `/datasets/{key}/info` | [routes/datasets.py](apps/api/app/routes/datasets.py) | `get_dataset_info(key)` | Get metadata for dataset |
| Get Sample | GET | `/datasets/{key}/sample` | [routes/datasets.py](apps/api/app/routes/datasets.py) | `get_sample(key, mode, index)` | Get sample image from dataset |
| Grayscale Preview | GET | `/datasets/{key}/grayscale` | [routes/datasets.py](apps/api/app/routes/datasets.py) | `grayscale(key, path)` | Get grayscale version of image |
| Split Channels | GET | `/datasets/{key}/split_channels` | [routes/datasets.py](apps/api/app/routes/datasets.py) | `split_channels(key, path)` | Get RGB channel split |

**Responses:**

**GET /datasets:**
```json
{
    "items": [
        { "key": "recyclables-mini", "name": "Recyclables (Mini)" },
        { "key": "mnist", "name": "MNIST" }
    ]
}
```

**GET /datasets/{key}/info:**
```json
{
    "key": "recyclables-mini",
    "name": "Recyclables (Mini)",
    "image_shape": [null, null, 3],
    "num_classes": 3,
    "classes": ["plastic", "metal", "paper"],
    "approx_count": { "plastic": 40, "metal": 35, "paper": 25 }
}
```

**GET /datasets/{key}/sample:**
```json
{
    "dataset_key": "recyclables-mini",
    "index_used": 5,
    "label": "plastic",
    "image_data_url": "data:image/png;base64,...",
    "path": "images/plastic/Image_5.jpg"
}
```

---

#### **3. Preprocessing**

| Endpoint | Method | Route | File | Function | Purpose |
|----------|--------|-------|------|----------|---------|
| Apply Pipeline | POST | `/preprocess/apply` | [routes/preprocess.py](apps/api/app/routes/preprocess.py) | `preprocess_apply(req)` | Apply preprocessing ops to single image |
| Batch Export | POST | `/preprocess/batch_export` | [routes/preprocess.py](apps/api/app/routes/preprocess.py) | `preprocess_batch_export(req)` | Process multiple images and export |

**Request:**

**POST /preprocess/apply:**
```json
{
    "dataset_key": "recyclables-mini",
    "path": "images/plastic/Image_9.jpg",
    "ops": [
        { "type": "to_grayscale" },
        { "type": "brightness_contrast", "b": 10, "c": 10 },
        { "type": "blur_sharpen", "blur": 0, "sharp": 1 },
        { "type": "resize", "mode": "size", "w": 150, "h": 150, "keep": "TRUE" },
        { "type": "pad", "w": 150, "h": 150, "mode": "constant" },
        { "type": "normalize", "mode": "zero_one" }
    ]
}
```

**POST /preprocess/batch_export:**
```json
{
    "dataset_key": "recyclables-mini",
    "subset": {
        "mode": "all",
        "n": null,
        "shuffle": false
    },
    "ops": [...],
    "new_dataset_name": "recyclables-processed",
    "overwrite": false
}
```

**Response:**

**POST /preprocess/apply:**
```json
{
    "dataset_key": "recyclables-mini",
    "path": "images/plastic/Image_9.jpg",
    "before_data_url": "data:image/jpeg;base64,...",
    "after_data_url": "data:image/png;base64,...",
    "after_shape": [150, 150, 3]
}
```

---

#### **4. Split Management**

| Endpoint | Method | Route | File | Function | Purpose |
|----------|--------|-------|------|----------|---------|
| Preview Split | POST | `/split/preview` | [routes/split.py](apps/api/app/routes/split.py) | `split_preview(body)` | Preview train/test split distribution |
| Apply Split | POST | `/split/apply` | [routes/split.py](apps/api/app/routes/split.py) | `split_apply(body)` | Apply train/test split |
| Current Split State | GET | `/split/state` | [routes/split.py](apps/api/app/routes/split.py) | `split_current_state(dataset_key)` | Get active split info |
| Check Bias | POST | `/split/bias` | [routes/split.py](apps/api/app/routes/split.py) | `split_bias(body)` | Check training data class bias |
| Balance Training | POST | `/split/balance` | [routes/split.py](apps/api/app/routes/split.py) | `split_balance(body)` | Balance training set (in-session) |

**Request:**

**POST /split/preview:**
```json
{
    "dataset_key": "recyclables-mini",
    "train_pct": 80
}
```

**POST /split/apply:**
```json
{
    "dataset_key": "recyclables-mini",
    "train_pct": 80,
    "shuffle": true
}
```

**POST /split/bias:**
```json
{
    "dataset_key": "recyclables-mini",
    "threshold_pct": 10
}
```

**Response:**

**POST /split/preview:**
```json
{
    "dataset_key": "recyclables-mini",
    "train_pct": 80,
    "classes": ["plastic", "metal", "paper"],
    "total_per_class": { "plastic": 40, "metal": 35, "paper": 25 },
    "train_per_class": { "plastic": 32, "metal": 28, "paper": 20 },
    "test_per_class": { "plastic": 8, "metal": 7, "paper": 5 }
}
```

---

#### **5. Model Management**

| Endpoint | Method | Route | File | Function | Purpose |
|----------|--------|-------|------|----------|---------|
| Build Model | POST | `/model/build` | [routes/model.py](apps/api/app/routes/model.py) | `model_build(body)` | Build Keras model from spec |
| Save Model | POST | `/model/save` | [routes/model.py](apps/api/app/routes/model.py) | `model_save(body)` | Save active model to disk |
| Load Model | POST | `/model/load` | [routes/model.py](apps/api/app/routes/model.py) | `model_load(body)` | Load model from disk |

**Request:**

**POST /model/build:**
```json
{
    "dataset_key": "recyclables-mini",
    "spec": {
        "name": "my-model",
        "layers": [
            { "type": "conv2d", "params": { "filters": 32, "kernel": 3, "stride": 1, "padding": "same", "activation": "relu" } },
            { "type": "pool", "params": { "kind": "max", "size": 2 } },
            { "type": "dense", "params": { "units": 128, "activation": "relu" } },
            { "type": "dense", "params": { "units": 3, "activation": "softmax" } }
        ]
    },
    "use_active_split": true
}
```

**Response:**

**POST /model/build:**
```json
{
    "ok": true,
    "model_name": "my-model",
    "model_summary": [
        "Model: 'my-model'",
        "...",
        "Total params: 22,430,979"
    ],
    "params": {
        "input_shape": [150, 150, 3],
        "num_classes": 3,
        "total_params": 22430979
    }
}
```

---

#### **6. Training**

| Endpoint | Method | Route | File | Function | Purpose |
|----------|--------|-------|------|----------|---------|
| Start Training | POST | `/train/start` | [routes/train.py](apps/api/app/routes/train.py) | `train_start(body)` | Start model training |

**Request:**

**POST /train/start:**
```json
{
    "dataset_key": "recyclables-mini",
    "epochs": 5,
    "batch": 32
}
```

**Response:**

```json
{
    "ok": true,
    "dataset_key": "recyclables-mini",
    "epochs": 5,
    "batch_size": 32,
    "final_loss": 0.245,
    "final_accuracy": 0.925,
    "total_params": 22430979
}
```

---

#### **7. Evaluation**

| Endpoint | Method | Route | File | Function | Purpose |
|----------|--------|-------|------|----------|---------|
| Evaluate on Test | GET | `/evaluate/test` | [routes/evaluate.py](apps/api/app/routes/evaluate.py) | `evaluate_test()` | Evaluate trained model on test set |

**Request:** None

**Response:**

```json
{
    "ok": true,
    "test_loss": 0.342,
    "test_accuracy": 0.893,
    "classes_tested": 3,
    "samples_tested": 25
}
```

---

#### **8. Prediction**

| Endpoint | Method | Route | File | Function | Purpose |
|----------|--------|-------|------|----------|---------|
| Predict Sample | POST | `/predict/sample` | [routes/predict.py](apps/api/app/routes/predict.py) | `predict_sample(body)` | Predict on single image |

**Request:**

**POST /predict/sample:**
```json
{
    "dataset_key": "recyclables-mini",
    "path": "images/plastic/Image_1.jpg"
}
```

**Response:**

```json
{
    "ok": true,
    "dataset_key": "recyclables-mini",
    "path": "images/plastic/Image_1.jpg",
    "predicted_class": "plastic",
    "confidence": 0.95,
    "probabilities": {
        "plastic": 0.95,
        "metal": 0.03,
        "paper": 0.02
    }
}
```

---

#### **9. Workspace Analysis (AI-specific—EXCLUDED)**

| Endpoint | Method | Route | File | Function | Purpose |
|----------|--------|-------|------|----------|---------|
| Analyze Workspace | POST | `/analyze` | analyzer.py | `analyze_workspace(req)` | Non-AI validation excluded; AI logic excluded |
| Module 1 Agent | POST | `/analyze/module1/agent` | analyzer.py | `analyze_module1_agent(req)` | AI-specific—EXCLUDED |

---

## Request Processing Flow

### Typical Workspace Submission Flow

1. **User Submits Stage** (Frontend)
   - Collects Blockly workspace state
   - Sends POST request with blocks

2. **Endpoint Handler Receives Request** (e.g., `/preprocess/apply`)
   - FastAPI routes request to handler function
   - Pydantic model validates and deserializes JSON

3. **Validation Logic** (in handler)
   - Check request fields: `dataset_key`, `path`, `ops`
   - Raise `HTTPException(400, detail=...)` if invalid

4. **Service Layer Processing** (calls service function)
   - Example: `load_dataset_image()` from image_ops service
   - Throws exception on error (caught by handler)

5. **Data Processing** (service functions)
   - Load image from disk
   - Apply operations sequentially via `apply_pipeline()`
   - Generate output (e.g., base64 data URL)

6. **Response Generation**
   - Serialize response data via Pydantic model
   - Return HTTP 200 with JSON body

7. **Error Handling**
   - Catch exceptions: `FileNotFoundError`, `ValueError`, `KeyError`
   - Return HTTP 400/404 with error detail

8. **Frontend Receives Response**
   - Parse JSON response
   - Update UI with results

---

## Workspace Processing

### How Workspace Data is Received

**Source:** Frontend captures Blockly workspace and serializes to `AnalyzeRequest` JSON

**Data Format:**
```json
{
    "chains": [
        {
            "top_block_type": "dataset.select",
            "blocks": [
                { "type": "dataset.select", "fields": { "DATASET": "recyclables-mini" } },
                { "type": "m2.to_grayscale", "fields": {} },
                { "type": "m2.brightness_contrast", "fields": { "B": 10, "C": 10 } }
            ]
        }
    ],
    "client_signature": "abc123...",
    "stage_id": "2"
}
```

### Data Parsing Logic

**File:** [apps/api/app/routes/analyzer.py](apps/api/app/routes/analyzer.py)

**Function:** `analyze_workspace(req: AnalyzeRequest)`

**Steps:**
1. **Canonicalize request:** Convert to JSON, sort keys
2. **Generate signature:** SHA256 hash of canonical JSON
3. **Find primary chain:** Search for chain containing "dataset.select"
4. **Build checklist:** Iterate REQUIRED_ORDER, check block presence and order
5. **Map to actions:** Convert blocks to planned backend operations

### Validation Workflow

**Checklist States:**
- `"ok"` - Block present and in correct position
- `"wrong_place"` - Block present but not after prerequisite
- `"missing"` - Block not found in workspace

**Order Validation:**
- Module 1: `REQUIRED_ORDER = ["dataset.select", "dataset.info", "dataset.class_counts", "dataset.class_distribution_preview", "dataset.sample_image", "image.channels_split"]`
- Module 2: `REQUIRED_ORDER` specific to stage (e.g., Stage 1 requires grayscale, brightness/contrast, blur/sharpen)
- Module 3: Dynamic based on stage configuration

---

## Stage Validation Logic

### Block Validation

**Location:** [apps/web/src/app/module2/(shared)/StageRunner.tsx](apps/web/src/app/module2/(shared)/StageRunner.tsx) (Frontend) + [apps/api/app/services/](apps/api/app/services/) (Backend)

**Order Validation:**
- Extract block types from workspace chains
- Check against `stage.expectedOrder`
- Flag blocks out of order as "wrong_place"

**Required Block Validation:**
- Check all blocks in `stage.requiredBlocks` are present
- Flag missing blocks as "missing"

### Parameter Validation

**File:** [apps/api/app/services/image_ops.py](apps/api/app/services/image_ops.py)

**Example: Resize Operation Validation**
```python
def op_resize(cv_img: np.ndarray, mode: str, w: int | None = None, h: int | None = None, ...) -> np.ndarray:
    if mode == "size":
        w = int(w or 256)
        h = int(h or 256)
        if w <= 0 or h <= 0:
            raise ValueError("Invalid resize dimensions")
        # ... perform resize
```

**Allowed Values:**
- `mode` ∈ {"size", "fit"}
- `w`, `h` ∈ [1, ∞) integers
- `keep` ∈ {"TRUE", "FALSE"}
- `normalize.mode` ∈ {"zero_one", "minus_one_one", "zscore"}

### Completion Detection

**Trigger:** User clicks "Submit"

**Validation Checks (Module 2 example):**
1. All required blocks present ✓
2. Blocks in correct order ✓
3. Parameters match expected values ✓
4. Operations execute without error ✓

**Success Criteria:**
- All checks pass → Display SubmissionModal → Mark stage complete

**Failure Criteria:**
- Any check fails → Display error message → Allow retry

**Code Location:** [apps/web/src/app/module2/(shared)/StageRunner.tsx](apps/web/src/app/module2/(shared)/StageRunner.tsx) function `onSubmitStage()`

---

## Data Management

### Database Usage

**Database Type:** None (not using SQL database)

**Alternative:** In-memory session storage using Python dictionaries

**Session Storage Locations:**
- `_HISTORY: Dict[str, _StudentHistory]` - Module 1 history
- `_M2_STAGE_HISTORY: Dict[str, _Module2StageHistory]` - Module 2 stage history
- `_M4_STAGE_HISTORY: Dict[str, _Module2StageHistory]` - Module 3 stage history
- `_CHAT_HISTORY: Dict[str, _ChatSession]` - Multi-turn conversation history (AI—EXCLUDED)
- `_ACTIVE_SPLITS: Dict[str, Dict[str, Any]]` - Current train/test splits per dataset
- `_ACTIVE_MODELS: Dict[str, keras.Model]` - Loaded Keras models in memory
- `_ACTIVE_SPECS: Dict[str, Dict[str, Any]]` - Model specifications

**Data Persistence:** Session-scoped only (lost on server restart)

### File Storage

**Location:** [apps/api/app/data/](apps/api/app/data/)

**Datasets:**
- Path: `data/datasets/{dataset_key}/`
- Structure:
  ```
  recyclables-mini/
  ├── images/
  │   ├── plastic/ (class folder)
  │   │   ├── Image_1.jpg
  │   │   ├── Image_2.jpg
  │   │   └── ...
  │   ├── metal/
  │   │   └── ...
  │   └── paper/
  │       └── ...
  ├── index.csv (or metadata.json)
  └── split_cache/ (temporary)
  ```

**Models:**
- Path: `data/created_models/{dataset_key}/{model_name}.h5`
- Format: HDF5 (Keras native)
- Content: Model architecture + weights + metadata

**Model Diagrams:**
- Path: `data/model_diagrams/` (excluded from documentation)

**Metadata Files:**
- `index.csv` - Columns: id, path, class, split
- `metadata.json` - JSON metadata object

### Session Management

**Implementation:** In-memory dictionaries (no explicit session table)

**Session Key Generation:**
- Function: `_history_key(req: AnalyzeRequest, request: Request) -> str`
- Uses client IP or provided `client_signature`
- Format: `"ip:192.168.1.1"` or client_signature hash

**Session Timeout:** None (sessions persist until server restart)

**Session Data Stored:**
- Workspace analysis results (cached by signature)
- Hint history (EXCLUDED)
- Chat history (EXCLUDED)

---

## Services and Business Logic

### Service Classes/Modules

#### **1. Datasets Service**
**File:** [apps/api/app/services/datasets.py](apps/api/app/services/datasets.py)

**Class:** `DatasetIndex` (dataclass)
- `key: str` - Dataset identifier
- `root: Path` - Root directory path
- `images_dir: Path` - Images directory
- `classes: List[str]` - Class labels
- `rows: List[Dict[str, str]]` - Metadata rows
- `approx_count: Dict[str, int]` - Per-class image counts
- `meta: Dict` - Extra metadata

**Main Functions:**
- `list_datasets() -> List[Tuple[str, str]]` - Returns (key, name) pairs
- `dataset_info(key: str) -> Dict` - Get dataset metadata
- `sample_from_dataset(key: str, mode: str, index: Optional[int]) -> Tuple[Dict, Image.Image]` - Get sample image
- `image_data_url(img: Image.Image) -> str` - Convert image to data URL
- `load_image_by_relpath(key: str, path: str) -> Image.Image` - Load image file
- `get_datasets_index(force_refresh=False) -> Dict[str, DatasetIndex]` - Get in-memory dataset index (built at startup via `_warmup()`)

#### **2. Image Operations Service**
**File:** [apps/api/app/services/image_ops.py](apps/api/app/services/image_ops.py)

**Main Functions:**
- `load_dataset_image(dataset_key, rel_path) -> Tuple[Image.Image, Path, str]` - Load image
- `list_all_images(dataset_key) -> List[Path]` - List all images in dataset
- `apply_pipeline(cv_img: np.ndarray, ops: List[Dict]) -> np.ndarray` - Apply operations sequentially
- `pil_to_data_url(img: Image.Image, fmt_hint=None) -> str` - Convert to base64 URL

**Operations (op_* functions):**
- `op_reset(cv_img, cv_orig)` - Reset to original
- `op_resize(cv_img, mode, w, h, maxside, pct, keep)` - Resize
- `op_pad(cv_img, w, h, mode, r, g, b)` - Pad
- `op_brightness_contrast(cv_img, b, c)` - Brightness/contrast
- `op_blur_sharpen(cv_img, blur, sharp)` - Blur/sharpen
- `op_normalize(cv_img, mode)` - Normalize pixels
- `op_edges(cv_img, method, threshold, overlay)` - Edge detection
- `export_dataset(base_dataset, rel_paths, ops, new_dataset_name, overwrite)` - Batch process and export

#### **3. Split Service**
**File:** [apps/api/app/services/split_service.py](apps/api/app/services/split_service.py)

**Class:** `SplitPreview` (dataclass)
- `dataset_key: str`
- `train_pct: int` (1-99)
- `classes: List[str]`
- `total_per_class: Dict[str, int]`
- `train_per_class: Dict[str, int]`
- `test_per_class: Dict[str, int]`

**Main Functions:**
- `preview_split(dataset_key, train_pct) -> SplitPreview` - Preview split distribution
- `apply_split(dataset_key, train_pct, shuffle=True) -> Dict` - Apply and cache split
- `split_state(dataset_key) -> Dict` - Get current split
- `get_active_split_indices(dataset_key) -> Tuple[List[int], List[int]]` - Get train/test indices
- `check_bias_train(dataset_key, threshold_pct) -> Dict` - Detect class imbalance
- `balance_train_inplace(dataset_key, mode, target_min_pct) -> Dict` - Rebalance training data (mode: "duplicate", "augment", or "undersample")

#### **4. Model Service**
**File:** [apps/api/app/services/model_service.py](apps/api/app/services/model_service.py)

**Classes:**
- `LayerSpec` (dataclass) - Represents a single model layer
- `ModelSpec` (dataclass) - Represents complete model specification

**Main Functions:**
- `build_model_for_dataset(dataset_key, spec_dict) -> Dict` - Build Keras Sequential model
- `train_active_model(dataset_key, epochs, batch_size) -> Dict` - Train model on train split
- `evaluate_active_model_on_test() -> Dict` - Evaluate on test split
- `predict_on_sample(dataset_key, path) -> Dict` - Predict on single image
- `save_active_model(dataset_key, model_name) -> Dict` - Save to HDF5
- `load_model_for_dataset(dataset_key, model_name) -> Dict` - Load from HDF5
- `_infer_input_shape(ds: DatasetIndex) -> Tuple[int, int, int]` - Returns (150, 150, 3) [standardized from Module 2]
- `_capture_model_summary(model) -> List[str]` - Get model summary text

**Layer Building:**
```python
if layer_spec.type == "conv2d":
    model.add(layers.Conv2D(
        filters=params.get("filters", 32),
        kernel_size=params.get("kernel", 3),
        strides=params.get("stride", 1),
        padding=params.get("padding", "same"),
        activation=params.get("activation", "relu")
    ))
elif layer_spec.type == "pool":
    kind = params.get("kind", "max")
    if kind == "max":
        model.add(layers.MaxPooling2D(...))
    else:
        model.add(layers.AvgPool2D(...))
elif layer_spec.type == "dense":
    model.add(layers.Dense(...))
```

---

## Error Handling

**Error Response Format:**
```json
{
    "detail": "Error message text"
}
```

**HTTP Status Codes Used:**
- `200 OK` - Successful request
- `400 Bad Request` - Validation error, invalid parameters
- `404 Not Found` - Dataset/model/file not found
- `429 Too Many Requests` - Rate limit (from OpenRouter)
- `502 Bad Gateway` - Service unavailable (from OpenRouter)

**Validation Failures (HTTP 400):**
```python
raise HTTPException(status_code=400, detail="Invalid resize dimensions")
raise HTTPException(status_code=400, detail="No images found for the requested subset")
```

**File Not Found (HTTP 404):**
```python
raise HTTPException(status_code=404, detail="Dataset not found: {key}")
raise HTTPException(status_code=404, detail="Image not found: {path}")
raise HTTPException(status_code=404, detail="Model not found: {model_name}")
```

**Exception Handling Pattern (in route handlers):**
```python
try:
    # Process request
    result = service_function()
    return result
except FileNotFoundError as e:
    raise HTTPException(status_code=404, detail=str(e))
except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e))
except KeyError as e:
    raise HTTPException(status_code=404, detail=str(e))
except Exception as e:
    raise HTTPException(status_code=400, detail=str(e))
```

---

## Backend Screenshots to Include (Recommendations)

**Screenshot 1: API Documentation (Swagger UI)**
- **Content:** FastAPI auto-generated `/docs` page showing all endpoints
- **Why It's Useful:** Shows complete API surface; demonstrates endpoint organization
- **Suggested Caption:** "FastAPI auto-generated API documentation with all endpoints"

**Screenshot 2: Model Architecture Visualization**
- **Content:** Model summary output showing layers, shapes, parameters
- **Why It's Useful:** Shows model building and architecture output
- **Suggested Caption:** "Model summary output from Keras Sequential model"

**Screenshot 3: Dataset Directory Structure**
- **Content:** File explorer showing dataset folder organization
- **Why It's Useful:** Shows data organization pattern
- **Suggested Caption:** "Dataset directory structure with image class folders"

**Screenshot 4: Image Processing Pipeline**
- **Content:** Console/terminal showing op_resize, op_pad, op_normalize execution
- **Why It's Useful:** Shows backend processing sequence
- **Suggested Caption:** "Backend processing log showing sequential image operation execution"

---

# METHODOLOGY WRITING SUPPORT

## Recommended Technical Methodology Structure

### Suggested Subsection Hierarchy for Section 3.2

```
3.2 Technical Implementation

3.2.1 System Architecture
  3.2.1.1 Architecture Style and Patterns
  3.2.1.2 Major System Components
  3.2.1.3 Frontend-Backend Communication Protocol
  3.2.1.4 Data Flow and Processing Pipelines
  3.2.1.5 External Integrations and Dependencies
  3.2.1.6 Architecture Visualization

3.2.2 Frontend Implementation
  3.2.2.1 Framework and Technology Stack
  3.2.2.2 Application Structure and Routing
  3.2.2.3 Blockly Integration and Configuration
  3.2.2.4 Block Definitions and Toolbox Organization
  3.2.2.5 Workspace State Management and Serialization
  3.2.2.6 Component Architecture and Data Binding
  3.2.2.7 Validation Request Handling
  3.2.2.8 Output Rendering and Visualization

3.2.3 Backend Implementation
  3.2.3.1 Framework and Technology Stack
  3.2.3.2 API Layer and Endpoint Design
  3.2.3.3 Request Processing and Validation Workflow
  3.2.3.4 Workspace Analysis and Stage Validation Logic
  3.2.3.5 Image Processing Service Architecture
  3.2.3.6 Model Building and Training Service
  3.2.3.7 Data Storage and Session Management
  3.2.3.8 Error Handling and Exception Patterns

3.2.4 Module-Specific Workflows
  3.2.4.1 Module 1: Dataset Exploration Workflow
  3.2.4.2 Module 2: Image Preprocessing Pipeline
  3.2.4.3 Module 3: Model Building and Training Workflow
```

---

## Important Technical Details for Thesis Discussion

### 1. **Fixed Input Shape Standardization**
- **Implementation Detail:** Module 2 preprocessing always produces 150×150×3 images
- **Backend Implementation:** [apps/api/app/services/model_service.py](apps/api/app/services/model_service.py) function `_infer_input_shape()` hardcodes (150, 150, 3)
- **Why It Matters:** Enables simplified model architecture in Module 3; removes need for dynamic input shape handling
- **Evidence:** Line: `return 150, 150, 3` (hardcoded)

### 2. **In-Session Model Persistence**
- **Implementation Detail:** Models stored in memory during session only
- **Storage Locations:** `_ACTIVE_MODELS[dataset_key]` dictionary
- **Limitation:** Models lost on server restart or session end
- **Alternative:** Can save to disk via `/model/save` endpoint → HDF5 files
- **Why It Matters:** Reduces disk I/O for temporary student models; requires disk save for model persistence

### 3. **Deterministic Workspace Signatures**
- **Implementation Detail:** Canonical JSON → SHA256 hash for workspace state
- **Location:** [apps/api/app/routes/analyzer.py](apps/api/app/routes/analyzer.py) function `analyze_workspace()`
- **Purpose:** Cache validation results; track workspace changes
- **Calculation:** `canonical = json.dumps(sorted request, sort_keys=True); sig = hashlib.sha256(canonical.encode()).hexdigest()`

### 4. **Sequential Operation Pipeline Architecture**
- **Implementation Detail:** Operations applied in strict order via `apply_pipeline(before_img, ops_list)`
- **Location:** [apps/api/app/services/image_ops.py](apps/api/app/services/image_ops.py)
- **Pattern:** Each op takes input image → produces output image → passed to next op
- **Why It Matters:** Enables predictable results; order affects outcome (e.g., normalize before/after resize produces different results)

### 5. **Module-Specific Block Namespacing**
- **Implementation Detail:** Blocks prefixed with module: `m2.*`, `m3.*`, `m4.*`
- **Toolbox Separation:** Three separate toolbox files per module
- **Why It Matters:** Prevents block cross-contamination; enables module-scoped validation
- **Evidence:** [apps/web/src/components/toolboxModule2.ts](apps/web/src/components/toolboxModule2.ts) vs. [apps/web/src/components/toolboxModule4.ts](apps/web/src/components/toolboxModule4.ts)

### 6. **Pydantic Validation on API Boundary**
- **Implementation Detail:** All requests validated via Pydantic BaseModel
- **Example:** [apps/api/app/routes/preprocess.py](apps/api/app/routes/preprocess.py) `ApplyRequest` model
- **Benefit:** Type-safe, auto-documented, consistent error responses
- **Why It Matters:** Prevents invalid data from reaching business logic; centralizes validation

### 7. **Asynchronous Server Architecture**
- **Framework:** FastAPI with Uvicorn ASGI
- **Async Support:** Built-in for high concurrency (though current handlers are mostly sync due to blocking I/O)
- **Why It Matters:** Enables multiple simultaneous student sessions; scales to classroom use

### 8. **Color-Coded Block Categories**
- **Implementation Detail:** Each category assigned HEX color code
- **Examples:**
  - Datasets: #0ea5e9 (blue)
  - Preprocessing: #a78bfa (violet)
  - Model: #8b5cf6 (purple)
  - Training: #06b6d4 (cyan)
- **Why It Matters:** Visual distinction aids navigation; supports cognitive categorization
- **Evidence:** [apps/web/src/components/toolboxModule2.ts](apps/web/src/components/toolboxModule2.ts) colour properties

### 9. **Multi-Turn Conversation History (AI-specific—EXCLUDED)**
- **Implementation Detail:** Conversations stored in `_ChatSession` with turn limit
- **Limit:** Last 200 turns retained (not documented for non-AI methodology)
- **Why Excluded:** Related to hint generation logic

### 10. **Dataset Index Lazy Loading**
- **Implementation Detail:** Datasets indexed in background thread on startup
- **Location:** [apps/api/app/main.py](apps/api/app/main.py) `_warmup()` function
- **Configuration:** Can be disabled via `API_WARMUP_DATASETS=0` environment variable
- **Why It Matters:** Speeds up first dataset access; shows performance optimization pattern

### 11. **Class Imbalance Detection Algorithm**
- **Implementation Detail:** Per-class count comparison to detect bias
- **Location:** [apps/api/app/services/split_service.py](apps/api/app/services/split_service.py) function `check_bias_train()`
- **Threshold:** Configurable percentage (default 10%)
- **Calculation:** If min_class_count ≤ threshold% of max_class_count → flag as imbalanced
- **Why It Matters:** Educates students about data bias; demonstrates real ML concern

### 12. **Operation Parameters as Dictionary Structures**
- **Implementation Detail:** All ops represented as `Dict[str, Any]` with type field
- **Example:** `{"type": "brightness_contrast", "b": 10, "c": 10}`
- **Benefit:** Flexible, extensible, easy to add new ops
- **Pattern:** Frontend → Backend passes op list; backend applies each

### 13. **Block Info Icons with Custom Events**
- **Implementation Detail:** Info icons dispatch `vb:blockInfo` custom events
- **Location:** [apps/web/src/lib/blockly/index.ts](apps/web/src/lib/blockly/index.ts) `appendInfo()` function
- **Pattern:** Click icon → `window.dispatchEvent()` → listener shows modal
- **Why It Matters:** Decouples block definition from UI rendering; enables modular component design

### 14. **Blockly Theme Customization**
- **Implementation Detail:** Two themes (Light/Dark) with custom colors
- **Location:** [apps/web/src/lib/blockly/theme.ts](apps/web/src/lib/blockly/theme.ts)
- **Customization Points:** Workspace color, toolbox color, insertion marker, cursor
- **Why It Matters:** Consistent visual identity; supports accessibility (high contrast Dark theme)

### 15. **Error Message Localization Pattern**
- **Implementation Detail:** Error messages in user-friendly language
- **Example:** "Invalid path" instead of "security.ValueError: path traversal detected"
- **Pattern:** Catch internal exception → convert to user message → HTTP 400
- **Why It Matters:** Improves UX; hides implementation details from students

---

## Validation and Quality Assurance Patterns

### Testing Configuration
**File:** [apps/api/pytest.ini](apps/api/pytest.ini)
**Contains:** Test discovery patterns, pytest configuration

### Type Safety
- **Frontend:** TypeScript strict mode enabled (tsconfig.json)
- **Backend:** Type hints throughout (Python 3.8+)

### Linting
- **Frontend:** ESLint configured ([apps/web/eslint.config.mjs](apps/web/eslint.config.mjs))
- **Backend:** No explicit linter in requirements, but code follows PEP-8 patterns

---

**END OF TECHNICAL EXTRACTION**

---

*Document Generated:* May 31, 2026  
*Extraction Scope:* Codebase analysis with factual implementation details  
*AI Logic:* Excluded per user specification  
*File References:* All linked with workspace-relative paths
