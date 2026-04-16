"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceSvg, Block as BlocklyBlock } from "blockly";
import { Blockly, setDatasetOptions } from "@/lib/blockly";
import { LightTheme } from "@/lib/blockly/theme";
import { toolboxJsonModule4 } from "@/components/toolboxModule4";

import OutputPanel, { type LogItem } from "@/components/OutputPanel";
import BaymaxPanel from "@/components/BaymaxPanel";
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

const API_BASE = "http://127.0.0.1:8000";

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

  let raw: string | number | undefined = candidates.find(
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

  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTitle, setInfoTitle] = useState<string>();
  const [infoText, setInfoText] = useState<string>();

  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitTitle, setSubmitTitle] = useState("Submission");
  const [submitLines, setSubmitLines] = useState<string[]>([]);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const [canGoNext, setCanGoNext] = useState(false);
  const [checkItems, setCheckItems] = useState<StageChecklistItem[]>([]);

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

  /* ---------- Blockly inject + listeners ---------- */
  useEffect(() => {
    if (!stage || !blocklyDivRef.current) return;

    setLogs([]);
    setCanGoNext(false);

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

    // Seed with "use dataset" only
    const ds = ws.newBlock("dataset.select");
    ds.initSvg();
    ds.render();

    // Info events
    const onInfo = (e: any) => {
      const { title, text } = e?.detail ?? {};
      setInfoTitle(title || "About this block");
      setInfoText(text || "");
      setInfoOpen(true);
    };
    window.addEventListener("vb:blockInfo", onInfo as any);

    // On-change: recompute checklist, glow, Baymax (no API calls here)
    const onChange = () => {
      setTimeout(() => {
        if (!workspaceRef.current || !stage) return;
        const items = computeChecklist(workspaceRef.current, stage);
        setCheckItems(items);
        updateToolboxGlow();
        updateBaymaxFromChecklist(stage, items);
      }, 150);
    };
    ws.addChangeListener(onChange);

    const initialItems = computeChecklist(ws, stage);
    setCheckItems(initialItems);
    updateToolboxGlow();
    updateBaymaxFromChecklist(stage, initialItems, true);

    return () => {
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

    const stageLines = linesByStage[s.type] || [
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

    const finalLines =
      completeByStage[s.type] || [
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

        setSubmitTitle(titleByType[stage.type] || "Stage Complete");
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

  if (!stage) return <div className="p-6 text-red-600">Stage not found.</div>;

  return (
    <div className="h-screen w-screen bg-[#E3E7F5] overflow-hidden">
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

              <div
                className={`shrink-0 transition-transform ${
                  baymaxBump ? "vb-baymax-bump" : ""
                }`}
              >
                <BaymaxPanel
                  line={baymax}
                  mood={baymaxMood}
                  typing={baymaxTyping}
                  dark={false}
                />
              </div>

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
