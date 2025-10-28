"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceSvg, Block as BlocklyBlock } from "blockly";
import { Blockly, setDatasetOptions } from "@/lib/blockly";
import { toolboxJsonModule2 } from "@/components/toolboxModule2";
import OutputPanel, { type LogItem } from "@/components/OutputPanel";
import BaymaxPanel from "@/components/BaymaxPanel";
import { DarkTheme, LightTheme } from "@/lib/blockly/theme";
import InfoModal from "@/components/InfoModal";
import MissionChecklist from "@/components/MissionChecklist";
import SubmissionModal from "@/components/SubmissionModal";

const API_BASE = "http://localhost:8000";

// ---------- Types ----------
type SampleResponse = {
  dataset_key: string;
  index_used: number;
  label: string;
  image_data_url: string;
  path: string;
};

type DatasetInfoResp = {
  key: string;
  name: string;
  description?: string | null;
  image_shape?: [number | null, number | null, number | null] | null;
  num_classes: number;
  classes: string[];
  approx_count: Record<string, number>;
  version?: string;
};

type ApplyResp = {
  dataset_key: string;
  path: string;
  before_data_url: string;
  after_data_url: string;
  after_shape: [number, number, number] | number[];
};

type BatchExportResp = {
  base_dataset: string;
  new_dataset_key: string;
  processed: number;
  classes: string[];
};

// ---------- Fetch helper ----------
async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ---------- Datasets refresh ----------
async function refreshDatasets(workspace?: WorkspaceSvg) {
  const data = await fetchJSON<{ items: { key: string; name: string }[] }>(
    `${API_BASE}/datasets`
  );
  setDatasetOptions(data.items.map((i) => ({ name: i.name, key: i.key })));

  if (!workspace) return;

  const blocks = workspace.getAllBlocks(false);
  const validKeys = new Set(data.items.map((i) => i.key));
  for (const b of blocks) {
    if (b.type === "dataset.select") {
      const field = b.getField("DATASET") as any;
      const cur = field?.getValue?.();
      if (cur && !validKeys.has(cur) && data.items.length > 0) {
        field.setValue(data.items[0].key);
      } else {
        field?.setValue(cur);
      }
    }
  }
}

// ---------- Convert blocks -> ops ----------
function blocksToOps(first: BlocklyBlock | null): any[] {
  const ops: any[] = [];
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
          });
        } else if (mode === "fit") {
          ops.push({
            type: "resize",
            mode: "fit",
            maxside: Number(b.getFieldValue("MAXSIDE") || 256),
          });
        } else {
          ops.push({
            type: "resize",
            mode: "scale",
            pct: Number(b.getFieldValue("PCT") || 100),
          });
        }
        break;
      }
      case "m2.crop_center":
        ops.push({
          type: "crop_center",
          w: Number(b.getFieldValue("W") || 224),
          h: Number(b.getFieldValue("H") || 224),
        });
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
        });
        break;
      case "m2.brightness_contrast":
        ops.push({
          type: "brightness_contrast",
          b: Number(b.getFieldValue("B") || 0),
          c: Number(b.getFieldValue("C") || 0),
        });
        break;
      case "m2.blur_sharpen":
        ops.push({
          type: "blur_sharpen",
          blur: Number(b.getFieldValue("BLUR") || 0),
          sharp: Number(b.getFieldValue("SHARP") || 0),
        });
        break;
      case "m2.edges":
        ops.push({
          type: "edges",
          method: b.getFieldValue("METHOD"),
          threshold: Number(b.getFieldValue("THRESH") || 100),
          overlay: b.getFieldValue("OVERLAY") === "TRUE",
        });
        break;
      case "m2.to_grayscale":
        ops.push({ type: "to_grayscale" });
        break;
      case "m2.normalize":
        ops.push({ type: "normalize", mode: b.getFieldValue("MODE") });
        break;
      default:
        break;
    }
    b = b.getNextBlock();
  }
  return ops;
}

function summarizeOps(ops: any[]): string[] {
  return ops.map((op) => {
    switch (op.type) {
      case "resize":
        if (op.mode === "size")
          return `Resize to ${op.w}×${op.h} (keep=${op.keep})`;
        if (op.mode === "fit") return `Resize fit ≤ ${op.maxside}`;
        return `Scale ${op.pct}%`;
      case "crop_center":
        return `Center crop ${op.w}×${op.h}`;
      case "pad":
        return `Pad ${op.w}×${op.h} (${op.mode}${
          op.mode === "constant" ? ` rgb(${op.r},${op.g},${op.b})` : ""
        })`;
      case "brightness_contrast":
        return `Brightness ${op.b}, Contrast ${op.c}`;
      case "blur_sharpen":
        return `Blur r=${op.blur}, Sharpen=${op.sharp}`;
      case "edges":
        return `Edges ${op.method} thr=${op.threshold} overlay=${op.overlay}`;
      case "to_grayscale":
        return "Grayscale";
      case "normalize":
        return `Normalize ${op.mode}`;
      default:
        return `Unknown op: ${op.type}`;
    }
  });
}

function labelOp(op: any): string {
  switch (op.type) {
    case "resize":
      if (op.mode === "size") return `Resize ${op.w}×${op.h}`;
      if (op.mode === "fit") return `Resize (fit ≤${op.maxside})`;
      return `Scale ${op.pct}%`;
    case "crop_center":
      return `Center crop ${op.w}×${op.h}`;
    case "pad":
      return `Pad ${op.w}×${op.h}${
        op.mode === "constant" ? ` (rgb ${op.r},${op.g},${op.b})` : ` (${op.mode})`
      }`;
    case "brightness_contrast":
      return `Brightness ${op.b}, Contrast ${op.c}`;
    case "blur_sharpen":
      return `Blur r=${op.blur}, Sharpen=${op.sharp}`;
    case "edges":
      return `Edges ${op.method} thr=${op.threshold}${
        op.overlay ? " (overlay)" : ""
      }`;
    case "to_grayscale":
      return "Grayscale";
    case "normalize":
      return `Normalize ${op.mode}`;
    default:
      return op.type;
  }
}

// ---------- Component ----------
export default function Module2Page() {
  // Mission targets
  const TARGET_W = 150;
  const TARGET_H = 150;

  const blocklyDivRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<WorkspaceSvg | null>(null);

  const [logs, setLogs] = useState<LogItem[]>([]);
  const [baymaxLine, setBaymaxLine] = useState<string>(
    "Preprocessing is like cleaning my glasses!"
  );
  const [dark, setDark] = useState<boolean>(true);
  const [running, setRunning] = useState<boolean>(false);

  // Info modal (for block explanations)
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTitle, setInfoTitle] = useState<string | undefined>();
  const [infoText, setInfoText] = useState<string | undefined>();

  // Submission modal
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitLines, setSubmitLines] = useState<string[]>([]);
  const [submitTitle, setSubmitTitle] = useState("Mission Result");

  // Checklist progress (now verified via real results)
  const [progress, setProgress] = useState({
    datasetSelected: false,
    sampleLoaded: false,
    resized: false,
    padded: false,
    clarity: false,
    exported: false,
  });

  // Session memory
  const datasetKeyRef = useRef<string | null>(null);
  const sampleRef = useRef<SampleResponse | null>(null);

  // Live preview throttle
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPreviewSigRef = useRef<string>("");

  const sizes = useMemo(() => ({ rightWidth: 380 }), []);

  // ---------- SMART CHECKLIST (verifies real outcome) ----------
  async function recomputeChecklist(ws: WorkspaceSvg | null) {
    if (!ws) return;

    const blocks = ws.getAllBlocks(false);
    const types = new Set(blocks.map((b) => b.type));

    const hasDataset = types.has("dataset.select");
    const hasSample  = types.has("dataset.sample_image");

    // Find first chain that contains any m2.* block
    let dsKey: string | null = null;
    let sampleMode: "random" | "index" | null = null;
    let sampleIndex = 0;
    let chain: BlocklyBlock | null = null;

    for (const top of ws.getTopBlocks(true) as BlocklyBlock[]) {
      for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
        if (b.type === "dataset.select" && !dsKey) dsKey = b.getFieldValue("DATASET");
        if (b.type === "dataset.sample_image" && sampleMode === null) {
          const mode = b.getFieldValue("MODE") as "random" | "index";
          sampleMode = mode;
          const idxRaw = b.getFieldValue("INDEX");
          sampleIndex = typeof idxRaw === "number" ? idxRaw : parseInt(String(idxRaw || 0), 10) || 0;
        }
        if (!chain && b.type.startsWith("m2.")) chain = top;
      }
    }

    // Strict mission checks (numbers matter)
    let resizedTowards150 = false;
    let padBlockExact150  = false;
    let clarityOK         = false;
    let finalIs150x150    = false;

    if (chain && dsKey && sampleMode) {
      // Ensure we have a sample for evaluation
      if (
        !sampleRef.current ||
        sampleRef.current.dataset_key !== dsKey ||
        (sampleMode === "index" && sampleRef.current.index_used !== sampleIndex)
      ) {
        const url = `${API_BASE}/datasets/${encodeURIComponent(dsKey)}/sample?mode=${sampleMode}${
          sampleMode === "index" ? `&index=${sampleIndex}` : ""
        }`;
        sampleRef.current = await fetchJSON<SampleResponse>(url);
        datasetKeyRef.current = dsKey;
      } else {
        datasetKeyRef.current = dsKey;
      }

      // Walk the chain to grab exact params
      let bVal = 0, cVal = 0, sharpVal = 0;
      for (let b: BlocklyBlock | null = chain; b; b = b.getNextBlock()) {
        if (b.type === "m2.resize") {
          const mode = b.getFieldValue("MODE");
          if (mode === "size") {
            const w = Number(b.getFieldValue("W") || 0);
            const h = Number(b.getFieldValue("H") || 0);
            const keep = String(b.getFieldValue("KEEP") || "FALSE").toUpperCase() === "TRUE";
            if (keep && (w === 150 || h === 150)) resizedTowards150 = true;
          } else if (mode === "fit") {
            const ms = Number(b.getFieldValue("MAXSIDE") || 0);
            if (ms === 150) resizedTowards150 = true;
          }
          // scale(%) not counted toward this exact mission target
        }
        if (b.type === "m2.pad") {
          const w = Number(b.getFieldValue("W") || 0);
          const h = Number(b.getFieldValue("H") || 0);
          if (w === 150 && h === 150) padBlockExact150 = true;
        }
        if (b.type === "m2.brightness_contrast") {
          bVal = Number(b.getFieldValue("B") || 0);
          cVal = Number(b.getFieldValue("C") || 0);
        }
        if (b.type === "m2.blur_sharpen") {
          sharpVal = Number(b.getFieldValue("SHARP") || 0);
        }
      }
      const bOK = bVal >= -30 && bVal <= 30;
      const cOK = cVal >= -30 && cVal <= 30;
      const sOK = sharpVal <= 2.5;
      clarityOK = (bVal !== 0 || cVal !== 0 || sharpVal !== 0) && bOK && cOK && sOK;

      // Apply pipeline once to verify final size with server truth
      const ops = blocksToOps(chain);
      const applyResp = await fetchJSON<ApplyResp>(`${API_BASE}/preprocess/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_key: datasetKeyRef.current,
          path: sampleRef.current.path,
          ops,
        }),
      });
      const [h, w] = applyResp.after_shape as [number, number, number];
      finalIs150x150 = (w === 150 && h === 150);
    }

    setProgress(prev => ({
      datasetSelected: hasDataset,
      sampleLoaded: hasSample,
      // only count as complete if the *specific* numeric target is met
      resized: resizedTowards150,
      // must BOTH (1) have a pad block set to 150x150 and (2) actually end up 150x150
      padded: padBlockExact150 && finalIs150x150,
      clarity: clarityOK,
      // leave export sticky: turns true after a successful export in run()
      exported: prev.exported,
    }));
  }


  // ---------- Live preview (unchanged behavior) ----------
  async function livePreview(): Promise<void> {
    const ws = workspaceRef.current;
    if (!ws) return;

    let dsKey: string | null = null;
    let sampleMode: "random" | "index" | null = null;
    let sampleIndex = 0;
    let previewChain: BlocklyBlock | null = null;

    const tops = ws.getTopBlocks(true) as BlocklyBlock[];
    for (const top of tops) {
      for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
        if (b.type === "dataset.select" && !dsKey)
          dsKey = b.getFieldValue("DATASET");
        if (b.type === "dataset.sample_image" && sampleMode === null) {
          const mode = b.getFieldValue("MODE") as "random" | "index";
          sampleMode = mode;
          const idxRaw = b.getFieldValue("INDEX");
          sampleIndex =
            typeof idxRaw === "number"
              ? idxRaw
              : parseInt(String(idxRaw || 0), 10) || 0;
        }
        if (!previewChain && b.type.startsWith("m2.")) previewChain = top;
      }
    }

    if (!previewChain) return;
    if (!dsKey || !sampleMode) {
      setLogs((prev) => [
        ...prev,
        {
          kind: "warn",
          text: "Add 'use dataset' and 'get sample image' to see live preview.",
        },
      ]);
      return;
    }

    const fullOps = blocksToOps(previewChain);
    const sig = JSON.stringify({
      dsKey,
      sample: { mode: sampleMode, index: sampleIndex },
      ops: fullOps,
    });
    if (sig === lastPreviewSigRef.current) return;
    lastPreviewSigRef.current = sig;

    // Ensure sample
    if (
      !sampleRef.current ||
      sampleRef.current.dataset_key !== dsKey ||
      (sampleMode === "index" && sampleRef.current.index_used !== sampleIndex)
    ) {
      const url = `${API_BASE}/datasets/${encodeURIComponent(
        dsKey
      )}/sample?mode=${sampleMode}${
        sampleMode === "index" ? `&index=${sampleIndex}` : ""
      }`;
      const sample = await fetchJSON<SampleResponse>(url);
      datasetKeyRef.current = dsKey;
      sampleRef.current = sample;
    } else {
      datasetKeyRef.current = dsKey;
    }

    const newLogs: LogItem[] = [];
    newLogs.push({
      kind: "image",
      src: sampleRef.current.image_data_url,
      caption: "Original",
    });

    const summary = summarizeOps(fullOps);
    if (summary.length)
      newLogs.push({ kind: "card", title: "Pipeline (live)", lines: summary });

    const cumulative: any[] = [];
    for (const op of fullOps) {
      cumulative.push(op);
      const body = {
        dataset_key: dsKey,
        path: sampleRef.current.path,
        ops: cumulative,
      };
      const stepResp = await fetchJSON<ApplyResp>(
        `${API_BASE}/preprocess/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const [h, w] = stepResp.after_shape as [number, number, number];
      newLogs.push({
        kind: "image",
        src: stepResp.after_data_url,
        caption: `${labelOp(op)} — ${w}×${h}`,
      });
    }

    setLogs(newLogs);
    setBaymaxLine("Each block’s effect is shown step-by-step!");

    // Recompute checklist after preview (so final size reflects current pipeline)
    await recomputeChecklist(ws);
  }

  // ---------- Evaluate mission on submit ----------
  function evaluateMission(
    finalShape?: [number, number, number],
    _unused?: { b?: number; c?: number; sharp?: number }
  ) {
    const lines: string[] = [];
    let ok = true;

    if (!progress.datasetSelected) { ok = false; lines.push("• Select a dataset."); }
    if (!progress.sampleLoaded)   { ok = false; lines.push("• Load a sample image."); }

    // Resize target
    if (progress.resized) {
      lines.push("✓ Resized toward 150×150 with keep-aspect (or fit=150).");
    } else {
      ok = false;
      lines.push("• Resize toward 150×150 with keep aspect (size with one side 150, or fit with max side 150).");
    }

    // Pad + final size must be exact
    if (finalShape) {
      const [h, w] = finalShape;
      if (progress.padded && w === 150 && h === 150) {
        lines.push("✓ Padded to exactly 150×150.");
      } else {
        ok = false;
        lines.push(`• Final size is ${w}×${h}. Add a Pad block set to 150×150 to meet the target exactly.`);
      }
    } else if (!progress.padded) {
      ok = false;
      lines.push("• Add a Pad block set to 150×150 to reach the exact size.");
    }

    // Clarity gentle
    if (progress.clarity) {
      lines.push("✓ Clarity adjusted gently (brightness/contrast ≤ 30, sharpen ≤ 2.5).");
    } else {
      ok = false;
      lines.push("• Improve clarity with small brightness/contrast or sharpen (keep values gentle).");
    }

    // Export is optional in this mission (you can make it required by flipping this)
    if (progress.exported) {
      lines.push("✓ Export completed or export block present.");
    } else {
      lines.push("• (Optional) Export your processed dataset.");
    }

    return { ok, lines };
  }


  // ---------- Lifecycle ----------
  useEffect(() => {
    if (!blocklyDivRef.current) return;

    const ws = Blockly.inject(blocklyDivRef.current, {
      toolbox: toolboxJsonModule2,
      renderer: "zelos",
      theme: dark ? DarkTheme : LightTheme,
      trashcan: true,
      scrollbars: true,
      zoom: { controls: true, wheel: true, startScale: 0.9 },
    });
    workspaceRef.current = ws;

    ws.clear();
    try {
      (ws as any).scrollCenter?.();
    } catch {}

    refreshDatasets(ws).catch(() => {});

    const onInfo = (e: any) => {
      const { title, text } = (e?.detail ?? {}) as {
        title?: string;
        text?: string;
      };
      setInfoTitle(title || "What does this block do?");
      setInfoText(text || "");
      setInfoOpen(true);
    };
    window.addEventListener("vb:blockInfo", onInfo as any);

    const onChange = (evt: any) => {
      const E = (Blockly as any).Events;
      const uiTypes = new Set([
        E.UI,
        E.CLICK,
        E.VIEWPORT_CHANGE,
        E.TOOLBOX_ITEM_SELECT,
        E.THEME_CHANGE,
        E.BUBBLE_OPEN,
        E.TRASHCAN_OPEN,
        E.SELECTED,
      ]);
      if (evt && evt.type && uiTypes.has(evt.type)) return;

      // Smart checklist recompute (verified via backend)
      recomputeChecklist(ws);

      // Throttled live preview
      if (previewTimer.current) clearTimeout(previewTimer.current);
      previewTimer.current = setTimeout(() => {
        livePreview().catch((e) => {
          setLogs((prev) => [
            ...prev,
            {
              kind: "error",
              text: `Live preview failed: ${e?.message || String(e)}`,
            },
          ]);
        });
      }, 400);
    };
    ws.addChangeListener(onChange);

    // Initial checklist state
    recomputeChecklist(ws);

    return () => {
      window.removeEventListener("vb:blockInfo", onInfo as any);
      ws.removeChangeListener(onChange);
      ws.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocklyDivRef.current]);

  useEffect(() => {
    if (!workspaceRef.current) return;
    workspaceRef.current.setTheme(dark ? DarkTheme : LightTheme);
  }, [dark]);

  // ---------- Submit & Run ----------
  async function run(): Promise<void> {
    const ws = workspaceRef.current;
    if (!ws) return;

    setRunning(true);
    const newLogs: LogItem[] = [];
    let didExport = false;

    let clarityUsed: { b?: number; c?: number; sharp?: number } | undefined;
    let finalShapeForEval: [number, number, number] | undefined;

    try {
      const tops = ws.getTopBlocks(true) as BlocklyBlock[];
      datasetKeyRef.current = null;
      sampleRef.current = null;

      // Pass 1: dataset blocks (info / counts / class distribution / sample / show)
      for (const top of tops) {
        let b: BlocklyBlock | null = top;
        while (b) {
          if (b.type === "dataset.select") {
            const key = b.getFieldValue("DATASET");
            datasetKeyRef.current = key;
            newLogs.push({ kind: "info", text: `[info] Using dataset: ${key}` });
          }

          if (b.type === "dataset.info") {
            if (!datasetKeyRef.current) {
              newLogs.push({
                kind: "warn",
                text: "Add 'use dataset' before 'dataset info'.",
              });
            } else {
              const info = await fetchJSON<DatasetInfoResp>(
                `${API_BASE}/datasets/${encodeURIComponent(
                  datasetKeyRef.current
                )}/info`
              );
              const lines: string[] = [
                `Name: ${info.name}`,
                `Classes: ${info.classes.join(", ") || "(none)"}`,
              ];
              newLogs.push({ kind: "card", title: "Dataset Info", lines });
            }
          }

          if (b.type === "dataset.class_counts") {
            if (!datasetKeyRef.current) {
              newLogs.push({
                kind: "warn",
                text: "Add 'use dataset' before 'class counts'.",
              });
            } else {
              const info = await fetchJSON<DatasetInfoResp>(
                `${API_BASE}/datasets/${encodeURIComponent(
                  datasetKeyRef.current
                )}/info`
              );
              const lines = Object.entries(info.approx_count || {}).map(
                ([cls, n]) => `${cls}: ${n}`
              );
              newLogs.push({
                kind: "card",
                title: "Class Counts",
                lines: lines.length ? lines : ["(no images)"],
              });
            }
          }

          if (b.type === "dataset.class_distribution_preview") {
            if (!datasetKeyRef.current) {
              newLogs.push({
                kind: "warn",
                text: "Add 'use dataset' before 'class distribution preview'.",
              });
            } else {
              const info = await fetchJSON<DatasetInfoResp>(
                `${API_BASE}/datasets/${encodeURIComponent(
                  datasetKeyRef.current
                )}/info`
              );
              const total = Object.values(info.approx_count || {}).reduce(
                (a, c) => a + c,
                0
              );
              const lines =
                total > 0
                  ? info.classes.map((cls) => {
                      const n = info.approx_count?.[cls] ?? 0;
                      const pct = ((n / total) * 100).toFixed(1);
                      return `${cls}: ${pct}%`;
                    })
                  : ["(no images)"];
              newLogs.push({
                kind: "card",
                title: "Class Distribution (%)",
                lines,
              });
            }
          }

          if (b.type === "dataset.sample_image") {
            if (!datasetKeyRef.current) {
              newLogs.push({
                kind: "warn",
                text: "Please add 'use dataset' before 'get sample image'.",
              });
              break;
            }
            const mode = b.getFieldValue("MODE") as "random" | "index";
            const idxRaw = b.getFieldValue("INDEX");
            const idx =
              typeof idxRaw === "number"
                ? idxRaw
                : parseInt(String(idxRaw || 0), 10) || 0;
            const url = `${API_BASE}/datasets/${encodeURIComponent(
              datasetKeyRef.current!
            )}/sample?mode=${mode}${mode === "index" ? `&index=${idx}` : ""}`;
            const sample = await fetchJSON<SampleResponse>(url);
            sampleRef.current = sample;
            newLogs.push({
              kind: "preview",
              text:
                mode === "index"
                  ? `[preview] sample image loaded (index ${sample.index_used})`
                  : `[preview] sample image loaded (random index ${sample.index_used})`,
            });
          }

          if (b.type === "image.show") {
            if (!sampleRef.current)
              newLogs.push({
                kind: "warn",
                text: "Get a sample image first, then 'show image'.",
              });
            else {
              const title = (b.getFieldValue("TITLE") as string) || "Original";
              newLogs.push({
                kind: "image",
                src: sampleRef.current.image_data_url,
                caption: `${title} — label: ${sampleRef.current.label}`,
              });
            }
          }

          b = b.getNextBlock();
        }
      }

      // Pass 2: run a single m2 chain to capture final shape & clarity params
      for (const top of ws.getTopBlocks(true) as BlocklyBlock[]) {
        let chainHasM2 = false;
        for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
          if (b.type.startsWith("m2.")) {
            chainHasM2 = true;
            break;
          }
        }
        if (!chainHasM2) continue;
        if (!datasetKeyRef.current || !sampleRef.current) break;

        for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
          if (b.type === "m2.brightness_contrast") {
            clarityUsed = clarityUsed || {};
            clarityUsed.b = Number(b.getFieldValue("B") || 0);
            clarityUsed.c = Number(b.getFieldValue("C") || 0);
          }
          if (b.type === "m2.blur_sharpen") {
            clarityUsed = clarityUsed || {};
            clarityUsed.sharp = Number(b.getFieldValue("SHARP") || 0);
          }
        }

        const ops = blocksToOps(top);
        const applyResp = await fetchJSON<ApplyResp>(
          `${API_BASE}/preprocess/apply`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dataset_key: datasetKeyRef.current,
              path: sampleRef.current.path,
              ops,
            }),
          }
        );
        finalShapeForEval = applyResp.after_shape as [
          number,
          number,
          number
        ];
        break;
      }

      // Pass 3: loop + export (unchanged)
      for (const top of ws.getTopBlocks(true) as BlocklyBlock[]) {
        let b: BlocklyBlock | null = top;
        while (b) {
          if (b.type === "m2.loop_dataset") {
            if (!datasetKeyRef.current) {
              newLogs.push({
                kind: "warn",
                text: "Add 'use dataset' before the loop block.",
              });
              break;
            }
            const subsetMode = b.getFieldValue("SUBSET");
            const N = Number(b.getFieldValue("N") || 0);
            const shuffle = b.getFieldValue("SHUFFLE") === "TRUE";
            const K = Number(b.getFieldValue("K") || 10);

            const inner = b.getInputTargetBlock("DO");
            const innerOps = blocksToOps(inner);
            const innerSummary = summarizeOps(innerOps);

            newLogs.push({
              kind: "card",
              title: "Loop",
              lines: [
                `Subset: ${subsetMode}${
                  subsetMode !== "all" ? ` (N=${N})` : ""
                }`,
                `Shuffle: ${shuffle}`,
                `Progress every: ${K} images`,
                "Pipeline:",
                ...innerSummary.map((s) => `• ${s}`),
              ],
            });

            // find export after loop
            let cursor: BlocklyBlock | null = b.getNextBlock();
            let exportBlock: BlocklyBlock | null = null;
            while (cursor) {
              if (cursor.type === "m2.export_dataset") {
                exportBlock = cursor;
                break;
              }
              cursor = cursor.getNextBlock();
            }
            if (!exportBlock) {
              newLogs.push({
                kind: "warn",
                text:
                  "Add 'export processed dataset' after the loop to save results.",
              });
              break;
            }

            const newName = exportBlock.getFieldValue("NAME") || "processed";
            const overwrite = exportBlock.getFieldValue("OVERWRITE") === "TRUE";

            const resp = await fetchJSON<BatchExportResp>(
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
                  ops: innerOps,
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
                `Classes: ${resp.classes.join(", ")}`,
              ],
            });

            didExport = true;
            await refreshDatasets(workspaceRef.current);
          }
          b = b.getNextBlock();
        }
      }

      // Evaluate mission
      if (didExport) setProgress((p) => ({ ...p, exported: true }));
      // Recompute checklist one more time to ensure exact booleans are current
      await recomputeChecklist(ws);

      const evalResult = evaluateMission(finalShapeForEval, undefined);
      setSubmitSuccess(evalResult.ok);
      setSubmitLines(evalResult.lines);
      setSubmitTitle(
        evalResult.ok ? "Mission Complete!" : "Keep Going: Almost There"
      );
      setSubmitOpen(true);

      setLogs((prev) => [...prev, ...newLogs]);
      setBaymaxLine(
        evalResult.ok
          ? "Woo! Everything’s crystal clear now! 🧼👀"
          : "Hmm, I still feel a bit fuzzy. Check the hints in the card!"
      );
    } catch (e: any) {
      setLogs((prev) => [
        ...prev,
        { kind: "error", text: `Run failed: ${e?.message || String(e)}` },
      ]);
      setBaymaxLine("Oops—my lenses fogged up. Can you check your blocks?");
      setSubmitSuccess(false);
      setSubmitLines(["An error occurred while running your pipeline."]);
      setSubmitTitle("Submission Error");
      setSubmitOpen(true);
    } finally {
      setRunning(false);
    }
  }

  // ---------- UI ----------
  const appBg = dark ? "bg-neutral-950" : "bg-white";
  const barBg = dark
    ? "bg-neutral-900 border-neutral-800"
    : "bg-white border-gray-200";
  const barText = dark ? "text-neutral-100" : "text-gray-900";
  const rightBg = dark
    ? "bg-neutral-950 border-neutral-800"
    : "bg-gray-50 border-gray-200";

  return (
    <div
      className={`h-screen w-screen ${appBg}`}
      style={{
        display: "grid",
        gridTemplateColumns: `minmax(0, 1fr) ${sizes.rightWidth}px`,
        gridTemplateRows: "48px 1fr",
      }}
    >
      {/* Top bar */}
      <div
        className={`col-span-2 flex items-center justify-between px-3 border-b ${barBg}`}
      >
        <div className={`font-semibold ${barText}`}>
          VisionBlocks — Module 2: Image Preprocessing
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => refreshDatasets(workspaceRef.current)}
            className={`px-3 py-1.5 rounded-md border ${
              dark
                ? "border-neutral-700 text-neutral-200 hover:bg-neutral-800"
                : "border-gray-300 text-gray-800 hover:bg-gray-50"
            }`}
            title="Reload dataset list"
          >
            Refresh datasets
          </button>

          <button
            onClick={() => setDark(!dark)}
            className={`px-3 py-1.5 rounded-md border ${
              dark
                ? "border-neutral-700 text-neutral-200 hover:bg-neutral-800"
                : "border-gray-300 text-gray-800 hover:bg-gray-50"
            }`}
            title="Toggle dark mode"
          >
            {dark ? "Light" : "Dark"}
          </button>

          <button
            onClick={() => {
              if (!running) run();
            }}
            className={`px-4 py-1.5 rounded-md ${
              running ? "opacity-60 cursor-not-allowed" : ""
            } bg-black text-white`}
            disabled={running}
          >
            {running ? "Submitting…" : "Submit & Run"}
          </button>
        </div>
      </div>

      {/* Workspace */}
      <div
        ref={blocklyDivRef}
        className={`relative min-h-0 ${dark ? "bg-neutral-950" : "bg-white"}`}
      />

      {/* Right column: scrollable with Checklist + Output + Baymax */}
      <div className={`border-l p-3 min-h-0 ${rightBg}`}>
        <div className="h-full min-h-0 flex flex-col gap-4 overflow-y-auto pr-1">
          <MissionChecklist
            progress={progress}
            dark={dark}
            sizeTarget={{ w: TARGET_W, h: TARGET_H }}
          />
          <OutputPanel logs={logs} onClear={() => setLogs([])} dark={dark} />
          <BaymaxPanel line={baymaxLine} dark={dark} />
        </div>
      </div>

      {/* Info modal for block explanations */}
      <InfoModal
        open={infoOpen}
        title={infoTitle}
        text={infoText}
        dark={dark}
        onClose={() => setInfoOpen(false)}
      />

      {/* Submission result modal */}
      <SubmissionModal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        dark={dark}
        title={submitTitle}
        lines={submitLines}
        success={submitSuccess}
      />
    </div>
  );
}
