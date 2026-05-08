"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceSvg, Block as BlocklyBlock } from "blockly";
import { Blockly, setDatasetOptions } from "@/lib/blockly";
import { LightTheme } from "@/lib/blockly/theme";
import { toolboxJsonModule4 } from "@/components/toolboxModule4";

import OutputPanel, { type LogItem } from "@/components/OutputPanel";
import PixelwiseCharacter from "@/components/PixelwiseCharacter";
import InfoModal from "@/components/InfoModal";
import SubmissionModal from "@/components/SubmissionModal";
import MissionChecklistStage, {
  type StageChecklistItem,
  type Tri,
} from "@/components/MissionChecklistStage";

import {
  module4Stages,
  type StageConfig,
} from "@/data/module4Stages";

const API_BASE = process.env.NEXT_PUBLIC_API_URL;

/* ----------------- HTTP helper ----------------- */
async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* ----------------- API types ----------------- */
type DatasetListItem = { key: string; name: string };
type DatasetListResponse = { items: DatasetListItem[] };

type SplitApplyResp = {
  dataset_key: string;
  train_pct: number;
  classes: string[];
  train: { size: number; per_class: Record<string, number> };
  test: { size: number; per_class: Record<string, number> };
  note?: string;
};

type SplitStateResp = {
  dataset_key: string;
  train_pct: number | null;
  classes: string[];
  train: { size: number; per_class: Record<string, number> };
  test: { size: number; per_class: Record<string, number> };
};

type ModelBuildResp = {
  ok: boolean;
  name: string;
  input_shape: [number, number, number];
  num_classes: number;
  summary_lines?: string[];
  diagram_data_url?: string | null;
};

type TrainResp = {
  ok: boolean;
  epochs: { epoch: number; train_acc: number; train_loss: number }[];
};

type EvalResp = {
  ok: boolean;
  accuracy: number;
  per_class: { name: string; acc: number }[];
  confusion_data_url?: string | null;
};

type PredictResp = {
  ok: boolean;
  class: string;
  confidence: number;
};

type SampleResp = {
  dataset_key: string;
  index_used: number;
  label: string;
  image_data_url: string;
  path: string;
};

type AnalyzerBlock = { type: string; fields: Record<string, unknown> };
type AnalyzerChain = { top_block_type: string | null; blocks: AnalyzerBlock[] };
type AnalyzeAgentReq = {
  chains: AnalyzerChain[];
  client_signature?: string;
  user_id?: string;
  stage_id?: string;
};
type AnalyzeAgentResp = {
  analyzer: { signature: string };
  agent_text: string;
};

type ChatRole = "user" | "assistant";

type ChatEntry = {
  ts: number;
  role: ChatRole;
  text: string;
  source?: "hint" | "chat";
};

/* ----------------- Basic block helpers ----------------- */

function getAllBlocks(ws: WorkspaceSvg | null): BlocklyBlock[] {
  if (!ws) return [];
  return ws.getAllBlocks(false) as BlocklyBlock[];
}

function findFirstByType(ws: WorkspaceSvg | null, type: string): BlocklyBlock | null {
  const blocks = getAllBlocks(ws);
  return blocks.find((b) => b.type === type) || null;
}

function findAllByType(ws: WorkspaceSvg | null, type: string): BlocklyBlock[] {
  return getAllBlocks(ws).filter((b) => b.type === type);
}

function walkChain(top: BlocklyBlock | null): BlocklyBlock[] {
  const chain: BlocklyBlock[] = [];
  for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
    chain.push(b);
  }
  return chain;
}

function getTopChains(ws: WorkspaceSvg): BlocklyBlock[][] {
  const tops = ws.getTopBlocks(true) as BlocklyBlock[];
  const chains: BlocklyBlock[][] = [];
  for (const top of tops) {
    const chain: BlocklyBlock[] = [];
    for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
      chain.push(b);
    }
    chains.push(chain);
  }
  return chains;
}

function blockToAnalyzerModel(b: BlocklyBlock): AnalyzerBlock {
  const fields: Record<string, unknown> = {};
  for (const input of b.inputList || []) {
    for (const field of input.fieldRow || []) {
      const name = (field as any).name as string | undefined;
      if (!name) continue;
      fields[name] = (field as any).getValue?.() ?? (field as any).getText?.();
    }
  }
  return { type: b.type, fields };
}

/**
 * "Main pipeline" for this mission:
 *  - Find dataset.select
 *  - Climb to the top-most block in that stack
 *  - Walk next→next→next
 */
function getMainChain(ws: WorkspaceSvg | null): BlocklyBlock[] {
  if (!ws) return [];
  const dsBlock = findFirstByType(ws, "dataset.select");
  if (!dsBlock) return [];

  let top: BlocklyBlock = dsBlock;
  while (top.getPreviousBlock()) {
    const prev = top.getPreviousBlock();
    if (!prev) break;
    top = prev;
  }
  return walkChain(top);
}

/* ----------------- Baymax mood ----------------- */
type BaymaxMood = "neutral" | "hint" | "warning" | "success" | "error";

function pickLine(options: string[], key: string): string {
  if (!options.length) return "";
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % options.length;
  return options[idx];
}

/* ----------------- Checklist (chain-aware) ----------------- */

function computeChecklist(
  ws: WorkspaceSvg | null,
  stage: StageConfig
): StageChecklistItem[] {
  const items: StageChecklistItem[] = [];
  if (!ws) return items;

  const mainChain = getMainChain(ws);
  const mainTypes = mainChain.map((b) => b.type);
  const mainIndexOf = (t: string) => mainTypes.indexOf(t);

  const allBlocks = getAllBlocks(ws);
  const existsAnywhere = (t: string) => allBlocks.some((b) => b.type === t);

  const expected =
    stage.expectedOrder && stage.expectedOrder.length
      ? stage.expectedOrder
      : stage.requiredBlocks;

  // ---- 1) coarse global order check (like before) ----
  const orderOK = new Map<string, boolean>();
  if (expected.length > 0) {
    let lastIdx = -1;
    for (const t of expected) {
      const idx = mainIndexOf(t);
      if (idx === -1) continue;
      const ok = idx > lastIdx;
      orderOK.set(t, ok);
      if (ok) lastIdx = idx;
    }
  }

  // ---- 2) fine-grained adjacency check (NEW) ----
  // If a type ever appears as the *second* block in an illegal pair,
  // we mark that type as "locally wrong".
  const adjacencyBad = new Map<string, boolean>();

  const ORDER: Record<string, string[]> = {
    "dataset.select": ["m3.set_split_ratio"],
    "m3.set_split_ratio": ["m3.apply_split"],
    "m3.apply_split": ["m4.model_init"],
    "m4.model_init": ["m4.layer_conv2d"],
    "m4.layer_conv2d": ["m4.layer_pool"],
    "m4.layer_pool": ["m4.layer_conv2d", "m4.layer_dense"],
    "m4.layer_dense": ["m4.layer_dense", "m4.model_summary"],
    "m4.model_summary": ["m4.train_hparams"],
    "m4.train_hparams": ["m4.train_start"],
    "m4.train_start": ["m4.eval_test"],
    "m4.eval_test": ["dataset.sample_image"],
    "dataset.sample_image": ["m4.predict_sample"],
    // after m4.predict_sample we don't enforce anything
  };

  for (let i = 0; i < mainTypes.length - 1; i++) {
    const current = mainTypes[i];
    const next = mainTypes[i + 1];
    const allowedNext = ORDER[current];

    if (allowedNext && allowedNext.length > 0 && !allowedNext.includes(next)) {
      // "next" is the offending block – its *type* is locally wrong.
      adjacencyBad.set(next, true);
    }
  }

  // ---- 3) combine both checks into the tri-state items ----
  for (const t of stage.requiredBlocks) {
    const inMainChain = mainIndexOf(t) !== -1;
    const inOrder = !!orderOK.get(t);
    const localBad = !!adjacencyBad.get(t);

    let state: Tri;
    if (!inMainChain) {
      // Block is either missing entirely or floating off the main chain.
      state = "missing";
    } else if (!inOrder || localBad) {
      // It’s in the main chain, but either out of global order
      // OR appears at least once as the second element of an illegal pair.
      state = "wrong_place";
    } else {
      state = "ok";
    }

    items.push({
      key: t,
      label: t
        .replace(/^m3\./, "")
        .replace(/^m4\./, "")
        .replace(/^dataset\./, "")
        .replaceAll("_", " "),
      state,
    });
  }

  return items;
}


/**
 * Model 3 strict ordering rules
 * Returns structural hints for Baymax:
 *  - okUntil: last index where order is correct
 *  - wrongBlock: first block that violates ordering
 *  - expectedNext: the ONLY allowed next block type(s)
 */
function computeModel3OrderHints(chain: BlocklyBlock[]) {
  const TYPES = chain.map(b => b.type);

  // Define allowed sequential transitions
  const ORDER: Record<string, string[]> = {
    "dataset.select": ["m3.set_split_ratio"],
    "m3.set_split_ratio": ["m3.apply_split"],
    "m3.apply_split": ["m4.model_init"],
    "m4.model_init": ["m4.layer_conv2d"],
    "m4.layer_conv2d": ["m4.layer_pool"],
    "m4.layer_pool": ["m4.layer_conv2d", "m4.layer_dense"],
    "m4.layer_dense": ["m4.layer_dense", "m4.model_summary"],
    "m4.model_summary": ["m4.train_hparams"],
    "m4.train_hparams": ["m4.train_start"],
    "m4.train_start": ["m4.eval_test"],
    "m4.eval_test": ["dataset.sample_image"],
    "dataset.sample_image": ["m4.predict_sample"]
  };

  // Walk from top to bottom
  for (let i = 0; i < TYPES.length - 1; i++) {
    const current = TYPES[i];
    const next = TYPES[i + 1];
    const expected = ORDER[current] || [];

    if (!expected.includes(next)) {
      return {
        okUntil: i,
        wrongBlock: next,
        expectedNext: expected,
      };
    }
  }

  return {
    okUntil: TYPES.length - 1,
    wrongBlock: null,
    expectedNext: null,
  };
}


/* ----------------- Model spec builder ----------------- */

type LayerSpecJSON = {
  type: string;
  params: Record<string, any>;
};

type ModelSpecJSON = {
  name: string;
  layers: LayerSpecJSON[];
};

function buildModelSpecFromWorkspace(ws: WorkspaceSvg | null): ModelSpecJSON | null {
  if (!ws) return null;

  const mainChain = getMainChain(ws);
  const initBlock = mainChain.find((b) => b.type === "m4.model_init");
  if (!initBlock) return null;

  const name = (initBlock.getFieldValue("NAME") as string) || "my-model";
  const layers: LayerSpecJSON[] = [];

  let b: BlocklyBlock | null = initBlock.getNextBlock();
  while (b) {
    if (b.type === "m4.layer_conv2d") {
      const filters = Number(b.getFieldValue("FILTERS") || 32);
      const kernel = Number(b.getFieldValue("KERNEL") || 3);
      const stride = Number(b.getFieldValue("STRIDE") || 1);
      const padding = (b.getFieldValue("PADDING") as string) || "same";
      const activation = (b.getFieldValue("ACTIVATION") as string) || "relu";
      layers.push({
        type: "conv2d",
        params: { filters, kernel, stride, padding, activation },
      });
    } else if (b.type === "m4.layer_pool") {
      const kind = (b.getFieldValue("KIND") as string) || "max";
      const size = Number(b.getFieldValue("SIZE") || 2);
      layers.push({
        type: "pool",
        params: { kind, size },
      });
    } else if (b.type === "m4.layer_dense") {
      const units = Number(b.getFieldValue("UNITS") || 128);
      const activation = (b.getFieldValue("ACTIVATION") as string) || "relu";
      layers.push({
        type: "dense",
        params: { units, activation },
      });
    } else if (b.type === "m4.model_summary") {
      // purely a “trigger” block; ignore structurally
    }
    b = b.getNextBlock();
  }

  return { name, layers };
}

/* ----------------- Dataset + params helpers ----------------- */

function getDatasetKey(ws: WorkspaceSvg | null): string | null {
  const dsBlock = findFirstByType(ws, "dataset.select");
  if (!dsBlock) return null;
  const key = dsBlock.getFieldValue("DATASET") as string;
  return key || null;
}

/**
 * Read train_pct from set-split block, robustly.
 */
function getTrainPct(ws: WorkspaceSvg | null): number | null {
  const splitBlock = findFirstByType(ws, "m3.set_split_ratio");
  if (!splitBlock) return null;

  const candidates: Array<string | number | null | undefined> = [
    splitBlock.getFieldValue("TRAIN_PCT"),
    splitBlock.getFieldValue("PCT"),
    splitBlock.getFieldValue("TRAIN"),
    splitBlock.getFieldValue("TRAIN_PERCENT"),
  ];

  let raw: string | number | null | undefined = candidates.find(
    (v) => v !== null && v !== undefined && String(v).trim() !== ""
  );

  let pct = Number(raw);
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
    // fallback: parse from block label text
    try {
      const txt = (splitBlock as any).toString?.();
      if (txt && typeof txt === "string") {
        const m = txt.match(/(\d+)\s*%/);
        if (m) pct = Number(m[1]);
      }
    } catch {
      // ignore
    }
  }

  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return null;
  return pct;
}

function getTrainParams(ws: WorkspaceSvg | null): { epochs: number; batch: number } {
  const hpBlock = findFirstByType(ws, "m4.train_hparams");
  if (!hpBlock) return { epochs: 5, batch: 32 };

  const epochsVal = hpBlock.getFieldValue("EPOCHS") || 5;
  const batchVal = hpBlock.getFieldValue("BATCH") || 32;
  let epochs = Number(epochsVal);
  let batch = Number(batchVal);
  if (!Number.isFinite(epochs) || epochs <= 0) epochs = 5;
  if (!Number.isFinite(batch) || batch <= 0) batch = 32;
  return { epochs, batch };
}

function getSampleConfig(
  ws: WorkspaceSvg | null
): { mode: "random" | "index"; index?: number } | null {
  if (!ws) return null;
  const b = findFirstByType(ws, "dataset.sample_image");
  if (!b) return null;
  const mode = (b.getFieldValue("MODE") as "random" | "index") || "random";
  const raw = b.getFieldValue("INDEX");
  const idx =
    typeof raw === "number"
      ? raw
      : parseInt(String(raw || 0), 10) || 0;
  return mode === "index" ? { mode, index: idx } : { mode };
}

/* ----------------- Component ----------------- */

export default function StageRunner({ stageId }: { stageId: string }) {
  const router = useRouter();

  const stage: StageConfig | undefined = useMemo(
    () => module4Stages.find((s) => String(s.id) === String(stageId)),
    [stageId]
  );

  const currentIndex = useMemo(
    () => module4Stages.findIndex((s) => String(s.id) === String(stageId)),
    [stageId]
  );
  const nextStage = currentIndex >= 0 ? module4Stages[currentIndex + 1] : undefined;

  const blocklyDivRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<WorkspaceSvg | null>(null);

  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([]);

  const [baymax, setBaymax] = useState<string>(
    "This mission is all about building and testing a full model pipeline. Start by using the blocks in this stage under the dataset block."
  );
  const [baymaxMood, setBaymaxMood] = useState<BaymaxMood>("neutral");
  const [baymaxTyping, setBaymaxTyping] = useState<boolean>(false);
  const [baymaxBump, setBaymaxBump] = useState(false);
  const lastBaymaxTextRef = useRef<string>("");
  const [aiAssistantText, setAiAssistantText] = useState<string>(
    "LLM assistant is waiting for your edits..."
  );
  const [aiAssistantLoading, setAiAssistantLoading] = useState(false);
  const [agentHistory, setAgentHistory] = useState<ChatEntry[]>([]);
  const [agentHistoryOpen, setAgentHistoryOpen] = useState(false);
  // Module 4 chat UI state (FAB + drawer)
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const [hintReady, setHintReady] = useState(false);
  const [hintThinking, setHintThinking] = useState(false);

  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTitle, setInfoTitle] = useState<string>();
  const [infoText, setInfoText] = useState<string>();

  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitTitle, setSubmitTitle] = useState("Submission");
  const [submitLines, setSubmitLines] = useState<string[]>([]);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [stageCompleteToast, setStageCompleteToast] = useState(false);
  const [stageConfetti, setStageConfetti] = useState(false);
  const stageToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageCompleteShownRef = useRef(false);

  const [canGoNext, setCanGoNext] = useState(false);
  const [checkItems, setCheckItems] = useState<StageChecklistItem[]>([]);
  const m4AgentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const m4AgentTokenRef = useRef(0);
  const m4AgentSigRef = useRef("");

  const assistantHistoryKey = `vb_module4_stage${String(stageId)}_history`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(assistantHistoryKey);
      if (!raw) {
        setAgentHistory([]);
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setAgentHistory([]);
        return;
      }

      const normalized = parsed
        .map((item: any) => {
          if (!item || typeof item !== "object") return null;
          const text = String(item.text ?? item.content ?? "").trim();
          if (!text) return null;

          const role: ChatRole =
            item.role === "user" || text.startsWith("User:")
              ? "user"
              : "assistant";
          const cleaned = text.startsWith("User:")
            ? text.replace(/^User:\s*/i, "")
            : text.startsWith("Assistant:")
            ? text.replace(/^Assistant:\s*/i, "")
            : text;

          return {
            ts: Number(item.ts) || Date.now(),
            role,
            text: cleaned,
            source: item.source === "chat" ? "chat" : "hint",
          } satisfies ChatEntry;
        })
        .filter(Boolean) as ChatEntry[];

      setAgentHistory(normalized);
    } catch {
      setAgentHistory([]);
    }
  }, [assistantHistoryKey]);

  function persistAssistantHistory(text: string) {
    const trimmed = text.trim();
    if (!trimmed || trimmed === "Thinking...") return;
    if (trimmed.startsWith("LLM assistant is waiting")) return;
    appendChatEntry({ ts: Date.now(), role: "assistant", text: trimmed, source: "hint" });
  }

  function appendChatEntry(entry: ChatEntry) {
    setAgentHistory((prev) => {
      const next = [...prev, entry].slice(-200);
      try {
        window.localStorage.setItem(assistantHistoryKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  useEffect(() => {
    if (!chatPanelOpen || !chatContainerRef.current) return;
    const timer = setTimeout(() => {
      try {
        chatContainerRef.current?.scrollTo({
          top: chatContainerRef.current.scrollHeight,
          behavior: "smooth",
        });
      } catch {}
    }, 0);
    return () => clearTimeout(timer);
  }, [chatPanelOpen, agentHistory, chatSending, aiAssistantLoading, hintThinking]);

  useEffect(() => {
    if (!stage || checkItems.length === 0) return;
    const allOk = checkItems.every((i) => i.state === "ok");
    if (allOk && !stageCompleteShownRef.current) {
      stageCompleteShownRef.current = true;
      if (stageToastTimerRef.current) {
        clearTimeout(stageToastTimerRef.current);
      }
      setStageCompleteToast(true);
      setStageConfetti(true);
      stageToastTimerRef.current = setTimeout(() => {
        setStageCompleteToast(false);
        setStageConfetti(false);
      }, 7000);
    }
    if (!allOk) {
      stageCompleteShownRef.current = false;
    }
  }, [stage, checkItems]);

  useEffect(() => {
    stageCompleteShownRef.current = false;
    if (stageToastTimerRef.current) {
      clearTimeout(stageToastTimerRef.current);
    }
    setStageCompleteToast(false);
    setStageConfetti(false);
  }, [stageId]);

  // Send chat message to Module 4 backend
  async function sendChatMessage(text: string) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    const ws = workspaceRef.current;

    const chains = (ws && getTopChains(ws).map((chain) => ({
      top_block_type: chain[0]?.type || null,
      blocks: chain.map((b) => blockToAnalyzerModel(b)),
    }))) || [];

    const payload = {
      user_id: window.localStorage.getItem("vb_user_id") || "anon",
      message: trimmed,
      workspace_state: { chains },
    };

    appendChatEntry({ ts: Date.now(), role: "user", text: trimmed, source: "chat" });
    setChatInput("");
    setChatSending(true);
    setAiAssistantText("Thinking...");
    setAiAssistantLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/module4/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || resp.statusText);
      }
      const data = await resp.json();
      const assistant = (data.assistant_response || "").toString();
      if (assistant) {
        persistAssistantHistory(assistant);
        setAiAssistantText(assistant);
        setAiAssistantLoading(false);
        setHintReady(false);
      }
    } catch (e: any) {
      const msg = (e?.message || "Request failed").toString();
      const errorText = `Error: ${msg}`;
      setAiAssistantText(errorText);
      setAiAssistantLoading(false);
      appendChatEntry({ ts: Date.now(), role: "assistant", text: errorText, source: "chat" });
    } finally {
      setChatSending(false);
      setAiAssistantLoading(false);
    }
  }

  /* ---------- Global CSS for glow + Baymax animation ---------- */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const existing = document.getElementById("vb-m4-style");
    if (existing) return;

    const style = document.createElement("style");
    style.id = "vb-m4-style";
    style.textContent = `
      @keyframes vb-m4-breathe {
        0%   { filter: drop-shadow(0 0 0 rgba(251,191,36,0)); }
        50%  { filter: drop-shadow(0 0 12px rgba(251,191,36,0.85)); }
        100% { filter: drop-shadow(0 0 22px rgba(251,191,36,1)); }
      }
      .vb-m4-glow-block .blocklyPath {
        stroke: #fbbf24 !important;
        stroke-width: 2.4px;
        animation: vb-m4-breathe 1.6s ease-in-out infinite alternate;
      }

      @keyframes vb-baymax-pop {
        0%   { transform: translateY(0) scale(1); box-shadow: 0 0 0 0 rgba(56,189,248,0); }
        35%  { transform: translateY(-6px) scale(1.04); box-shadow: 0 14px 30px rgba(56,189,248,0.7); }
        100% { transform: translateY(0) scale(1); box-shadow: 0 0 0 0 rgba(56,189,248,0); }
      }
      @keyframes vb-think-dot {
        0%, 100% { transform: translateY(0); opacity: 0.45; }
        50% { transform: translateY(-2px); opacity: 1; }
      }
      @keyframes vb-achieve-pop {
        0% { transform: translateY(8px) scale(0.92); opacity: 0; }
        60% { transform: translateY(0) scale(1.02); opacity: 1; }
        100% { transform: translateY(0) scale(1); opacity: 1; }
      }
      @keyframes vb-achieve-glow {
        0%, 100% { box-shadow: 0 22px 60px rgba(15,23,42,0.18); }
        50% { box-shadow: 0 28px 80px rgba(56,189,248,0.32); }
      }
      @keyframes vb-achieve-sparkle {
        0% { transform: scale(0.2) rotate(0deg); opacity: 0; }
        40% { opacity: 0.9; }
        100% { transform: scale(1.1) rotate(18deg); opacity: 0; }
      }
      @keyframes vb-confetti-fall {
        0% { transform: translateY(-10vh) rotate(0deg); opacity: 0; }
        10% { opacity: 1; }
        100% { transform: translateY(110vh) rotate(240deg); opacity: 0; }
      }
      .vb-confetti-layer {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 998;
        overflow: hidden;
      }
      .vb-confetti-piece {
        position: absolute;
        top: -10vh;
        width: 8px;
        height: 14px;
        border-radius: 2px;
        animation: vb-confetti-fall 3.6s linear forwards;
      }
      .vb-achieve-card {
        animation: vb-achieve-pop 0.45s ease-out, vb-achieve-glow 2.4s ease-in-out infinite;
      }
      .vb-achieve-sparkle {
        position: absolute;
        width: 16px;
        height: 16px;
        border-radius: 4px;
        background: radial-gradient(circle, rgba(251,191,36,0.9) 0%, rgba(56,189,248,0.9) 50%, rgba(255,255,255,0) 70%);
        animation: vb-achieve-sparkle 1.6s ease-in-out infinite;
        opacity: 0;
      }
      .vb-achieve-sparkle-1 { top: -8px; left: 20px; animation-delay: 0.1s; }
      .vb-achieve-sparkle-2 { top: 10px; right: 28px; animation-delay: 0.4s; }
      .vb-achieve-sparkle-3 { bottom: -6px; left: 40%; animation-delay: 0.7s; }
      .vb-achieve-sparkle-4 { bottom: 12px; right: 18px; animation-delay: 0.9s; }
      .vb-baymax-bump {
        animation: vb-baymax-pop 0.5s ease-out;
      }
    `;
    document.head.appendChild(style);
  }, []);

  function setBaymaxState(text: string, mood: BaymaxMood, typing: boolean) {
    setBaymax(text);
    setBaymaxMood(mood);
    setBaymaxTyping(typing);

    if (text !== lastBaymaxTextRef.current) {
      lastBaymaxTextRef.current = text;
      setBaymaxBump(false);
      requestAnimationFrame(() => {
        setBaymaxBump(true);
        setTimeout(() => setBaymaxBump(false), 500);
      });
    }
  }

  /* ---------- Dataset dropdown ---------- */
  useEffect(() => {
    async function loadDatasets() {
      try {
        const resp = await fetchJSON<DatasetListResponse>(`${API_BASE}/datasets`);
        const items = resp.items ?? [];
        if (items.length > 0) {
          setDatasetOptions(
            items.map((d) => ({
              name: d.name,
              key: d.key,
            }))
          );
        }
      } catch {
        // ignore, keep defaults
      }
    }
    loadDatasets();
  }, []);

  /* ---------- Glow required blocks in toolbox ---------- */
  function updateToolboxGlow() {
    const wsAny = workspaceRef.current as any;
    if (!wsAny || !stage) return;

    const flyout =
      wsAny.getFlyout?.() ||
      wsAny.toolbox_?.flyout_ ||
      wsAny.toolbox_?.getFlyout?.();
    if (!flyout) return;

    const flyWs = flyout.getWorkspace?.();
    if (!flyWs) return;

    const required = new Set<string>(stage.requiredBlocks || []);
    const topBlocks = flyWs.getTopBlocks(false) || [];

    topBlocks.forEach((b: any) => {
      const svgRoot = b.getSvgRoot?.();
      if (!svgRoot) return;

      if (required.has(b.type)) {
        svgRoot.classList.add("vb-m4-glow-block");
      } else {
        svgRoot.classList.remove("vb-m4-glow-block");
      }
    });
  }

  function requestStageAgentHintDebounced(ws: WorkspaceSvg) {
    if (!stage) return;
    const currentStageId = String(stage.id);
    if (!["1", "2", "3"].includes(currentStageId)) return;

    if (m4AgentTimerRef.current) clearTimeout(m4AgentTimerRef.current);
    m4AgentTimerRef.current = setTimeout(async () => {
      const chains = getTopChains(ws).map((chain): AnalyzerChain => ({
        top_block_type: chain[0]?.type || null,
        blocks: chain.map((b) => blockToAnalyzerModel(b)),
      }));

      const payload: AnalyzeAgentReq = {
        chains,
        stage_id: currentStageId,
        client_signature: `module4-stage${currentStageId}-live`,
        user_id: window.localStorage.getItem("vb_user_id") || "anon",
      };

      const sig = JSON.stringify(payload);
      if (sig === m4AgentSigRef.current) return;
      m4AgentSigRef.current = sig;
      const myToken = ++m4AgentTokenRef.current;

      try {
          // indicate thinking state for FAB
          setHintThinking(true);
          setAiAssistantLoading(true);
          const resp = await fetchJSON<AnalyzeAgentResp>(`${API_BASE}/analyze/module4/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (myToken !== m4AgentTokenRef.current) return;
        const text = (resp.agent_text || "").trim();
        if (!text) return;
        // Do not surface Module 4 hints in the Baymax/side panel; instead mark hint ready
        appendChatEntry({ ts: Date.now(), role: "assistant", text, source: "hint" });
        setHintReady(true);
        // keep the assistant text generic (so Baymax is not a duplicate hint display)
        setAiAssistantText(
          ["1", "2", "3"].includes(String(stage?.id))
            ? "LLM assistant is available for Module 4 guidance. Open chat for details."
            : "LLM assistant is available."
        );
      } catch (e: any) {
        if (myToken !== m4AgentTokenRef.current) return;
        const msg = (e?.message || "Request failed").toString();
        setAiAssistantText(`LLM error: ${msg}`);
        persistAssistantHistory(`LLM error: ${msg}`);
      } finally {
        if (myToken === m4AgentTokenRef.current) {
          setAiAssistantLoading(false);
          setHintThinking(false);
        }
      }
    }, 450);
  }

  /* ---------- Blockly inject + listeners ---------- */
  useEffect(() => {
    if (!stage || !blocklyDivRef.current) return;

    setLogs([]);
    setCanGoNext(false);
    m4AgentSigRef.current = "";
    setAiAssistantLoading(false);
    setAiAssistantText(
      ["1", "2", "3"].includes(String(stage.id))
        ? "LLM assistant is waiting for your edits..."
        : "LLM assistant is available for Stages 1, 2, and quiz."
    );
      setAgentHistory([]);

    const ws = Blockly.inject(blocklyDivRef.current, {
      toolbox: toolboxJsonModule4,
      renderer: "zelos",
      theme: LightTheme,
      trashcan: true,
      scrollbars: true,
      zoom: { controls: true, wheel: true, startScale: 0.9 },
    });

    workspaceRef.current = ws;
    try {
      (ws as any).scrollCenter?.();
    } catch {}

    // Seed workspace based on stage
    if (String(stage.id) === "2") {
      // Stage 2: pre-populate with Stage 1 blocks so user only adds training blocks
      const blocksToCreate = [
        "dataset.select",
        "m3.set_split_ratio",
        "m3.apply_split",
        "m4.model_init",
        "m4.layer_conv2d",
        "m4.layer_pool",
        "m4.layer_dense",
        "m4.model_summary",
      ];

      let previousBlock: BlocklyBlock | null = null;
      for (const blockType of blocksToCreate) {
        const newBlock = ws.newBlock(blockType);
        newBlock.initSvg();

        if (previousBlock && previousBlock.nextConnection && newBlock.previousConnection) {
          previousBlock.nextConnection.connect(newBlock.previousConnection);
        }

        newBlock.render();
        previousBlock = newBlock;
      }
    } else if (String(stage.id) === "3") {
      // Stage 3 quiz: create all required blocks as disconnected/scattered.
      const blocksToCreate = Array.from(new Set(stage.requiredBlocks || []));
      let row = 0;
      let col = 0;

      for (const blockType of blocksToCreate) {
        const newBlock = ws.newBlock(blockType);
        newBlock.initSvg();
        newBlock.render();

        // Position blocks more to the left and compact to fit better
        const x = 15 + col * 190 + (row % 2) * 10;
        const y = 40 + row * 85;
        try {
          newBlock.moveBy(x, y);
        } catch {
          // ignore placement issues and keep default Blockly placement
        }

        col += 1;
        if (col >= 3) {
          col = 0;
          row += 1;
        }
      }
    } else {
      // All other stages: just start with "use dataset"
      const ds = ws.newBlock("dataset.select");
      ds.initSvg();
      ds.render();
    }

    // Info events
    const onInfo = (e: any) => {
      const { title, text } = e?.detail ?? {};
      setInfoTitle(title || "About this block");
      setInfoText(text || "");
      setInfoOpen(true);
    };
    window.addEventListener("vb:blockInfo", onInfo as any);

    // On-change: recompute checklist, glow, Baymax and request agent hints.
    // Ignore pure UI events (these fire a lot during drag/selection) to avoid
    // duplicate agent requests for a single user action.
    const onChange = (e: any) => {
      // Blockly UI events are high-volume and not structural.
      if (e && e.type === (Blockly.Events as any).UI) return;

      setTimeout(() => {
        if (!workspaceRef.current || !stage) return;
        const items = computeChecklist(workspaceRef.current, stage);
        setCheckItems(items);
        updateToolboxGlow();
        updateBaymaxFromChecklist(stage, items);
        requestStageAgentHintDebounced(workspaceRef.current);
      }, 150);
    };
    ws.addChangeListener(onChange as any);

    const initialItems = computeChecklist(ws, stage);
    setCheckItems(initialItems);
    updateToolboxGlow();
    updateBaymaxFromChecklist(stage, initialItems, true);

    return () => {
      if (m4AgentTimerRef.current) clearTimeout(m4AgentTimerRef.current);
      window.removeEventListener("vb:blockInfo", onInfo as any);
      ws.removeChangeListener(onChange);
      ws.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageId]);

  function labelForTypeM4(type: string): string {
  switch (type) {
    case "dataset.select":
      return "use dataset";
    case "m3.set_split_ratio":
      return "set split ratio";
    case "m3.apply_split":
      return "apply split";
    case "m4.model_init":
      return "start new model";
    case "m4.layer_conv2d":
      return "add conv layer";
    case "m4.layer_pool":
      return "add pooling layer";
    case "m4.layer_dense":
      return "add dense layer";
    case "m4.model_summary":
      return "show model summary";
    case "m4.train_hparams":
      return "training setup";
    case "m4.train_start":
      return "start training";
    case "m4.eval_test":
      return "evaluate on test set";
    case "dataset.sample_image":
      return "get sample image";
    case "m4.predict_sample":
      return "predict current sample";
    default:
      return type
        .replace(/^m3\./, "")
        .replace(/^m4\./, "")
        .replace(/^dataset\./, "")
        .replaceAll("_", " ");
  }
}

/**
 * Walk the main chain top-to-bottom and enforce the strict ordering rules:
 * use dataset → set split ratio → apply split → start new model → conv → pool →
 * (conv or dense) → dense(s) → summary → training setup → start training →
 * evaluate on test set → get sample image → predict current sample
 *
 * Returns a sentence like:
 *  "After X I expected Y, but I see Z instead."
 */
function pipelineNextStepHintM4(): string | null {
  const ws = workspaceRef.current;
  if (!ws) return null;

  const chain = getMainChain(ws);
  if (!chain.length) return null;

  const types = chain.map((b) => b.type);

  const ORDER: Record<string, string[]> = {
    "dataset.select": ["m3.set_split_ratio"],
    "m3.set_split_ratio": ["m3.apply_split"],
    "m3.apply_split": ["m4.model_init"],
    "m4.model_init": ["m4.layer_conv2d"],
    "m4.layer_conv2d": ["m4.layer_pool"],
    "m4.layer_pool": ["m4.layer_conv2d", "m4.layer_dense"],
    "m4.layer_dense": ["m4.layer_dense", "m4.model_summary"],
    "m4.model_summary": ["m4.train_hparams"],
    "m4.train_hparams": ["m4.train_start"],
    "m4.train_start": ["m4.eval_test"],
    "m4.eval_test": ["dataset.sample_image"],
    "dataset.sample_image": ["m4.predict_sample"],
    // after m4.predict_sample we don't enforce anything
  };

  for (let i = 0; i < types.length - 1; i++) {
    const current = types[i];
    const next = types[i + 1];

    const expectedNext = ORDER[current];
    if (!expectedNext || expectedNext.length === 0) continue; // we don't care about this spot

    if (!expectedNext.includes(next)) {
      const prevLabel = `"${labelForTypeM4(current)}"`;
      const actLabel = `"${labelForTypeM4(next)}"`;

      const expLabels = expectedNext.map((t) => `"${labelForTypeM4(t)}"`);
      const expLabel =
        expLabels.length === 1
          ? expLabels[0]
          : expLabels.slice(0, -1).join(" or ") + " or " + expLabels.slice(-1);

      return `I’m reading your blocks from top to bottom. After ${prevLabel} I was expecting ${expLabel}, but I see ${actLabel} instead. Try moving ${expLabel} into this spot and sliding ${actLabel} further down.`;
    }
  }

  // no order violations found
  return null;
}


  /* ---------- Baymax from checklist ---------- */

function updateBaymaxFromChecklist(
  s: StageConfig,
  items: StageChecklistItem[],
  initial = false
) {
  const total = items.length;
  const done = items.filter((i) => i.state === "ok").length;
  const missing = items.filter((i) => i.state === "missing");
  const wrong = items.filter((i) => i.state === "wrong_place");
  const stageKey = String(s.id);
  const isMergedStage = stageKey === "2";

  if (stageKey === "3") {
    if (initial) {
      setBaymaxState(
        "Quiz mode: connect all scattered blocks into one clean pipeline from split to prediction.",
        "neutral",
        false
      );
      return;
    }

    if (done === total && total > 0) {
      setBaymaxState(
        "Excellent. The full quiz pipeline is complete and correctly arranged. Submit to validate.",
        "success",
        false
      );
      return;
    }

    setBaymaxState(
      `Quiz progress: ${done}/${total} correct in the main chain. Keep arranging blocks in workflow order.`,
      wrong.length > 0 ? "warning" : "hint",
      true
    );
    return;
  }

  if (initial) {
    const introLine =
      s.intro?.[0] ||
      "Build a single, straight pipeline under the dataset block: split, build the model, train it, then evaluate and predict.";
    setBaymaxState(introLine, "neutral", false);
    return;
  }

  if (total === 0) {
    setBaymaxState(
      "Drag in the blocks for this mission and connect them in one chain under the dataset block.",
      "hint",
      false
    );
    return;
  }

  // --- If any blocks are in the wrong order, use the top-to-bottom hint ---
  if (wrong.length > 0) {
    const seq = pipelineNextStepHintM4();
    if (seq) {
      setBaymaxState(seq, "warning", true);
      return;
    }

    // Fallback (should rarely happen)
    const labels = wrong.map((w) => w.label).join(", ");
    const lines = [
      `Some blocks are in the right chain but in the wrong order: ${labels}. Follow the “split → model → train → evaluate → predict” story from top to bottom.`,
      `Your pipeline has all the right ingredients, but they’re shuffled. Reorder the blocks so each step feeds into the next one logically.`,
    ];
    setBaymaxState(
      pickLine(lines, stageKey + "-wrong-fallback"),
      "warning",
      true
    );
    return;
  }

  // --- Missing required blocks (they’re not in the main chain at all) ---
  if (missing.length > 0) {
    const names = missing.map((m) => m.label).join(", ");

    const mergedLines = [
      `This merged stage still needs: ${names}. Add them after the model summary so you can train → evaluate → sample → predict.`,
      "After model summary, the flow should be: training setup → start training → evaluate on test set → get sample image → predict current sample.",
    ];

    const linesByStage: Record<string, string[]> = {
      split: [
        `We still need the split steps: ${names}. Place them right after “use dataset”.`,
        "This stage wants a clean split pipeline: use dataset → set split ratio → apply split. At least one of those is still missing from the chain.",
      ],
      model_build: [
        `Your model sketch is incomplete. Add the missing model blocks: ${names}.`,
        "For model building we expect: start new model → conv → pool → dense → model summary.",
      ],
      train: [
        `The training pipeline is missing. You should add the training blocks after the model summary.`,
        "Training needs the training setup and start training blocks connected after the model.",
      ],
      eval_predict: [
        `Evaluation/prediction is missing: ${names}. Those should come after training in the chain.`,
        "Evaluation and prediction blocks should appear at the end: evaluate → get sample image → predict current sample.",
      ],
    };

    const stageLines = isMergedStage
      ? mergedLines
      : linesByStage[s.type] || [
          `You’re still missing: ${names}. Add them into the main chain in their proper places.`,
          "Some stage blocks are still missing from your pipeline. Use the ordering story in the stage text as a guide.",
        ];

    setBaymaxState(
      pickLine(stageLines, stageKey + "-missing"),
      "hint",
      true
    );
    return;
  }

  // --- All checklist items structurally OK ---
  if (done === total && total > 0) {
    const mergedComplete = [
      "Great! Your merged pipeline is ready: train → evaluate → sample → predict. Submit & Run to see all results.",
      "Everything is in place to train, evaluate, and predict. You’re ready to run this full pipeline.",
    ];

    const completeByStage: Record<string, string[]> = {
      split: [
        "Nice, you’ve built a proper split pipeline. Submit & Run will divide the dataset into train and test sets.",
        "Split chain looks perfect: dataset → set split ratio → apply split. You’re ready to run it.",
      ],
      model_build: [
        "Great, your model-building pipeline is in the right order. Submit & Run will build the model and show the summary.",
        "Model sketch complete: conv, pool, dense, summary — all wired correctly. Time to build.",
      ],
      train: [
        "Your training pipeline is ready: model, training setup, and start training are all in sequence.",
        "Training story checks out. Submit & Run will start training with your chosen hyperparameters.",
      ],
      eval_predict: [
        "Evaluation and prediction blocks are in the right order. Submit & Run to evaluate on the test set and try a prediction.",
        "End-to-end evaluation pipeline looks good: evaluate → get sample image → predict current sample.",
      ],
    };

    const finalLines = isMergedStage
      ? mergedComplete
      : completeByStage[s.type] || [
          "All the blocks this stage cares about are present and in the right order. You’re good to Submit & Run.",
        ];

    setBaymaxState(pickLine(finalLines, stageKey + "-ok"), "success", false);
    return;
  }

  // --- Fallback "nearly there" ---
  const lines = [
    "You’re close. Follow the story from top to bottom: split the data, build the model, train it, then evaluate and predict.",
    "Almost there. Compare your pipeline to the intended order: split → model → train → evaluate → predict.",
    "You’re on the right track. If something feels off, think: what should happen immediately after this block?",
  ];
  setBaymaxState(
    pickLine(lines, stageKey + "-nearly-" + done),
    "neutral",
    true
  );
}


  /* ---------- Submit & Run: STAGE-AGNOSTIC EXECUTION ---------- */

  async function run() {
    if (!stage || !workspaceRef.current) return;
    setRunning(true);
    setBaymaxTyping(true);
    setSubmitOpen(false);

    const ws = workspaceRef.current;
    const newLogs: LogItem[] = [];
    const issues: string[] = [];

    try {
      // Always recompute checklist (for stage progress), but don't block execution with it.
      const itemsNow = computeChecklist(ws, stage);
      setCheckItems(itemsNow);

      const datasetKey = getDatasetKey(ws);
      if (!datasetKey) {
        issues.push("Add a 'use dataset' block and choose a dataset.");
      } else {
        const mainChain = getMainChain(ws);
        const mainTypes = new Set(mainChain.map((b) => b.type));
        const hasTypes = (...types: string[]) => types.every((t) => mainTypes.has(t));
        const hasAnyType = (...types: string[]) => types.some((t) => mainTypes.has(t));

        // 1) Split – if split blocks are in the MAIN chain, call split APIs (any stage)
        if (hasTypes("m3.set_split_ratio", "m3.apply_split")) {
          await runSplitStage(ws, datasetKey, newLogs, issues, stage);
        }

        // 2) Model build – if model_init exists in MAIN chain, attempt model/build (any stage)
        if (mainTypes.has("m4.model_init")) {
          await runModelBuildStage(ws, datasetKey, newLogs, issues, stage);
        }

        // 3) Train – if train_start exists in MAIN chain, call train/start (any stage)
        if (mainTypes.has("m4.train_start")) {
          await runTrainStage(ws, datasetKey, newLogs, issues, stage);
        }

        // 4) Evaluate / Predict – if eval or predict blocks exist, call APIs (any stage)
        if (hasAnyType("m4.eval_test", "m4.predict_sample")) {
          await runEvalPredictStage(ws, datasetKey, newLogs, issues, stage);
        }
      }

      // Decide if the STAGE is "complete" (for the Next Stage button)
      const itemsAfter = computeChecklist(ws, stage);
      setCheckItems(itemsAfter);
      const allOk = itemsAfter.length > 0 && itemsAfter.every((i) => i.state === "ok");
      const ok = allOk && issues.length === 0;

      if (ok) {
        setSubmitSuccess(true);
        setCanGoNext(true);

        const titleByType: Record<string, string> = {
          split: "Stage Complete – Split ready for training",
          model_build: "Stage Complete – Model built",
          train: "Stage Complete – Training finished",
          eval_predict: "Stage Complete – Evaluation and prediction",
        };

        if (String(stage.id) === "2") {
          setSubmitTitle("Stage Complete – Train, evaluate, predict");
        } else {
          setSubmitTitle(titleByType[stage.type] || "Stage Complete");
        }
        setSubmitLines(["✓ All required blocks ran successfully for this stage."]);
        setLogs((prev) => [...prev, ...newLogs]);

        const successLines = [
          "That went smoothly. Your backend calls worked, and this stage is complete.",
          "Nice work. The pipeline for this stage ran without errors. You can move on when you’re ready.",
          "Everything this stage needed is now in place and executed. Feel free to inspect the logs or jump to the next mission.",
        ];
        setBaymaxState(
          pickLine(successLines, String(stage.id) + "-success"),
          "success",
          false
        );
      } else {
        setSubmitSuccess(false);
        setCanGoNext(false);
        setSubmitTitle("Keep tuning this stage");
        if (issues.length === 0) {
          issues.push(
            "Something ran, but the stage isn’t fully satisfied yet. Check the checklist and logs, then try again."
          );
        }
        setSubmitLines(issues);
        setLogs((prev) => [...prev, ...newLogs]);

        const failLines = [
          "This run hit a few bumps. Check the messages in the submission dialog, fix the highlighted issues, and try again.",
          "The backend refused at least one request. Often this means a missing split, model, or an invalid parameter.",
          "We’re close, but not there yet. Follow the checklist and error messages to adjust your pipeline before the next run.",
        ];
        setBaymaxState(
          pickLine(failLines, String(stage.id) + "-fail"),
          "warning",
          false
        );
      }

      setSubmitOpen(true);
    } catch (e: any) {
      setSubmitSuccess(false);
      setCanGoNext(false);
      setSubmitTitle("Error while running");
      setSubmitLines([e?.message || String(e)]);
      setSubmitOpen(true);
      setBaymaxState(
        "Something broke while running this stage. Fix any obvious errors and try again.",
        "error",
        false
      );
    } finally {
      setRunning(false);
      setBaymaxTyping(false);
    }
  }

  /* ---------- Stage-specific runners (block-driven, not stage-driven) ---------- */

  async function runSplitStage(
    ws: WorkspaceSvg,
    datasetKey: string,
    logs: LogItem[],
    issues: string[],
    _stage: StageConfig
  ) {
    const pct = getTrainPct(ws) ?? 80;

    try {
      const applyResp = await fetchJSON<SplitApplyResp>(`${API_BASE}/split/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_key: datasetKey,
          train_pct: pct,
          shuffle: true,
        }),
      });

      logs.push({
        kind: "card",
        title: "Split Applied",
        lines: [
          `Dataset: ${applyResp.dataset_key}`,
          `Train %: ${applyResp.train_pct}`,
          `Train size: ${applyResp.train.size}`,
          `Test size: ${applyResp.test.size}`,
        ],
      });

      const st = await fetchJSON<SplitStateResp>(
        `${API_BASE}/split/state?dataset_key=${encodeURIComponent(datasetKey)}`
      );
      const perClassLines: string[] = [];
      for (const c of st.classes) {
        const tr = st.train.per_class[c] ?? 0;
        const te = st.test.per_class[c] ?? 0;
        perClassLines.push(`${c}: train=${tr}, test=${te}`);
      }
      logs.push({
        kind: "card",
        title: "Per-Class Split",
        lines: perClassLines.length ? perClassLines : ["(no images)"],
      });
    } catch (e: any) {
      issues.push(
        e?.message ||
          "The split API call failed. Check that the dataset exists and your train percentage is valid."
      );
    }
  }

  async function runModelBuildStage(
    ws: WorkspaceSvg,
    datasetKey: string,
    logs: LogItem[],
    issues: string[],
    stage: StageConfig
  ) {
    const spec = buildModelSpecFromWorkspace(ws);
    if (!spec) {
      issues.push(
        "I couldn’t find a model_init block with layers under it in the main chain. Add a model_init and chain conv/pool/dense blocks beneath it."
      );
      return;
    }

    try {
      const resp = await fetchJSON<ModelBuildResp>(`${API_BASE}/model/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_key: datasetKey,
          spec,
          use_active_split: !!stage.requiresSplit,
        }),
      });

      const summaryLines = resp.summary_lines || [];
      const trimmedSummary =
        summaryLines.length > 0 ? summaryLines : ["(no summary returned)"];

      logs.push({
        kind: "card",
        title: `Model Built – ${resp.name}`,
        lines: [
          `Input shape: ${resp.input_shape.join(" × ")}`,
          `Classes: ${resp.num_classes}`,
          ...trimmedSummary,
        ],
      });

      if (resp.diagram_data_url) {
        logs.push({
          kind: "image",
          src: resp.diagram_data_url,
          caption: "Model diagram",
        });
      }
    } catch (e: any) {
      issues.push(
        e?.message ||
          "The model_build API call failed. Check that you have an active split (if required) and a sensible layer configuration."
      );
    }
  }

  async function runTrainStage(
    ws: WorkspaceSvg,
    datasetKey: string,
    logs: LogItem[],
    issues: string[],
    stage: StageConfig
  ) {
    // If the chain defines a model spec, (re)build before training
    const spec = buildModelSpecFromWorkspace(ws);
    if (spec) {
      try {
        await fetchJSON<ModelBuildResp>(`${API_BASE}/model/build`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataset_key: datasetKey,
            spec,
            use_active_split: !!stage.requiresSplit,
          }),
        });
      } catch (e: any) {
        issues.push(
          e?.message ||
            "I tried to (re)build the model before training, but the model_build API failed."
        );
        return;
      }
    }

    const { epochs, batch } = getTrainParams(ws);

    try {
      const resp = await fetchJSON<TrainResp>(`${API_BASE}/train/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_key: datasetKey,
          epochs,
          batch,
        }),
      });

      const lines: string[] = [];
      for (const ep of resp.epochs) {
        const accPct = (ep.train_acc * 100).toFixed(1);
        const loss = ep.train_loss.toFixed(4);
        lines.push(`Epoch ${ep.epoch}: accuracy=${accPct}%, loss=${loss}`);
      }
      logs.push({
        kind: "card",
        title: "Training History",
        lines: lines.length ? lines : ["(no epochs returned)"],
      });
    } catch (e: any) {
      issues.push(
        e?.message ||
          "The train_start API call failed. This usually means there is no active model or split."
      );
    }
  }

  async function runEvalPredictStage(
    ws: WorkspaceSvg,
    datasetKey: string,
    logs: LogItem[],
    issues: string[],
    _stage: StageConfig
  ) {
    // Evaluate on test split if eval_test is present
    const mainChain = getMainChain(ws);
    const mainTypes = new Set(mainChain.map((b) => b.type));
    const hasEval = mainTypes.has("m4.eval_test");
    const hasPredict = mainTypes.has("m4.predict_sample");

    if (hasEval) {
      try {
        const resp = await fetchJSON<EvalResp>(`${API_BASE}/evaluate/test`);

        const accPct = (resp.accuracy * 100).toFixed(2);
        const lines: string[] = [`Overall accuracy: ${accPct}%`];
        for (const c of resp.per_class) {
          const cp = (c.acc * 100).toFixed(1);
          lines.push(`${c.name}: ${cp}%`);
        }
        logs.push({
          kind: "card",
          title: "Test Evaluation",
          lines,
        });

        if (resp.confusion_data_url) {
          logs.push({
            kind: "image",
            src: resp.confusion_data_url,
            caption: "Confusion Matrix",
          });
        }
      } catch (e: any) {
        issues.push(
          e?.message ||
            "The evaluate_test API call failed. Check that you have a trained model and an active test split."
        );
      }
    }

    if (!hasPredict) return;

    const sampleCfg = getSampleConfig(ws);
    if (!sampleCfg) {
      issues.push(
        "To run a single-sample prediction, add a dataset.sample_image block in the chain so I know which image to use."
      );
      return;
    }

    try {
      const url =
        sampleCfg.mode === "index"
          ? `${API_BASE}/datasets/${encodeURIComponent(
              datasetKey
            )}/sample?mode=index&index=${sampleCfg.index}`
          : `${API_BASE}/datasets/${encodeURIComponent(
              datasetKey
            )}/sample?mode=random`;

      const sample = await fetchJSON<SampleResp>(url);

      const resp = await fetchJSON<PredictResp>(`${API_BASE}/predict/sample`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_key: datasetKey,
          path: sample.path,
        }),
      });

      const confPct = (resp.confidence * 100).toFixed(1);
      logs.push({
        kind: "image",
        src: sample.image_data_url,
        caption: `Sample image – true label: ${sample.label}`,
      });
      logs.push({
        kind: "card",
        title: "Single-sample Prediction",
        lines: [`Predicted: ${resp.class}`, `Confidence: ${confPct}%`],
      });
    } catch (e: any) {
      issues.push(
        e?.message ||
          "The predict_sample API call failed. Check that a model is active and the sample path is valid."
      );
    }
  }

  /* ---------- Navigation helpers ---------- */

  function goModuleHome() {
    router.push("/module4");
  }

  function goHome() {
    router.push("/");
  }

  function goNext() {
    if (nextStage) {
      router.push(`/module4/${nextStage.id}`);
    } else {
      router.push("/module4");
    }
  }

  /* ---------- Mission counter ---------- */
  const stageProgress = useMemo(() => {
    if (!stage || checkItems.length === 0) return { total: 0, done: 0 };
    const total = checkItems.length;
    const done = checkItems.filter((i) => i.state === "ok").length;
    return { total, done };
  }, [stage, checkItems]);

  /* ---------- UI ---------- */

  const confettiColors = ["#f97316", "#fbbf24", "#22c55e", "#38bdf8", "#a855f7", "#f43f5e"];
  const confettiPieces = Array.from({ length: 18 }, (_, i) => i);

  const chatSignal = !chatPanelOpen
    ? hintThinking || aiAssistantLoading
      ? "thinking"
      : hintReady
      ? "ready"
      : "idle"
    : "open";

  const getMood = () => {
    if (aiAssistantLoading) return "thinking";
    if (!aiAssistantText) return "idle";
    const lower = aiAssistantText.toLowerCase();
    if (lower.includes("error") || lower.includes("failed")) return "error";
    if (lower.includes("warning") || lower.includes("wrong") || lower.includes("incorrect")) return "warning";
    if (lower.includes("great") || lower.includes("excellent") || lower.includes("perfect") || lower.includes("mission")) return "success";
    return "hint";
  };

  if (!stage) return <div className="p-6 text-red-600">Stage not found.</div>;

  const stageCompleteTitle =
    String(stage.id) === "1"
      ? "Stage 1 Complete!"
      : String(stage.id) === "2"
      ? "Stage 2 Complete!"
      : "Quiz Complete!";

  const stageCompleteBody =
    String(stage.id) === "1"
      ? "Nice work. Head to Stage 2 next."
      : String(stage.id) === "2"
      ? "Great job. Move on to the quiz stage."
      : "You finished the quiz. Module 4 is complete.";

  return (
    <div className="h-screen w-screen bg-[#E3E7F5] overflow-hidden">
      {stageConfetti && (
        <div className="vb-confetti-layer">
          {confettiPieces.map((i) => (
            <span
              key={i}
              className="vb-confetti-piece"
              style={{
                left: `${(i * 7) % 100}%`,
                backgroundColor: confettiColors[i % confettiColors.length],
                animationDelay: `${i * 0.12}s`,
              }}
            />
          ))}
        </div>
      )}
      {stageCompleteToast && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-900/25 backdrop-blur-sm">
          <div className="vb-achieve-card relative mx-4 w-[92%] max-w-xl rounded-3xl border border-sky-100 bg-white/95 px-8 py-7 text-center">
            <span className="vb-achieve-sparkle vb-achieve-sparkle-1" />
            <span className="vb-achieve-sparkle vb-achieve-sparkle-2" />
            <span className="vb-achieve-sparkle vb-achieve-sparkle-3" />
            <span className="vb-achieve-sparkle vb-achieve-sparkle-4" />
            <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-600">
              Achievement unlocked
            </div>
            <div className="mt-3 text-2xl font-semibold text-slate-900">{stageCompleteTitle}</div>
            <div className="mt-2 text-sm text-slate-600">{stageCompleteBody}</div>
          </div>
        </div>
      )}
      {/* Top nav */}
      <header className="fixed top-0 left-0 right-0 z-20 backdrop-blur-xl bg-white/70 border-b border-white/60 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold text-slate-900">VisionBlocks</span>
            <span className="text-xs text-slate-500">
              Module 4 · Model building & training · {stage.title}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={goHome}
              className="px-3 py-1.5 rounded-full border border-slate-300 bg-white/80 text-xs font-medium text-slate-700 hover:border-sky-400 hover:text-sky-600 hover:shadow-[0_0_0_1px_rgba(56,189,248,0.45)] transition"
            >
              Home
            </button>
            <button
              onClick={goModuleHome}
              className="px-3 py-1.5 rounded-full border border-slate-300 bg-white/80 text-xs font-medium text-slate-700 hover:border-sky-400 hover:text-sky-600 hover:shadow-[0_0_0_1px_rgba(56,189,248,0.45)] transition"
            >
              Module 4
            </button>
            <button
              onClick={() => {
                if (!running) run();
              }}
              disabled={running}
              className={`relative px-4 py-1.5 rounded-full text-sm font-semibold text-white shadow-md transition
                ${
                  running
                    ? "bg-emerald-500/70 cursor-not-allowed"
                    : "bg-emerald-500 hover:bg-emerald-400 hover:shadow-[0_0_18px_rgba(16,185,129,0.75)]"
                }`}
            >
              <span className="relative z-10">
                {running ? "Submitting…" : "Submit & Run"}
              </span>
              {!running && (
                <span className="absolute inset-0 rounded-full bg-emerald-400/50 blur-sm opacity-0 hover:opacity-100 transition" />
              )}
            </button>
            <button
              onClick={goNext}
              disabled={!canGoNext}
              className={`px-4 py-1.5 rounded-full border text-sm font-medium transition
                ${
                  canGoNext
                    ? "border-sky-400 bg-white/85 text-sky-700 hover:bg-sky-50 hover:shadow-[0_0_0_1px_rgba(56,189,248,0.55)]"
                    : "border-slate-300 bg-white/60 text-slate-400 cursor-not-allowed"
                }`}
              title={
                canGoNext
                  ? nextStage
                    ? `Go to Stage ${nextStage.id}: ${nextStage.title}`
                    : "Finish Module"
                  : "Complete this stage to unlock the next one"
              }
            >
              {nextStage ? "Next Stage" : "Finish Module"}
            </button>
          </div>
        </div>
      </header>

      {/* Main layout */}
      <div className="pt-20 h-full">
        <div
          className="max-w-[1400px] mx-auto px-4 h-[calc(100vh-5rem)] grid gap-4"
          style={{ gridTemplateColumns: `minmax(0, 1.9fr) minmax(0, 1.2fr)` }}
        >
          <div className="h-full min-h-0 rounded-3xl bg-white shadow-[0_22px_60px_rgba(15,23,42,0.25)] border border-white/70 overflow-hidden">
            <div ref={blocklyDivRef} className="w-full h-full min-h-0" />
          </div>

          <div className="h-full min-h-0 rounded-3xl border border-white/80 bg-gradient-to-b from-white/90 to-[#E0E5F4] shadow-[0_18px_45px_rgba(15,23,42,0.22)] flex flex-col">
            <div className="flex flex-col min-h-0 px-4 py-4 gap-4">
              <div className="flex items-center justify-between mb-1">
                <div
                  className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border shadow-sm transition-colors
                  ${
                    stageProgress.done >= stageProgress.total && stageProgress.total > 0
                      ? "bg-emerald-100 border-emerald-400 text-emerald-700"
                      : "bg-amber-50 border-amber-300 text-amber-700"
                  }`}
                >
                  <span>Stage blocks:</span>
                  <span>
                    {stageProgress.done} / {stageProgress.total}
                  </span>
                </div>

                <button
                  aria-label="Stage help"
                  onClick={() => {
                    if (stage?.help) {
                      setInfoTitle(stage.help.title);
                      setInfoText(stage.help.text);
                      setInfoOpen(true);
                    }
                  }}
                  className="h-8 w-8 rounded-full flex items-center justify-center border border-slate-200 text-sm text-slate-700 bg-white/80 hover:bg-slate-50 transition"
                  title="What does this stage teach?"
                >
                  ?
                </button>
              </div>

              {["1", "2", "3", "4"].includes(String(stage.id)) && (
                <div className="shrink-0 flex flex-col items-center justify-center">
                  <div className="fixed bottom-6 right-6 z-[970] flex flex-col items-end gap-3">
                    {chatPanelOpen && (
                      <div className="w-[380px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-3xl border border-sky-100 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
                        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 bg-gradient-to-r from-sky-50 to-blue-50">
                          <div className="flex items-center gap-2">
                            <svg
                              viewBox="0 0 100 100"
                              className="h-6 w-6 drop-shadow-[0_0_4px_rgba(56,189,248,0.3)]"
                              xmlns="http://www.w3.org/2000/svg"
                              aria-hidden="true"
                            >
                              <defs>
                                <radialGradient id="m4ChatAvatar" cx="50%" cy="40%" r="70%">
                                  <stop offset="0%" stopColor="#ecfeff" />
                                  <stop offset="100%" stopColor="#7dd3fc" />
                                </radialGradient>
                              </defs>
                              <circle cx="50" cy="50" r="30" fill="url(#m4ChatAvatar)" />
                              <circle cx="32" cy="28" r="3" fill="#38bdf8" opacity="0.7" />
                              <circle cx="70" cy="30" r="2.5" fill="#0ea5e9" opacity="0.55" />
                              <circle cx="41" cy="44" r="5" fill="white" stroke="#bae6fd" strokeWidth="0.6" />
                              <circle cx="59" cy="44" r="5" fill="white" stroke="#bae6fd" strokeWidth="0.6" />
                              <circle cx="42" cy="46" r="2.2" fill="#0ea5e9" />
                              <circle cx="58" cy="46" r="2.2" fill="#0ea5e9" />
                              <path d="M 40 62 Q 50 66 60 62" stroke="#0ea5e9" strokeWidth="2" fill="none" strokeLinecap="round" />
                            </svg>
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">NeuraBuddy</div>
                              <div className="text-[10px] text-sky-500 font-medium">Module 4 chat assistant</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              className="rounded-full p-2 text-slate-500 hover:bg-white hover:text-slate-700 transition"
                              onClick={() => setChatPanelOpen(false)}
                              aria-label="Close chat"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        <div ref={chatContainerRef} className="max-h-[42vh] space-y-2 overflow-auto px-4 py-3">
                          {agentHistory.length === 0 && (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                              No conversation yet. Ask a question to start the assistant chat.
                            </div>
                          )}
                          {agentHistory.map((entry, idx) => {
                            const isUser = entry.role === "user";
                            return (
                              <div key={`${entry.ts}-${idx}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                                <div
                                  className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap shadow-sm ${
                                    isUser
                                      ? "bg-sky-500 text-white"
                                      : entry.source === "hint"
                                      ? "bg-sky-50 text-sky-900 border border-sky-200"
                                      : "bg-slate-100 text-slate-800 border border-slate-200"
                                  }`}
                                >
                                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">
                                    {isUser ? "You" : "NeuraBuddy"}
                                  </div>
                                  {entry.text}
                                </div>
                              </div>
                            );
                          })}
                          {aiAssistantLoading && !chatSending && (
                            <div className="flex justify-start">
                              <div className="rounded-2xl bg-slate-100 border border-slate-200 px-3 py-2 shadow-sm">
                                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70 text-slate-600">
                                  NeuraBuddy
                                </div>
                                <div className="flex items-center gap-1.5 py-1">
                                  <span className="h-2 w-2 rounded-full bg-slate-400 animate-[vb-think-dot_1s_ease-in-out_infinite]" />
                                  <span className="h-2 w-2 rounded-full bg-slate-400 animate-[vb-think-dot_1s_ease-in-out_infinite_0.15s]" />
                                  <span className="h-2 w-2 rounded-full bg-slate-400 animate-[vb-think-dot_1s_ease-in-out_infinite_0.3s]" />
                                </div>
                              </div>
                            </div>
                          )}
                          {chatSending && (
                            <div className="flex justify-start">
                              <div className="rounded-2xl bg-slate-100 border border-slate-200 px-3 py-2 shadow-sm">
                                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70 text-slate-600">
                                  NeuraBuddy
                                </div>
                                <div className="flex items-center gap-1.5 py-1">
                                  <span className="h-2 w-2 rounded-full bg-slate-400 animate-[vb-think-dot_1s_ease-in-out_infinite]" />
                                  <span className="h-2 w-2 rounded-full bg-slate-400 animate-[vb-think-dot_1s_ease-in-out_infinite_0.15s]" />
                                  <span className="h-2 w-2 rounded-full bg-slate-400 animate-[vb-think-dot_1s_ease-in-out_infinite_0.3s]" />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="border-t border-slate-100 bg-slate-50 p-3">
                          <textarea
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void sendChatMessage(chatInput);
                              }
                            }}
                            rows={3}
                            placeholder='Ask things like "Explain more" or "Why is this wrong?"'
                            className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-200"
                          />
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-500">Shift+Enter for a new line.</span>
                            <button
                              className={`rounded-full px-4 py-1.5 text-xs font-semibold text-white transition ${
                                chatSending || !chatInput.trim()
                                  ? "bg-slate-400 cursor-not-allowed"
                                  : "bg-sky-500 hover:bg-sky-400"
                              }`}
                              disabled={chatSending || !chatInput.trim()}
                              onClick={() => void sendChatMessage(chatInput)}
                            >
                              {chatSending ? "Sending..." : "Send"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    <button
                      className={`relative flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-[0_18px_35px_rgba(14,165,233,0.35)] ring-2 transition hover:scale-105 ${
                        chatSignal === "thinking"
                          ? "ring-amber-400"
                          : chatSignal === "ready"
                          ? "ring-emerald-400"
                          : "ring-sky-300"
                      }`}
                      onClick={() => setChatPanelOpen((open) => !open)}
                      aria-label={chatPanelOpen ? "Close assistant chat" : "Open assistant chat"}
                      title={chatPanelOpen ? "Close chat" : "Open chat"}
                    >
                      <span className="sr-only">Assistant character</span>
                      {!chatPanelOpen && chatSignal !== "open" && (
                        <span className="absolute -inset-4 rounded-full border border-dashed border-sky-200/70 opacity-60" />
                      )}
                      {!chatPanelOpen && chatSignal === "thinking" && (
                        <span className="absolute -top-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/90 px-2 py-1 shadow-[0_8px_20px_rgba(251,191,36,0.18)] ring-1 ring-amber-200/80">
                          <span className="h-2 w-2 rounded-full bg-amber-400 animate-[vb-think-dot_1s_ease-in-out_infinite]" />
                          <span className="h-2 w-2 rounded-full bg-amber-400 animate-[vb-think-dot_1s_ease-in-out_infinite_0.18s]" />
                          <span className="h-2 w-2 rounded-full bg-amber-400 animate-[vb-think-dot_1s_ease-in-out_infinite_0.36s]" />
                        </span>
                      )}
                      {!chatPanelOpen && chatSignal === "ready" && (
                        <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(236,253,245,0.95)] ring-2 ring-white animate-[vb-ready-badge_1.2s_ease-in-out_infinite]">
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        </span>
                      )}
                      {chatPanelOpen && (
                        <span className="absolute -bottom-1.5 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.8)]" />
                      )}
                      <svg
                        viewBox="0 0 100 100"
                        className="h-12 w-12 drop-shadow-[0_0_10px_rgba(56,189,248,0.35)]"
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true"
                      >
                        <defs>
                          <radialGradient id="launcherBodyM4" cx="50%" cy="40%" r="70%">
                            <stop offset="0%" stopColor="#ecfeff" />
                            <stop offset="100%" stopColor="#7dd3fc" />
                          </radialGradient>
                        </defs>
                        <circle cx="50" cy="50" r="30" fill="url(#launcherBodyM4)" />
                        <circle cx="32" cy="28" r="3" fill="#38bdf8" opacity="0.7" />
                        <circle cx="70" cy="30" r="2.5" fill="#0ea5e9" opacity="0.55" />
                        <circle cx="74" cy="52" r="2" fill="#38bdf8" opacity="0.45" />
                        <circle cx="30" cy="72" r="2.5" fill="#0ea5e9" opacity="0.55" />
                        <circle cx="41" cy="44" r="5" fill="white" stroke="#bae6fd" strokeWidth="0.6" />
                        <circle cx="59" cy="44" r="5" fill="white" stroke="#bae6fd" strokeWidth="0.6" />
                        <circle cx="42" cy="46" r="2.2" fill="#0ea5e9" />
                        <circle cx="58" cy="46" r="2.2" fill="#0ea5e9" />
                        <path d="M 40 62 Q 50 66 60 62" stroke="#0ea5e9" strokeWidth="2" fill="none" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              <div className="flex-1 min-h-0">
                <OutputPanel logs={logs} onClear={() => setLogs([])} dark={false} />
              </div>

              <div className="hidden">
                <MissionChecklistStage items={checkItems} dark={false} />
              </div>
            </div>
          </div>
        </div>
      </div>

        {agentHistoryOpen && (
          <div className="fixed inset-0 z-[980] flex items-center justify-center bg-black/40">
            <div className="max-w-2xl w-[92%] max-h-[80vh] overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold">AI Assistant chat</h3>
                <div className="flex items-center gap-2">
                  <button
                    className="text-sm text-slate-600 hover:underline"
                    onClick={() => {
                      try {
                        window.localStorage.removeItem(assistantHistoryKey);
                      } catch {}
                      setAgentHistory([]);
                    }}
                  >
                    Clear
                  </button>
                  <button
                    className="px-3 py-1 rounded-full bg-sky-500 text-xs text-white"
                    onClick={() => setAgentHistoryOpen(false)}
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="overflow-auto h-[60vh] pr-2">
                {agentHistory.length === 0 && (
                  <div className="text-sm text-slate-500">No history yet.</div>
                )}
                {agentHistory.map((entry) => (
                  <div key={entry.ts} className="mb-3 border-b pb-2">
                    <div className="text-[11px] text-slate-400 mb-1">{new Date(entry.ts).toLocaleString()}</div>
                    <div className="whitespace-pre-wrap text-sm text-slate-800">{entry.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      <InfoModal
        open={infoOpen}
        title={infoTitle}
        text={infoText}
        dark={false}
        onClose={() => setInfoOpen(false)}
      />

      <SubmissionModal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        dark={false}
        title={submitTitle}
        lines={submitLines}
        success={submitSuccess}
      />
    </div>
  );
}
