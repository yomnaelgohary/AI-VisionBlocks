# VisionBlocks

## System Requirements

### Frontend (Next.js)
**Technologies / packages**
- Next.js (React)
- Tailwind CSS
- Blockly
- Framer Motion
- Lucide Icons

**Required software**
- Node.js **18+** (recommended LTS)
- npm (or yarn/pnpm)

---

### Backend (FastAPI)
**Technologies / packages**
- FastAPI
- Uvicorn
- OpenCV (`opencv-python`)
- NumPy
- Pillow

**Required software**
- Python **3.10+**
- pip + virtual environments (venv)

**Important note (training / model features)**
- The API code includes TensorFlow/Keras imports for model build, training, and evaluation.
- If you intend to use these endpoints, you may need to install:
  - `tensorflow`

---

## How to Run (Windows PowerShell)

You will run **two servers**:
- Backend (FastAPI): `http://localhost:8000`
- Frontend (Next.js): `http://localhost:3000`

---

### 1) Run the Backend

```powershell
cd apps/api

# Create virtual environment
python -m venv .venv

# Activate virtual environment (PowerShell)
.\.venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# required for using model training/evaluation endpoints), since it'a not in the requirements file
pip install tensorflow

# Start the API server
uvicorn app.main:app --reload --port 8000
```

### 2) Run the Frontend

```powershell
cd apps/web
npm install
npm run dev
```



