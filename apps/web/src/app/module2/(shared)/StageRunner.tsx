"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceSvg, Block as BlocklyBlock } from "blockly";
import { Blockly, setDatasetOptions } from "@/lib/blockly";
import { DarkTheme, LightTheme } from "@/lib/blockly/theme";
import { toolboxJsonModule2 } from "@/components/toolboxModule2";

import OutputPanel, { type LogItem } from "@/components/OutputPanel";
import BaymaxPanel from "@/components/BaymaxPanel";
import InfoModal from "@/components/InfoModal";
import SubmissionModal from "@/components/SubmissionModal";
import MissionChecklistStage, {
  type StageChecklistItem,
  type Tri,
} from "@/components/MissionChecklistStage";
import TargetPanel from "@/components/TargetPanel";

import {
  module2Stages,
  type StageConfig,
  type OpSpec,
} from "@/data/module2Stages";

const API_BASE = "http://localhost:8000";

/* ----------------- HTTP helper ----------------- */
async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* ----------------- API types ----------------- */
type SampleResp = {
  dataset_key: string;
  index_used: number;
  label: string;
  image_data_url: string;
  path: string;
};

type ApplyResp = {
  dataset_key: string;
  path: string;
  before_data_url: string;
  after_data_url: string;
  after_shape: [number, number, number];
};

type ExportResp = {
  base_dataset: string;
  new_dataset_key: string;
  processed: number;
  classes: string[];
};

type DatasetListItem = { key: string; name: string };
type DatasetListResponse = { items: DatasetListItem[] };

type DatasetInfo = {
  key: string;
  name: string;
  description?: string | null;
  image_shape?: [number | null, number | null, number | null] | null;
  num_classes: number;
  classes: string[];
  approx_count: Record<string, number>;
  version?: string;
};

type SplitResp = { r_data_url: string; g_data_url: string; b_data_url: string };

/* ----------------- Blockly → ops ----------------- */
function blocksToOps(first: BlocklyBlock | null): OpSpec[] {
  const ops: OpSpec[] = [];
  let b: BlocklyBlock | null = first;
  while (b) {
    switch (b.type) {
      case "m2.resize": {
        const mode = b.getFieldValue("MODE");
        if (mode === "size") {
          ops.push({
            type: "resize",
            mode: "size",
            w: Number(b.getFieldValue("W") || 256),
            h: Number(b.getFieldValue("H") || 256),
            keep: b.getFieldValue("KEEP"),
          } as any);
        } else if (mode === "fit") {
          ops.push({
            type: "resize",
            mode: "fit",
            maxside: Number(b.getFieldValue("MAXSIDE") || 256),
          } as any);
        } else {
          ops.push({
            type: "resize",
            mode: "scale",
            pct: Number(b.getFieldValue("PCT") || 100),
          } as any);
        }
        break;
      }
      case "m2.crop_center":
        ops.push({
          type: "crop_center",
          w: Number(b.getFieldValue("W") || 224),
          h: Number(b.getFieldValue("H") || 224),
        } as any);
        break;
      case "m2.pad":
        ops.push({
          type: "pad",
          w: Number(b.getFieldValue("W") || 256),
          h: Number(b.getFieldValue("H") || 256),
          mode: b.getFieldValue("MODE"),
          r: Number(b.getFieldValue("R") || 0),
          g: Number(b.getFieldValue("G") || 0),
          b: Number(b.getFieldValue("B") || 0),
        } as any);
        break;
      case "m2.brightness_contrast":
        ops.push({
          type: "brightness_contrast",
          b: Number(b.getFieldValue("B") || 0),
          c: Number(b.getFieldValue("C") || 0),
        } as any);
        break;
      case "m2.blur_sharpen":
        ops.push({
          type: "blur_sharpen",
          blur: Number(b.getFieldValue("BLUR") || 0),
          sharp: Number(b.getFieldValue("SHARP") || 0),
        } as any);
        break;
      case "m2.edges":
        ops.push({
          type: "edges",
          method: b.getFieldValue("METHOD"),
          threshold: Number(b.getFieldValue("THRESH") || 100),
          overlay: b.getFieldValue("OVERLAY") === "TRUE",
        } as any);
        break;
      case "m2.to_grayscale":
        ops.push({ type: "to_grayscale" } as any);
        break;
      case "m2.normalize":
        ops.push({ type: "normalize", mode: b.getFieldValue("MODE") } as any);
        break;
      default:
        break;
    }
    b = b.getNextBlock();
  }
  return ops;
}

/* ----------------- chain helpers ----------------- */
function walkConnectedChainFrom(top: BlocklyBlock | null): string[] {
  const seq: string[] = [];
  for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) seq.push(b.type);
  return seq;
}

function findBlockByTypeInChain(
  top: BlocklyBlock | null,
  type: string
): BlocklyBlock | null {
  for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock())
    if (b.type === type) return b;
  return null;
}

function findFirstPipelineTop(ws: WorkspaceSvg): BlocklyBlock | null {
  const tops = ws.getTopBlocks(true) as BlocklyBlock[];
  for (const top of tops) {
    for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
      if (b.type.startsWith("m2.")) return top;
    }
  }
  return null;
}

// For dataset-chain inspection (like Module 1)
function getTopChains(ws: WorkspaceSvg): BlocklyBlock[][] {
  const tops = ws.getTopBlocks(true) as BlocklyBlock[];
  const chains: BlocklyBlock[][] = [];
  for (const top of tops) {
    const chain: BlocklyBlock[] = [];
    for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) chain.push(b);
    chains.push(chain);
  }
  return chains;
}
const hasType = (chain: BlocklyBlock[], type: string) =>
  chain.some((b) => b.type === type);
const indexOfType = (chain: BlocklyBlock[], type: string) =>
  chain.findIndex((b) => b.type === type);
const isAfter = (chain: BlocklyBlock[], beforeType: string, targetType: string) => {
  const a = indexOfType(chain, beforeType);
  const b = indexOfType(chain, targetType);
  return a !== -1 && b !== -1 && b > a;
};

/* ----------------- Baymax mood ----------------- */
type BaymaxMood = "neutral" | "hint" | "warning" | "success" | "error";

/* Small helper so Baymax can vary his lines deterministically */
function pickLine(options: string[], key: string): string {
  if (!options.length) return "";
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % options.length;
  return options[idx];
}

/* ----------------- Stage target ops helper ----------------- */
/**
 * Build the ops used to generate the TARGET image.
 * For Stage 3 we force a true 150×150 resize AND 150×150 pad
 * so the visual goal always shows a clean square frame.
 */
function buildTargetOpsForStage(stage: StageConfig): OpSpec[] | undefined {
  if (!stage.targetOps) return undefined;

  const stageKey = String(stage.id);
  const base = stage.targetOps.map((op) => ({ ...(op as any) })) as OpSpec[];

  if (stageKey === "3") {
    let hasResize = false;
    let hasPad = false;

    for (const op of base as any[]) {
      if (op.type === "resize") {
        op.mode = "size";
        op.w = 150;
        op.h = 150;
        hasResize = true;
      }
      if (op.type === "pad") {
        op.w = 150;
        op.h = 150;
        hasPad = true;
      }
    }

    if (!hasResize) {
      (base as any).push({
        type: "resize",
        mode: "size",
        w: 150,
        h: 150,
        keep: false,
      });
    }

    if (!hasPad) {
      (base as any).push({
        type: "pad",
        w: 150,
        h: 150,
        mode: "constant",
        r: 0,
        g: 0,
        b: 0,
      });
    }
  }

  return base;
}

/* ----------------- param mismatch for checklist ----------------- */
function paramMismatch(block: BlocklyBlock | null, spec?: OpSpec): boolean {
  if (!block || !spec) return false;

  // Stages that care about a true 150×150 resize & pad
  if (spec.type === "resize") {
    const mode = block.getFieldValue("MODE");
    if (mode !== "size") return true;

    const w = Number(block.getFieldValue("W") || 0);
    const h = Number(block.getFieldValue("H") || 0);
    return !(w === 150 && h === 150);
  }

  if (spec.type === "pad") {
    const w = Number(block.getFieldValue("W") || 0);
    const h = Number(block.getFieldValue("H") || 0);
    return !(w === 150 && h === 150);
  }

  if (spec.type === "normalize") {
    if ((spec as any).mode) {
      const m = block.getFieldValue("MODE");
      return m !== (spec as any).mode;
    }
    return false;
  }

  return false;
}

/* ----------------- Component ----------------- */

export default function StageRunner({ stageId }: { stageId: string }) {
  const router = useRouter();

  const stage: StageConfig | undefined = useMemo(
    () => module2Stages.find((s) => String(s.id) === String(stageId)),
    [stageId]
  );

  const currentIndex = useMemo(
    () => module2Stages.findIndex((s) => String(s.id) === String(stageId)),
    [stageId]
  );
  const nextStage = currentIndex >= 0 ? module2Stages[currentIndex + 1] : undefined;

  const blocklyDivRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<WorkspaceSvg | null>(null);

  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([]);

  const [baymax, setBaymax] = useState<string>(
    "This stage is all about shaping the image before the model sees it. Start by chaining your preprocessing blocks under the sample image."
  );
  const [baymaxMood, setBaymaxMood] = useState<BaymaxMood>("neutral");
  const [baymaxTyping, setBaymaxTyping] = useState<boolean>(false);

  // Baymax bump animation
  const [baymaxBump, setBaymaxBump] = useState(false);
  const lastBaymaxTextRef = useRef<string>(baymax);

  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTitle, setInfoTitle] = useState<string>();
  const [infoText, setInfoText] = useState<string>();

  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitTitle, setSubmitTitle] = useState("Submission");
  const [submitLines, setSubmitLines] = useState<string[]>([]);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // last successful completion toggle (enables Next Stage)
  const [canGoNext, setCanGoNext] = useState(false);

  const sampleRef = useRef<SampleResp | null>(null);
  const datasetKeyRef = useRef<string | null>(null);
  const dsInfoRef = useRef<DatasetInfo | null>(null);

  const [targetSrc, setTargetSrc] = useState<string>();
  const [currentSrc, setCurrentSrc] = useState<string>();

  // debounce/thrash control
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genTokenRef = useRef(0);
  const lastCtxSigRef = useRef<string>("");

  // dataset instant-feedback signature
  const datasetSigRef = useRef<string>("");
  const datasetTokenRef = useRef(0);

  const [checkItems, setCheckItems] = useState<StageChecklistItem[]>([]);
  const lastChecklistRef = useRef<StageChecklistItem[] | null>(null);

  // separate logs for dataset vs pipeline so we can merge them cleanly
  const datasetLogsRef = useRef<LogItem[]>([]);
  const pipelineLogsRef = useRef<LogItem[]>([]);

  /* ---------- Global CSS for glow + Baymax animation ---------- */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const existing = document.getElementById("vb-m2-style");
    if (existing) return;

    const style = document.createElement("style");
    style.id = "vb-m2-style";
    style.textContent = `
      @keyframes vb-mission-breathe {
        0%   { filter: drop-shadow(0 0 0 rgba(251,191,36,0)); }
        50%  { filter: drop-shadow(0 0 12px rgba(251,191,36,0.85)); }
        100% { filter: drop-shadow(0 0 22px rgba(251,191,36,1)); }
      }
      .vb-mission-glow-block .blocklyPath {
        stroke: #fbbf24 !important;
        stroke-width: 2.4px;
        animation: vb-mission-breathe 1.6s ease-in-out infinite alternate;
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

  /* ---------- Dataset dropdown options (same as Module 1) ---------- */
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
        // keep whatever fallback options exist
      }
    }
    loadDatasets();
  }, []);

  /* ---------- Helper: highlight needed blocks in toolbox ---------- */
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

    const required = new Set<string>();
    if (stage.type === "pipeline") {
      (stage.requiredBlocks || []).forEach((t) => required.add(t));
      required.add("dataset.select");
      required.add("dataset.sample_image");
    } else {
      (stage.requiredBlocksWithinLoop || []).forEach((t) => required.add(t));
      if (stage.requireExportAfterLoop) required.add("m2.export_dataset");
      required.add("m2.loop_dataset"); // make loop block glow as a key block
      required.add("dataset.select");
    }

    const topBlocks = flyWs.getTopBlocks(false) || [];
    topBlocks.forEach((b: any) => {
      const svgRoot = b.getSvgRoot?.();
      if (!svgRoot) return;

      if (required.has(b.type)) {
        svgRoot.classList.add("vb-mission-glow-block");
      } else {
        svgRoot.classList.remove("vb-mission-glow-block");
      }
    });
  }

  /* ---------- Blockly inject + listeners ---------- */
  useEffect(() => {
    if (!stage || !blocklyDivRef.current) return;

    // reset image/log state + tokens on stage change
    lastCtxSigRef.current = "";
    genTokenRef.current = 0;
    datasetSigRef.current = "";
    datasetTokenRef.current = 0;
    setTargetSrc(undefined);
    setCurrentSrc(undefined);
    setCanGoNext(false);
    datasetLogsRef.current = [];
    pipelineLogsRef.current = [];
    setLogs([]);
    dsInfoRef.current = null;
    sampleRef.current = null;

    const ws = Blockly.inject(blocklyDivRef.current, {
      toolbox: toolboxJsonModule2,
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

    // Seed workspace with dataset + sample blocks
    if (stage.type === "pipeline") {
      const ds = ws.newBlock("dataset.select");
      ds.initSvg();
      ds.render();

      const smp = ws.newBlock("dataset.sample_image");
      smp.initSvg();
      smp.render();

      const next = (ds as any).nextConnection;
      if (next && smp.previousConnection) {
        next.connect(smp.previousConnection);
      }
    } else {
      const ds = ws.newBlock("dataset.select");
      ds.initSvg();
      ds.render();
    }

    // Initial toolbox glow once flyout exists
    setTimeout(() => {
      updateToolboxGlow();
    }, 0);

    const onInfo = (e: any) => {
      const { title, text } = e?.detail ?? {};
      setInfoTitle(title || "About this block");
      setInfoText(text || "");
      setInfoOpen(true);
    };
    window.addEventListener("vb:blockInfo", onInfo as any);

    const onChange = () => {
      setTimeout(async () => {
        if (!workspaceRef.current || !stage) return;
        const wsNow = workspaceRef.current;

        // Dataset + sample + split + stats (instant)
        await instantDatasetFeedback(wsNow);

        // Preprocessing preview (pipeline stages only)
        if (stage.type === "pipeline") {
          previewPipelineDebounced();
        }

        const items = computeChecklist(wsNow, stage);
        setCheckItems(items);
        const prev = lastChecklistRef.current || undefined;
        lastChecklistRef.current = items;
        updateBaymaxFromChecklist(stage, items, prev);
        updateToolboxGlow();
      }, 200);
    };
    ws.addChangeListener(onChange);

    // initial checklist + Baymax text
    const initialItems = computeChecklist(ws, stage);
    setCheckItems(initialItems);
    lastChecklistRef.current = initialItems;
    updateBaymaxFromChecklist(stage, initialItems, undefined);

    return () => {
      window.removeEventListener("vb:blockInfo", onInfo as any);
      ws.removeChangeListener(onChange);
      ws.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageId]);

  /* ---------- dataset/sample helpers ---------- */

  function ensureDatasetKey(ws: WorkspaceSvg) {
    const blocks = ws.getAllBlocks(false) as BlocklyBlock[];
    for (const b of blocks) {
      if (b.type === "dataset.select") {
        datasetKeyRef.current = b.getFieldValue("DATASET");
        break;
      }
    }
  }

  // Only fetch a sample when sample block is connected after dataset in same chain
  async function ensureSample(ws: WorkspaceSvg): Promise<void> {
    if (!stage) return;

    let foundDsKey: string | null = null;
    let foundSample: { mode: "random" | "index"; index?: number } | null = null;

    const tops = ws.getTopBlocks(true) as BlocklyBlock[];
    for (const top of tops) {
      let dsKeyInThisChain: string | null = null;
      for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
        if (b.type === "dataset.select") {
          dsKeyInThisChain = b.getFieldValue("DATASET");
        }
        if (b.type === "dataset.sample_image") {
          if (dsKeyInThisChain) {
            const mode = b.getFieldValue("MODE") as "random" | "index";
            const raw = b.getFieldValue("INDEX");
            const idx =
              typeof raw === "number"
                ? raw
                : parseInt(String(raw || 0), 10) || 0;

            foundDsKey = dsKeyInThisChain;
            foundSample = mode === "index" ? { mode, index: idx } : { mode };
            break;
          }
        }
      }
      if (foundDsKey && foundSample) break;
    }

    ensureDatasetKey(ws);

    if (!foundDsKey || !foundSample) return;

    const needFetch =
      !sampleRef.current ||
      sampleRef.current.dataset_key !== foundDsKey ||
      (foundSample.mode === "index" &&
        sampleRef.current.index_used !== (foundSample.index ?? 0));

    if (!needFetch) {
      datasetKeyRef.current = foundDsKey;
    } else {
      const url =
        foundSample.mode === "index"
          ? `${API_BASE}/datasets/${encodeURIComponent(
              foundDsKey
            )}/sample?mode=index&index=${foundSample.index}`
          : `${API_BASE}/datasets/${encodeURIComponent(
              foundDsKey
            )}/sample?mode=random`;

      const sample = await fetchJSON<SampleResp>(url);
      datasetKeyRef.current = foundDsKey;
      sampleRef.current = sample;
    }

    if (sampleRef.current) {
      // 🔧 Fix: don't overwrite the processed preview in pipeline stages
      // once a preprocessing chain exists. Let the preview logic own currentSrc.
      const hasPipelineBlocks = findFirstPipelineTop(ws) !== null;
      if (stage.type !== "pipeline" || !hasPipelineBlocks) {
        setCurrentSrc(sampleRef.current.image_data_url);
      }
    }

    // Build TARGET (pipeline stages only) with corrected ops
    if (stage.type === "pipeline" && sampleRef.current) {
      const targetOps = buildTargetOpsForStage(stage);
      if (targetOps && datasetKeyRef.current) {
        try {
          const tgt = await fetchJSON<ApplyResp>(`${API_BASE}/preprocess/apply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dataset_key: datasetKeyRef.current,
              path: sampleRef.current.path,
              ops: targetOps,
            }),
          });
          setTargetSrc(tgt.after_data_url);
        } catch {
          // ignore target errors so the main pipeline still works
        }
      }
    }
  }

  /* ---------- Instant dataset feedback (info, counts, dist, sample, split) ---------- */
  async function instantDatasetFeedback(ws: WorkspaceSvg) {
    const chains = getTopChains(ws);
    const dsChain =
      chains.find((ch) => hasType(ch, "dataset.select")) || null;

    // dataset key from that chain
    if (dsChain) {
      const dsBlock = dsChain.find((b) => b.type === "dataset.select");
      datasetKeyRef.current = (dsBlock?.getFieldValue("DATASET") as string) || null;
    } else {
      datasetKeyRef.current = null;
    }

    const infoInChain = !!(
      dsChain && isAfter(dsChain, "dataset.select", "dataset.info")
    );
    const countsInChain = !!(
      dsChain && isAfter(dsChain, "dataset.select", "dataset.class_counts")
    );
    const distInChain = !!(
      dsChain &&
      isAfter(dsChain, "dataset.select", "dataset.class_distribution_preview")
    );
    const sampleInChain = !!(
      dsChain && isAfter(dsChain, "dataset.select", "dataset.sample_image")
    );
    const splitInChain = !!(
      dsChain && isAfter(dsChain, "dataset.select", "image.channels_split")
    );

    let sampleConf: { mode: "random" | "index"; index?: number } | null = null;
    if (sampleInChain && dsChain) {
      const smp = dsChain.find((b) => b.type === "dataset.sample_image");
      if (smp) {
        const mode = (smp.getFieldValue("MODE") as "random" | "index") || "random";
        const raw = smp.getFieldValue("INDEX");
        const idx =
          typeof raw === "number"
            ? raw
            : parseInt(String(raw || 0), 10) || 0;
        sampleConf = mode === "index" ? { mode, index: idx } : { mode };
      }
    }

    const sig = JSON.stringify({
      ds: datasetKeyRef.current ?? null,
      infoInChain,
      countsInChain,
      distInChain,
      sampleInChain,
      splitInChain,
      sample: sampleConf || null,
    });

    if (sig === datasetSigRef.current) return;
    datasetSigRef.current = sig;
    const myToken = ++datasetTokenRef.current;

    try {
      const newLogs: LogItem[] = [];

      if (datasetKeyRef.current) {
        // dataset info
        if (infoInChain) {
          dsInfoRef.current = await fetchJSON<DatasetInfo>(
            `${API_BASE}/datasets/${encodeURIComponent(
              datasetKeyRef.current
            )}/info`
          );
          newLogs.push({
            kind: "card",
            title: "Dataset Info",
            lines: [
              `Name: ${dsInfoRef.current.name}`,
              `Classes: ${dsInfoRef.current.classes.join(", ") || "(none)"}`,
            ],
          });
        }

        // class counts
        if (countsInChain) {
          if (!dsInfoRef.current) {
            dsInfoRef.current = await fetchJSON<DatasetInfo>(
              `${API_BASE}/datasets/${encodeURIComponent(
                datasetKeyRef.current
              )}/info`
            );
          }
          const lines = Object.entries(dsInfoRef.current.approx_count || {}).map(
            ([c, n]) => `${c}: ${n}`
          );
          newLogs.push({
            kind: "card",
            title: "Class Counts",
            lines: lines.length ? lines : ["(no images)"],
          });
        }

        // distribution chart
        if (distInChain) {
          if (!dsInfoRef.current) {
            dsInfoRef.current = await fetchJSON<DatasetInfo>(
              `${API_BASE}/datasets/${encodeURIComponent(
                datasetKeyRef.current
              )}/info`
            );
          }
          const total =
            Object.values(dsInfoRef.current.approx_count || {}).reduce(
              (a, c) => a + c,
              0
            ) || 1;
          const chart = Object.entries(dsInfoRef.current.approx_count || {}).map(
            ([label, count]) => ({
              label,
              percent: (count / total) * 100,
            })
          );
          newLogs.push({
            kind: "chart",
            title: "Class Distribution (%)",
            data: chart,
          });
        }
      }

      // sample + split (keep sample pinned: only refetch when dataset or index actually change)
      if (datasetKeyRef.current && sampleConf && sampleInChain) {
        const needsFetch =
          !sampleRef.current ||
          sampleRef.current.dataset_key !== datasetKeyRef.current ||
          (sampleConf.mode === "index" &&
            sampleRef.current.index_used !== (sampleConf.index ?? 0));

        if (needsFetch) {
          const url =
            sampleConf.mode === "index"
              ? `${API_BASE}/datasets/${encodeURIComponent(
                  datasetKeyRef.current
                )}/sample?mode=index&index=${sampleConf.index}`
              : `${API_BASE}/datasets/${encodeURIComponent(
                  datasetKeyRef.current
                )}/sample?mode=random`;

          sampleRef.current = await fetchJSON<SampleResp>(url);
          setCurrentSrc(sampleRef.current.image_data_url);
        }

        if (sampleRef.current) {
          newLogs.push({
            kind: "image",
            src: sampleRef.current.image_data_url,
            caption: `Sample — label: ${sampleRef.current.label}`,
          });

          if (splitInChain) {
            const split = await fetchJSON<SplitResp>(
              `${API_BASE}/datasets/${encodeURIComponent(
                datasetKeyRef.current
              )}/split_channels?path=${encodeURIComponent(sampleRef.current.path)}`
            );
            newLogs.push({
              kind: "images",
              items: [
                { src: split.r_data_url, caption: "Red channel" },
                { src: split.g_data_url, caption: "Green channel" },
                { src: split.b_data_url, caption: "Blue channel" },
              ],
            });
          }
        }
      }

      if (myToken === datasetTokenRef.current) {
        datasetLogsRef.current = newLogs;
        setLogs([...datasetLogsRef.current, ...pipelineLogsRef.current]);
      }
    } catch {
      // ignore transient errors
    }
  }

  /* ---------- Preprocessing preview (pipeline stages only) ---------- */
  async function previewPipelineDebounced() {
    const ws = workspaceRef.current;
    if (!ws || !stage || stage.type !== "pipeline") return;

    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(async () => {
      const token = ++genTokenRef.current;

      await ensureSample(ws);
      if (!sampleRef.current || !datasetKeyRef.current) return;

      const top = findFirstPipelineTop(ws);
      if (!top) {
        // no preprocessing yet, just keep dataset logs
        pipelineLogsRef.current = [];
        setLogs([...datasetLogsRef.current]);
        return;
      }

      const ops = blocksToOps(top);
      const ctxSig = JSON.stringify({
        ds: datasetKeyRef.current,
        samplePath: sampleRef.current.path,
        ops,
      });
      if (ctxSig === lastCtxSigRef.current) return;
      lastCtxSigRef.current = ctxSig;

      try {
        const resp = await fetchJSON<ApplyResp>(`${API_BASE}/preprocess/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataset_key: datasetKeyRef.current,
            path: sampleRef.current.path,
            ops,
          }),
        });

        if (token === genTokenRef.current) {
          setCurrentSrc(resp.after_data_url);
          const [h, w, c] = resp.after_shape;

          pipelineLogsRef.current = [
            {
              kind: "image",
              src: resp.after_data_url,
              caption: `Preprocessed sample — ${w}×${h}`,
            },
          ];
          setLogs([...datasetLogsRef.current, ...pipelineLogsRef.current]);
        }
      } catch {
        // ignore rapid-edit errors
      }
    }, 350);
  }

  /* ---------- Checklist (tri-state) ---------- */

  function computeChecklist(ws: WorkspaceSvg, s: StageConfig): StageChecklistItem[] {
    const items: StageChecklistItem[] = [];

    if (s.type === "pipeline") {
      const topPipeline = findFirstPipelineTop(ws);
      const connectedOrder = topPipeline ? walkConnectedChainFrom(topPipeline) : [];

      const expected = s.expectedOrder || [];
      const present = new Map<string, boolean>();
      expected.forEach((t) => present.set(t, connectedOrder.includes(t)));

      const orderOK = new Map<string, boolean>();
      if (expected.length > 0) {
        let pos = -1;
        for (const t of expected) {
          const i = connectedOrder.indexOf(t);
          const ok = i !== -1 && i > pos;
          orderOK.set(t, ok);
          if (ok) pos = i;
        }
      }

      (s.requiredBlocks || []).forEach((t) => {
        const inChain = !!present.get(t);
        const okOrder = !!orderOK.get(t);

        let paramOK = true;
        if (inChain && s.targetOps && topPipeline) {
          const spec = s.targetOps.find((o) => "m2." + o.type === t);
          const blk = findBlockByTypeInChain(topPipeline, t);
          if (spec && blk) paramOK = !paramMismatch(blk, spec);
        }

        let state: Tri = "missing";
        if (inChain) {
          if (!okOrder || !paramOK) state = "wrong_place";
          else state = "ok";
        }

        items.push({
          key: t,
          label: t.replace("m2.", "").replaceAll("_", " "),
          state,
        });
      });
    } else {
      // Loop + export stage
      const allBlocks = ws.getAllBlocks(false) as BlocklyBlock[];
      const loopBlock = allBlocks.find((b) => b.type === "m2.loop_dataset") || null;

      const loopInner = loopBlock?.getInputTargetBlock("DO") || null;
      const innerOrder = loopInner ? walkConnectedChainFrom(loopInner) : [];

      // Explicit checklist item for the loop itself
      const loopState: Tri = loopBlock ? "ok" : "missing";
      items.push({
        key: "m2.loop_dataset",
        label: "loop over dataset",
        state: loopState,
      });

      const required = s.requiredBlocksWithinLoop || [];
      const expected = s.expectedOrderWithinLoop || required;

      const present = new Map<string, boolean>();
      required.forEach((bt) => present.set(bt, innerOrder.includes(bt)));

      const orderOK = new Map<string, boolean>();
      if (expected.length > 0) {
        let pos = -1;
        for (const t of expected) {
          const i = innerOrder.indexOf(t);
          const ok = i !== -1 && i > pos;
          orderOK.set(t, ok);
          if (ok) pos = i;
        }
      }

      // Required blocks inside the loop body, including param checks (like 150×150)
      required.forEach((t) => {
        const inLoop = !!present.get(t);
        const okOrder = !!orderOK.get(t);

        let paramOK = true;
        if (inLoop && s.targetOps && loopInner) {
          const spec = s.targetOps.find((o) => "m2." + o.type === t);
          const blk = findBlockByTypeInChain(loopInner, t);
          if (spec && blk) paramOK = !paramMismatch(blk, spec);
        }

        let state: Tri = "missing";
        if (inLoop) {
          if (!okOrder || !paramOK) state = "wrong_place";
          else state = "ok";
        }

        items.push({
          key: t,
          label: `${t.replace("m2.", "").replaceAll("_", " ")} (inside loop)`,
          state,
        });
      });

      let exportState: Tri = "missing";
      if (loopBlock) {
        let cur: BlocklyBlock | null = loopBlock.getNextBlock();
        while (cur && cur.type !== "m2.export_dataset") cur = cur.getNextBlock();
        if (cur) exportState = "ok";
      }
      if (s.requireExportAfterLoop) {
        items.push({
          key: "m2.export_dataset",
          label: "export dataset (after loop)",
          state: exportState,
        });
      }
    }

    return items;
  }

  /* ---------- Param / value inspection for extra Baymax hints ---------- */

  function getParamHints(s: StageConfig) {
    const ws = workspaceRef.current;
    const hints = {
      extremeBC: false,
      extremeBlurSharp: false,
      resizePadAlmost150: false,
      normalizeModeNot01: false,
    };
    if (!ws) return hints;

    const stageKey = String(s.id);
    const allBlocks = ws.getAllBlocks(false) as BlocklyBlock[];

    // Stage 2: gently warn about very strong edits
    if (stageKey === "2") {
      for (const b of allBlocks) {
        if (b.type === "m2.brightness_contrast") {
          const B = Number(b.getFieldValue("B") || 0);
          const C = Number(b.getFieldValue("C") || 0);
          if (Math.abs(B) >= 40 || Math.abs(C) >= 40) {
            hints.extremeBC = true;
          }
        }
        if (b.type === "m2.blur_sharpen") {
          const blur = Number(b.getFieldValue("BLUR") || 0);
          const sharp = Number(b.getFieldValue("SHARP") || 0);
          if (blur >= 4 || sharp >= 4) {
            hints.extremeBlurSharp = true;
          }
        }
      }
    }

    // Stages 3 & 4: resize + pad present but not exactly 150×150 (pipeline)
    if (stageKey === "3" || stageKey === "4") {
      const top = findFirstPipelineTop(ws);
      if (top) {
        const resizeBlock = findBlockByTypeInChain(top, "m2.resize");
        const padBlock = findBlockByTypeInChain(top, "m2.pad");

        if (resizeBlock && padBlock) {
          const mode = resizeBlock.getFieldValue("MODE");
          const rw = Number(resizeBlock.getFieldValue("W") || 0);
          const rh = Number(resizeBlock.getFieldValue("H") || 0);
          const pw = Number(padBlock.getFieldValue("W") || 0);
          const ph = Number(padBlock.getFieldValue("H") || 0);
          if (
            mode === "size" &&
            (rw !== 150 || rh !== 150 || pw !== 150 || ph !== 150)
          ) {
            hints.resizePadAlmost150 = true;
          }
        }

        if (stageKey === "4") {
          const normBlock = findBlockByTypeInChain(top, "m2.normalize");
          if (normBlock) {
            const mode = (normBlock.getFieldValue("MODE") || "").toString();
            // Allow a few possible spellings of "0-1"
            const is01 =
              mode === "0-1" ||
              mode === "0_1" ||
              mode === "zero_one" ||
              mode === "ZERO_ONE";
            if (!is01 && mode !== "") {
              hints.normalizeModeNot01 = true;
            }
          }
        }
      }
    }

    // Stage 5: resize + pad in loop body but not exactly 150×150
    if (stageKey === "5") {
      const loopBlock =
        allBlocks.find((b) => b.type === "m2.loop_dataset") || null;
      const loopInner = loopBlock?.getInputTargetBlock("DO") || null;
      if (loopInner) {
        const resizeBlock = findBlockByTypeInChain(loopInner, "m2.resize");
        const padBlock = findBlockByTypeInChain(loopInner, "m2.pad");
        if (resizeBlock && padBlock) {
          const mode = resizeBlock.getFieldValue("MODE");
          const rw = Number(resizeBlock.getFieldValue("W") || 0);
          const rh = Number(resizeBlock.getFieldValue("H") || 0);
          const pw = Number(padBlock.getFieldValue("W") || 0);
          const ph = Number(padBlock.getFieldValue("H") || 0);
          if (
            mode === "size" &&
            (rw !== 150 || rh !== 150 || pw !== 150 || ph !== 150)
          ) {
            hints.resizePadAlmost150 = true;
          }
        }
      }
    }

    return hints;
  }

  /* ---------- Baymax driven by checklist ---------- */

  function updateBaymaxFromChecklist(
    s: StageConfig,
    items: StageChecklistItem[],
    _prevItems?: StageChecklistItem[]
  ) {
    const done = items.filter((i) => i.state === "ok").length;
    const missing = items.filter((i) => i.state === "missing");
    const wrong = items.filter((i) => i.state === "wrong_place");

    const stageKey = String(s.id);
    const hints = getParamHints(s);

    const loopItem = items.find((i) => i.key === "m2.loop_dataset");
    const exportItem = items.find((i) => i.key === "m2.export_dataset");

    if (items.length === 0) {
      const lines = [
        "Drag your preprocessing blocks into a single chain under the sample image. Each stage builds on the previous one.",
        "Start by choosing a dataset, grabbing a sample image block, then stack the preprocessing steps straight underneath.",
        "Think of this like plumbing: connect the dataset tap, attach the sample image, then route the flow through the blocks this stage cares about.",
      ];
      setBaymaxState(pickLine(lines, stageKey + "-empty"), "neutral", false);
      return;
    }

    if (wrong.length > 0) {
      // Special case: 150×150 resize + pad present but with wrong numbers
      if (
        (stageKey === "3" || stageKey === "4" || stageKey === "5") &&
        missing.length === 0 &&
        hints.resizePadAlmost150
      ) {
        if (stageKey === "5") {
          const lines = [
            "Inside the loop you’ve wired up resize and pad, which is perfect. Now set both of them to exactly 150 × 150 so every image your loop exports matches the earlier stages.",
            "Your loop body has the right structure, but the frame size is off. Change the resize and pad blocks inside the loop to 150×150 so the exported dataset lines up with the target.",
            "Loop pipeline detected: resize and pad are in place, but not yet at 150 × 150. Update those values inside the loop so every processed image lands in the same square.",
          ];
          setBaymaxState(
            pickLine(lines, stageKey + "-wrong-params-150-loop"),
            "warning",
            true
          );
          return;
        }

        if (stageKey === "4") {
          const lines = [
            "You’ve got resize and pad in this stage, but their sizes don’t match the 150 × 150 target yet. Fix those numbers first, then make sure your normalization step is in the right mode.",
            "The blocks are right, the order is fine, but the frame size is off. Set both resize and pad to 150 by 150, then check your normalize block afterward.",
            "Structure looks good. The next step is numeric: make resize and pad both 150 × 150 so the image matches the target before normalization.",
          ];
          setBaymaxState(
            pickLine(lines, stageKey + "-wrong-params-150-stage4"),
            "warning",
            true
          );
          return;
        }

        // Stage 3 (pipeline)
        const lines = [
          "You’ve found the right blocks for this stage, resize and pad are both in place. Now fine-tune them: set both to exactly 150 × 150 so your output frame matches the target.",
          "Almost perfect framing. You’re using resize and pad, but to pass this stage they both need to say 150 by 150. Once those numbers match, the target should line up.",
          "The structure is correct. The last piece is numeric: make sure the resize block makes the image 150 × 150 and the pad block also uses 150 × 150.",
        ];
        setBaymaxState(
          pickLine(lines, stageKey + "-wrong-params-150"),
          "warning",
          true
        );
        return;
      }

      // Special case: Stage 4 – normalize present, but wrong mode (we want 0–1 here)
      if (stageKey === "4" && missing.length === 0 && hints.normalizeModeNot01) {
        const lines = [
          "Nice, you’ve wired in a normalize step, that’s exactly what this stage is about. For this mission, switch the mode to the 0–1 option. The other modes are useful later, just not the one we’re practicing here.",
          "You’re using a normalization block, which is perfect. To complete this stage, change its mode to 0–1 so pixel values land neatly between 0 and 1.",
          "Normalization is in the right place, but its mode doesn’t match the stage goal. Pick the 0–1 mode: other modes are valid in real projects, but this exercise wants 0–1 specifically.",
        ];
        setBaymaxState(
          pickLine(lines, stageKey + "-wrong-normalize-mode"),
          "warning",
          true
        );
        return;
      }

      const lines =
        s.type === "loop_export"
          ? [
              loopItem?.state === "wrong_place" && !exportItem
                ? "Your loop is there, but the rest of the pipeline around it is a bit jumbled. Inside the loop should look like a mini preprocessing chain, and the save step should live just after the loop block."
                : "You’ve got the right ideas, but some blocks are in odd places. Make sure the loop body processes one image at a time, and the export block sits after the loop to write out the full dataset.",
              "Your factory line is a bit scrambled. Keep all the preprocessing steps inside the loop body, then place the export block as the final step outside.",
              "Loop check: the loop body should be ‘sample in → preprocess → result out’, then a single export block after the loop saves the processed dataset.",
            ]
          : [
              "You dropped some good blocks, but the order feels off. Earlier structural changes should sit closer to the sample image, and small tweaks can come later.",
              "Nice ingredients, slightly chaotic recipe. Try dragging blocks up or down so the story is: sample → tone/detail tweaks → big shape/size changes → numeric normalization.",
              "The chain is almost there, but the order matters. Think: brightness/contrast and sharpening first, then resizing and padding, then any normalize steps near the end.",
            ];
      setBaymaxState(
        pickLine(lines, stageKey + "-wrong-" + wrong.length),
        "warning",
        true
      );
      return;
    }

    if (missing.length > 0) {
      if (s.type === "loop_export") {
        // Stage 5 / loop-export style hints
        if (loopItem?.state === "missing") {
          const lines = [
            "For automation we need a loop first. Add the loop block so your preprocessing recipe can run over many images instead of just one.",
            "This stage wants a factory, not a single workstation. Drop in the loop block and then move your preprocessing steps inside it.",
            "We’re missing the loop that repeats your recipe. Add the loop block and plug your preprocessing chain into its body.",
          ];
          setBaymaxState(
            pickLine(lines, stageKey + "-loop-missing-loop"),
            "hint",
            true
          );
          return;
        }
        if (exportItem?.state === "missing") {
          const lines = [
            "Your loop can now process images, but nothing is saving the results. Add an export dataset block after the loop so the processed data is written out.",
            "Loop is good, preprocessing is inside, now you need a final export step after the loop to produce a new dataset.",
            "We’re missing the last piece: a save step after the loop. Add the export dataset block right under the loop.",
          ];
          setBaymaxState(
            pickLine(lines, stageKey + "-loop-missing-export"),
            "hint",
            true
          );
          return;
        }

        const lines = [
          "For this mission we want the whole preprocessing recipe running inside the loop, then a final step after it that saves everything as a new dataset. Check that all the key steps made it into the loop body.",
          "Your loop is running, but not all the core steps are inside it yet. Treat the loop body like a tiny version of your Stage 1–4 pipeline.",
          "We still need your full preprocessing recipe inside the loop, and a single export block after the loop that writes out the processed dataset.",
        ];
        setBaymaxState(
          pickLine(lines, stageKey + "-loop-missing-" + missing.length),
          "hint",
          true
        );
        return;
      }

      if (stageKey === "1") {
        const lines = [
          "This stage is about stripping away color so we only care about light and dark. Make sure your chain includes a grayscale step after the sample image.",
          "We’re teaching the model to ignore color here. Look for the block that converts to grayscale and wire it in near the top of your chain.",
          "Somewhere after the sample image we’re expecting a block that collapses color into brightness. Add that in to complete this mission.",
        ];
        setBaymaxState(
          pickLine(lines, stageKey + "-missing-" + missing.length),
          "hint",
          true
        );
      } else if (stageKey === "2") {
        const lines = [
          "Here we’re doing gentle cleanup: brightness/contrast and maybe smoothing or sharpening. Check that you have at least one lighting tweak and one detail/blur tweak in the chain.",
          "Stage 2 wants tidying blocks: something that adjusts light levels and something that smooths or sharpens edges. Add them after any grayscale step.",
          "Think of this as making the image easier to read: small brightness/contrast and blur/sharpen steps should both appear in this mission’s chain.",
        ];
        setBaymaxState(
          pickLine(lines, stageKey + "-missing-" + missing.length),
          "hint",
          true
        );
      } else if (stageKey === "3") {
        const lines = [
          "We’re aiming for a clean 150 × 150 landing pad. Make sure the resize step really makes the image 150 × 150, and the padding step uses the same size.",
          "This mission is all about consistent framing. Check that you both resize to 150×150 and pad to 150×150 so every image lands in the same square.",
          "Your chain should contain a precise 150×150 resize and a 150×150 pad. If either one is missing or set to a different size, the target image won’t match.",
        ];
        setBaymaxState(
          pickLine(lines, stageKey + "-missing-" + missing.length),
          "hint",
          true
        );
      } else if (stageKey === "4") {
        const lines = [
          "The goal now is to get pixel values into a nice, consistent numeric range. Look for the normalize step and place it toward the end of the chain.",
          "We’re not changing how the image looks, just how the numbers are scaled. Add the normalization block near the bottom of your preprocessing recipe.",
          "Stage 4 needs a block that rescales pixel values. For this mission we’re focusing on the 0–1 mode so values end up between 0 and 1.",
        ];
        setBaymaxState(
          pickLine(lines, stageKey + "-missing-" + missing.length),
          "hint",
          true
        );
      } else if (stageKey === "5") {
        const lines = [
          "This mission is about automation: run your full recipe over many images, then save them out. Your loop body should look like a mini preprocessing pipeline, and there should be a save step after the loop.",
          "We’re almost in production mode. Make sure your loop actually applies the full recipe, and that the export block is ready to write out the new dataset.",
          "Stage 5 expects: dataset → loop over images → full preprocessing inside the loop → one export block at the end. Something in that chain is still missing.",
        ];
        setBaymaxState(
          pickLine(lines, stageKey + "-missing-" + missing.length),
          "hint",
          true
        );
      } else if (stageKey === "bonus") {
        const lines = [
          "Bonus time: we’re hunting for outlines. Check that your chain includes an edge-focused step, not just brightness or size tweaks.",
          "For this bonus mission, we want the structure of the object to pop. Add an edge-detection step so the outlines stand out.",
          "Look for the block that emphasizes edges and shapes. Without it, this bonus pipeline will behave like an ordinary preprocessing stage.",
        ];
        setBaymaxState(
          pickLine(lines, stageKey + "-missing-" + missing.length),
          "hint",
          true
        );
      } else {
        const lines = [
          "Some of the core steps for this stage are still missing. Check which blocks are glowing in the toolbox and make sure they appear in your main chain.",
          "You’ve started the chain, but a few key blocks are still sitting in the toolbox. Add the ones that match this stage’s title and goal.",
          "We’re missing at least one of the blocks this stage is trying to teach. Use the glowing toolbox blocks and the target image as your guide, then drop those into the main chain.",
        ];
        setBaymaxState(
          pickLine(lines, stageKey + "-missing-generic-" + missing.length),
          "hint",
          true
        );
      }
      return;
    }

    // All checklist items structurally OK
    if (done === items.length && items.length > 0) {
      // Stage 2: gentle nudge about extreme values
      if (stageKey === "2" && (hints.extremeBC || hints.extremeBlurSharp)) {
        const lines = [
          "Your Stage 2 pipeline is structurally correct, but those brightness/contrast or blur/sharpen values are pretty strong. For preprocessing we usually prefer gentle nudges. Try smaller numbers so the images don’t look over-edited.",
          "Mission complete, with one optimization note: tone and blur settings work best when they’re subtle. Try dialing the sliders back a bit and watch how the preview changes.",
          "You’ve passed this stage, but I’d recommend softening the brightness/contrast or blur/sharpen parameters. Think ‘cleanup’, not ‘dramatic filter’.",
        ];
        setBaymaxState(
          pickLine(lines, stageKey + "-done-soften"),
          "hint",
          true
        );
        return;
      }

      if (s.type === "loop_export") {
        const lines = [
          "Nice, you’ve turned your preprocessing into a full-on production line and saved out a new dataset. Hit Submit & Run when you’re ready to process the real thing.",
          "Factory mode activated: your loop runs the full recipe and the export block is ready. When you’re ready, submit to process the real dataset.",
          "That’s a solid automation pipeline. Your loop plus export block mirrors how real ML teams prep data before training.",
        ];
        setBaymaxState(
          pickLine(lines, stageKey + "-done-loop"),
          "success",
          false
        );
      } else if (stageKey === "3") {
        const lines = [
          "Perfect 150 × 150 landing pad! Your resize and padding now work together so every image ends up in the same square frame.",
          "Your framing looks great: every sample should now land in a clean 150×150 window, just like the target.",
          "Nice work! Your resize and pad combo lock images into the exact square shape this stage is aiming for.",
        ];
        setBaymaxState(pickLine(lines, stageKey + "-done"), "success", false);
      } else if (stageKey === "4") {
        const lines = [
          "Great, your normalization step is in the right place and mode. Pixel values should now live in a stable 0–1 range for this stage.",
          "Numbers under control: your normalize block and its 0–1 mode give the model a calm, predictable input range.",
          "Stage 4 complete: your pipeline now ends with a clean normalization step, putting pixel values in the 0–1 range we wanted to practice.",
        ];
        setBaymaxState(pickLine(lines, stageKey + "-done"), "success", false);
      } else {
        const lines = [
          "This chain looks solid for this stage. If the target image on the right matches what you’re getting, you’re good to go. Try Submit & Run.",
          "All the stage blocks are in place and in a sensible order. Compare with the target image, then submit when you’re happy.",
          "Everything this stage was asking for is now wired up. If the visual goal looks aligned, you’re ready to run the pipeline.",
        ];
        setBaymaxState(pickLine(lines, stageKey + "-done"), "success", false);
      }
      return;
    }

    // Fallback “nearly” state (rare, but keep it clean and target-based)
    const lines = [
      "You’re close. Keep everything in one chain under the sample image and compare your result to the target image. The differences will tell you which block to tweak next.",
      "Almost there. Use the target image and the stage blocks counter as a checklist: one or two blocks just need to be added or nudged.",
      "You’re on the right track. Follow the glowing blocks in the toolbox and the target image on the right to decide what to change next.",
    ];
    setBaymaxState(
      pickLine(lines, stageKey + "-nearly-" + done),
      "neutral",
      true
    );
  }

  /* ---------- Submit & Run ---------- */
  async function run() {
    if (!stage || !workspaceRef.current) return;
    setRunning(true);
    setBaymaxTyping(true);

    try {
      const ws = workspaceRef.current;
      ensureDatasetKey(ws);
      await ensureSample(ws);

      const newLogs: LogItem[] = [];
      let ok = true;
      const lines: string[] = [];

      if (stage.type === "pipeline") {
        const top = findFirstPipelineTop(ws);
        if (!top || !datasetKeyRef.current || !sampleRef.current) {
          ok = false;
          lines.push(
            "• Make sure the dataset, sample, and preprocessing blocks are connected in one chain."
          );
        } else {
          const ops = blocksToOps(top);
          const resp = await fetchJSON<ApplyResp>(`${API_BASE}/preprocess/apply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dataset_key: datasetKeyRef.current,
              path: sampleRef.current.path,
              ops,
            }),
          });
          setCurrentSrc(resp.after_data_url);

          const [h, w, c] = resp.after_shape;
          newLogs.push({
            kind: "image",
            src: resp.after_data_url,
            caption: `Preprocessed sample — ${w}×${h}×${c}`,
          });

          const itemsNow = computeChecklist(ws, stage);
          setCheckItems(itemsNow);
          const allOk = itemsNow.every((i) => i.state === "ok");
          ok = ok && allOk;

          if (!allOk) {
            lines.push(
              "• Some preprocessing steps are missing, out of order, or have settings that don’t match this stage’s goal. Compare your output to the target image and follow Baymax’s hints. For example, stages that resize and pad want both at 150×150, and Stage 4 wants normalize in the 0–1 mode."
            );
          }
        }
      } else {
        // Loop + export stage
        const allBlocks = ws.getAllBlocks(false) as BlocklyBlock[];
        const loopBlock = allBlocks.find((b) => b.type === "m2.loop_dataset") || null;

        if (!loopBlock) {
          ok = false;
          lines.push("• Add the loop block and put your preprocessing pipeline inside it.");
        } else {
          const inner = loopBlock.getInputTargetBlock("DO");
          const ops = blocksToOps(inner);

          // Export block after loop
          let cur: BlocklyBlock | null = loopBlock.getNextBlock();
          let exportBlock: BlocklyBlock | null = null;
          while (cur) {
            if (cur.type === "m2.export_dataset") {
              exportBlock = cur;
              break;
            }
            cur = cur.getNextBlock();
          }

          const itemsNow = computeChecklist(ws, stage);
          setCheckItems(itemsNow);
          const structureOK = itemsNow.every((i) => i.state === "ok");
          ok = ok && structureOK;

          if (ok && datasetKeyRef.current && exportBlock) {
            const newName = exportBlock.getFieldValue("NAME") || "processed";
            const overwrite = exportBlock.getFieldValue("OVERWRITE") === "TRUE";

            const subsetMode = loopBlock.getFieldValue("SUBSET");
            const N = Number(loopBlock.getFieldValue("N") || 0);
            const shuffle = loopBlock.getFieldValue("SHUFFLE") === "TRUE";

            const resp = await fetchJSON<ExportResp>(
              `${API_BASE}/preprocess/batch_export`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  dataset_key: datasetKeyRef.current,
                  subset: {
                    mode: subsetMode,
                    n: subsetMode === "all" ? null : N,
                    shuffle,
                  },
                  ops,
                  new_dataset_name: newName,
                  overwrite,
                }),
              }
            );

            newLogs.push({
              kind: "card",
              title: "Export Complete",
              lines: [
                `New dataset: ${resp.new_dataset_key}`,
                `Images processed: ${resp.processed}`,
                `Classes: ${resp.classes.join(", ") || "(none)"}`,
              ],
            });
          } else if (!structureOK) {
            ok = false;
            lines.push(
              "• The loop body should contain the full preprocessing recipe (with the same 150×150 frame as earlier stages), and there should be a save step right after the loop."
            );
          } else if (!datasetKeyRef.current) {
            ok = false;
            lines.push("• Add a 'use dataset' block so we know which dataset to loop over.");
          } else if (!exportBlock) {
            ok = false;
            lines.push("• Add a block after the loop that saves the processed dataset.");
          }
        }
      }

      const stageKey = String(stage.id);

      if (ok) {
        setSubmitSuccess(true);

        if (stage.type === "loop_export") {
          setSubmitTitle("Stage Complete - Pipeline on repeat!");
          setSubmitLines([
            "✓ You wrapped the preprocessing steps inside a loop and exported a new dataset. This is exactly how real ML pipelines get their data ready.",
          ]);
        } else if (stageKey === "1") {
          setSubmitTitle("Stage 1 Complete - Seeing in grayscale");
          setSubmitLines([
            "✓ You built a pipeline that reduces the image to light and dark while keeping the structure clear. Great base step for later stages.",
          ]);
        } else if (stageKey === "2") {
          setSubmitTitle("Stage 2 Complete - Clean up the signal");
          setSubmitLines([
            "✓ You added gentle lighting and detail tweaks so images are clearer without being over-edited.",
          ]);
        } else if (stageKey === "3") {
          setSubmitTitle("Stage 3 Complete - Frame locked in");
          setSubmitLines([
            "✓ Your pipeline now shapes images into a consistent square space without weird stretching.",
          ]);
        } else if (stageKey === "4") {
          setSubmitTitle("Stage 4 Complete - Numbers under control");
          setSubmitLines([
            "✓ You normalized pixel values into a stable range, which helps training behave nicely later.",
          ]);
        } else if (stageKey === "bonus") {
          setSubmitTitle("Bonus Stage Complete - Edge detective");
          setSubmitLines([
            "✓ You used an edge-focused pipeline to highlight outlines and structure. This is a powerful optional trick for shape-heavy tasks.",
          ]);
        } else {
          setSubmitTitle("Stage Complete!");
          setSubmitLines([
            "✓ All required preprocessing steps are in place for this mission.",
          ]);
        }

        setCanGoNext(true);
        setLogs((prev) => [...prev, ...newLogs]);
        setBaymaxState(
          stage.type === "loop_export"
            ? "That’s a full preprocessing production line right there. Your dataset is officially glow-up ready for training."
            : "Nice, this stage’s pipeline looks solid. When you’re ready, we can hop to the next mission and layer more steps on top.",
          "success",
          false
        );
      } else {
        setSubmitSuccess(false);
        setSubmitTitle("Keep tuning this stage");
        if (lines.length === 0) {
          lines.push(
            "• Some core steps for this stage are still missing or out of order. Check Baymax’s hints on the right and tweak your chain."
          );
        }
        setSubmitLines(lines);
        setLogs((prev) => [...prev, ...newLogs]);

        let failLine: string;
        if (stage.type === "loop_export") {
          failLine =
            "You’re close to a full automation pipeline. Make sure the loop body looks like a mini preprocessing chain with the same 150×150 frame as before, and that an export dataset block sits right after the loop to save the results.";
        } else if (stageKey === "3") {
          failLine =
            "You’re not far off. You’re using the right kinds of blocks—now match the exact frame by setting both resize and pad to 150 × 150, then compare your output to the target image.";
        } else if (stageKey === "4") {
          failLine =
            "You’re close. Double-check your resize/pad values (150 × 150) and your normalize block: for this stage, switch its mode to 0–1 so values end up between 0 and 1.";
        } else {
          failLine =
            "You’re not far off. Compare your output with the target image on the right and use my hints to decide whether you need to add a block, change the order, or tweak a parameter.";
        }

        setBaymaxState(failLine, "warning", false);
        setCanGoNext(false);
      }

      setSubmitOpen(true);
    } catch (e: any) {
      setSubmitSuccess(false);
      setCanGoNext(false);
      setSubmitTitle("Error while running");
      setSubmitLines([e?.message || String(e)]);
      setSubmitOpen(true);
      setBaymaxState(
        "Something broke while running the pipeline. Fix any obvious errors and try again.",
        "error",
        false
      );
    } finally {
      setRunning(false);
    }
  }

  /* ---------- Navigation helpers ---------- */
  function goModuleHome() {
    router.push("/module2");
  }

  function goHome() {
    router.push("/");
  }

  function goNext() {
    if (nextStage) {
      router.push(`/module2/${nextStage.id}`);
    } else {
      router.push("/module2");
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
      {/* Top nav – styled like Module 1’s, but for Module 2 */}
      <header className="fixed top-0 left-0 right-0 z-20 backdrop-blur-xl bg-white/70 border-b border-white/60 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold text-slate-900">VisionBlocks</span>
            <span className="text-xs text-slate-500">
              Module 2 · Image preprocessing · {stage.title}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* Home button */}
            <button
              onClick={goHome}
              className="px-3 py-1.5 rounded-full border border-slate-300 bg-white/80 text-xs font-medium text-slate-700 hover:border-sky-400 hover:text-sky-600 hover:shadow-[0_0_0_1px_rgba(56,189,248,0.45)] transition"
            >
              Home
            </button>

            {/* Module 2 main page */}
            <button
              onClick={goModuleHome}
              className="px-3 py-1.5 rounded-full border border-slate-300 bg-white/80 text-xs font-medium text-slate-700 hover:border-sky-400 hover:text-sky-600 hover:shadow-[0_0_0_1px_rgba(56,189,248,0.45)] transition"
            >
              Module 2
            </button>

            {/* Submit & Run (neon-ish green) */}
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

            {/* Next Stage */}
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

      {/* Main layout (like Module 1) */}
      <div className="pt-20 h-full">
        <div
          className="max-w-[1400px] mx-auto px-4 h-[calc(100vh-5rem)] grid gap-4"
          style={{ gridTemplateColumns: `minmax(0, 1.9fr) minmax(0, 1.2fr)` }}
        >
          {/* LEFT: Blockly workspace */}
          <div className="h-full min-h-0 rounded-3xl bg-white shadow-[0_22px_60px_rgba(15,23,42,0.25)] border border-white/70 overflow-hidden">
            <div ref={blocklyDivRef} className="w-full h-full min-h-0" />
          </div>

          {/* RIGHT: Baymax + target + output */}
          <div className="h-full min-h-0 rounded-3xl border border-white/80 bg-gradient-to-b from-white/90 to-[#E0E5F4] shadow-[0_18px_45px_rgba(15,23,42,0.22)] flex flex-col">
            <div className="flex flex-col min-h-0 px-4 py-4 gap-4">
              {/* Top row: stage blocks chip + help button */}
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

              {/* Baymax helper */}
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

              {/* Target vs current (pipeline stages only) */}
              {stage.type === "pipeline" && (
                <TargetPanel
                  targetSrc={targetSrc}
                  currentSrc={currentSrc}
                  dark={false}
                />
              )}

              {/* Output panel */}
              <div className="flex-1 min-h-0">
                <OutputPanel logs={logs} onClear={() => setLogs([])} dark={false} />
              </div>

              {/* Hidden checklist – used logically but not shown */}
              <div className="hidden">
                <MissionChecklistStage items={checkItems} dark={false} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Info modal */}
      <InfoModal
        open={infoOpen}
        title={infoTitle}
        text={infoText}
        dark={false}
        onClose={() => setInfoOpen(false)}
      />

      {/* Submission modal */}
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
