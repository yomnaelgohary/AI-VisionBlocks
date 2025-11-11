"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceSvg, Block as BlocklyBlock } from "blockly";
import { Blockly } from "@/lib/blockly";
import { DarkTheme, LightTheme } from "@/lib/blockly/theme";
import { toolboxJsonModule2 } from "@/components/toolboxModule2";

import OutputPanel, { type LogItem } from "@/components/OutputPanel";
import BaymaxPanel from "@/components/BaymaxPanel";
import InfoModal from "@/components/InfoModal";
import SubmissionModal from "@/components/SubmissionModal";
import MissionChecklistStage, { type StageChecklistItem, type Tri } from "@/components/MissionChecklistStage";
import TargetPanel from "@/components/TargetPanel";

import { module2Stages, type StageConfig, type OpSpec } from "@/data/module2Stages";

const API_BASE = "http://localhost:8000";

/* ----------------- helpers ----------------- */
async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

type SampleResp = { dataset_key: string; index_used: number; label: string; image_data_url: string; path: string };

type ApplyResp = {
  dataset_key: string;
  path: string;
  before_data_url: string;
  after_data_url: string;
  after_shape: [number, number, number];
};

type ExportResp = { base_dataset: string; new_dataset_key: string; processed: number; classes: string[] };

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
          });
        } else if (mode === "fit") {
          ops.push({ type: "resize", mode: "fit", maxside: Number(b.getFieldValue("MAXSIDE") || 256) });
        } else {
          ops.push({ type: "resize", mode: "scale", pct: Number(b.getFieldValue("PCT") || 100) });
        }
        break;
      }
      case "m2.crop_center":
        ops.push({ type: "crop_center", w: Number(b.getFieldValue("W") || 224), h: Number(b.getFieldValue("H") || 224) });
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
        ops.push({ type: "brightness_contrast", b: Number(b.getFieldValue("B") || 0), c: Number(b.getFieldValue("C") || 0) });
        break;
      case "m2.blur_sharpen":
        ops.push({ type: "blur_sharpen", blur: Number(b.getFieldValue("BLUR") || 0), sharp: Number(b.getFieldValue("SHARP") || 0) });
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

function walkConnectedChainFrom(top: BlocklyBlock | null): string[] {
  const seq: string[] = [];
  for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) seq.push(b.type);
  return seq;
}

function findBlockByTypeInChain(top: BlocklyBlock | null, type: string): BlocklyBlock | null {
  for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) if (b.type === type) return b;
  return null;
}

/* ----------------- main component ----------------- */

export default function StageRunner({ stageId }: { stageId: string }) {
  const stage: StageConfig | undefined = useMemo(
    () => module2Stages.find(s => String(s.id) === String(stageId)),
    [stageId]
  );

  const blocklyDivRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<WorkspaceSvg | null>(null);

  const [dark, setDark] = useState(true);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [baymax, setBaymax] = useState("Let’s solve this stage together!");

  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTitle, setInfoTitle] = useState<string>();
  const [infoText, setInfoText] = useState<string>();

  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitTitle, setSubmitTitle] = useState("Submission");
  const [submitLines, setSubmitLines] = useState<string[]>([]);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const sampleRef = useRef<SampleResp | null>(null);
  const datasetKeyRef = useRef<string | null>(null);

  const [targetSrc, setTargetSrc] = useState<string>();
  const [currentSrc, setCurrentSrc] = useState<string>();

  const sizes = useMemo(() => ({ rightWidth: 380 }), []);

  useEffect(() => {
    if (!stage) return;

    const ws = Blockly.inject(blocklyDivRef.current!, {
      toolbox: toolboxJsonModule2,
      renderer: "zelos",
      theme: dark ? DarkTheme : LightTheme,
      trashcan: true,
      scrollbars: true,
      zoom: { controls: true, wheel: true, startScale: 0.9 },
    });

    workspaceRef.current = ws;
    try { (ws as any).scrollCenter?.(); } catch {}

    const onInfo = (e: any) => {
      const { title, text } = e?.detail ?? {};
      setInfoTitle(title || "About this block");
      setInfoText(text || "");
      setInfoOpen(true);
    };
    window.addEventListener("vb:blockInfo", onInfo as any);

    const onChange = () => {
      setTimeout(async () => {
        if (stage?.type === "pipeline") await previewPipeline().catch(() => {});
        setCheckItems(computeChecklist(ws, stage));
      }, 200);
    };
    ws.addChangeListener(onChange);

    // initial checklist
    setCheckItems(computeChecklist(ws, stage));

    return () => {
      window.removeEventListener("vb:blockInfo", onInfo as any);
      ws.removeChangeListener(onChange);
      ws.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageId, dark]);

  useEffect(() => {
    if (workspaceRef.current) workspaceRef.current.setTheme(dark ? DarkTheme : LightTheme);
  }, [dark]);

  /* ----------- core: preview & target generation ----------- */

  // New: read dataset key without needing a sample image (Stage 7 needs this)
  function ensureDatasetKey(ws: WorkspaceSvg) {
    let dsKey: string | null = null;
    const blocks = ws.getAllBlocks(false) as BlocklyBlock[];
    for (const b of blocks) {
      if (b.type === "dataset.select") {
        dsKey = b.getFieldValue("DATASET");
        break;
      }
    }
    if (dsKey) datasetKeyRef.current = dsKey;
  }

  async function ensureSample(ws: WorkspaceSvg): Promise<void> {
    let dsKey: string | null = null;
    let mode: "random" | "index" | null = null;
    let idx = 0;

    for (const top of ws.getTopBlocks(true) as BlocklyBlock[]) {
      for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
        if (b.type === "dataset.select" && !dsKey) dsKey = b.getFieldValue("DATASET");
        if (b.type === "dataset.sample_image" && mode === null) {
          mode = b.getFieldValue("MODE") as "random" | "index";
          const raw = b.getFieldValue("INDEX");
          idx = typeof raw === "number" ? raw : parseInt(String(raw || 0), 10) || 0;
        }
      }
    }

    // Always set dataset key if found, even if no sample block exists
    if (dsKey) datasetKeyRef.current = dsKey;
    if (!dsKey || !mode) return;

    const needFetch =
      !sampleRef.current ||
      sampleRef.current.dataset_key !== dsKey ||
      (mode === "index" && sampleRef.current.index_used !== idx);

    if (needFetch) {
      const url = `${API_BASE}/datasets/${encodeURIComponent(dsKey)}/sample?mode=${mode}${
        mode === "index" ? `&index=${idx}` : ""
      }`;
      const sample = await fetchJSON<SampleResp>(url);
      sampleRef.current = sample;

      // dynamic target for pipeline stages
      if (stage?.type === "pipeline" && stage.targetOps) {
        const tgt = await fetchJSON<ApplyResp>(`${API_BASE}/preprocess/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataset_key: dsKey,
            path: sample.path,
            ops: stage.targetOps,
          }),
        });
        setTargetSrc(tgt.after_data_url);
      }
    }
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

  async function previewPipeline(): Promise<void> {
    const ws = workspaceRef.current;
    if (!ws || !stage) return;
    await ensureSample(ws);
    if (!sampleRef.current || !datasetKeyRef.current) return;

    const top = findFirstPipelineTop(ws);
    if (!top) return;

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
  }

  /* ----------- checklist (tri-state) ----------- */

  const [checkItems, setCheckItems] = useState<StageChecklistItem[]>([]);

  // Parameter validator against stage.targetOps
  function paramMismatch(block: BlocklyBlock | null, spec?: OpSpec): boolean {
    if (!block || !spec) return false;

    if (spec.type === "resize") {
      const mode = block.getFieldValue("MODE");

      // Accept either:
      // - fit with maxside=150
      // - size + keep=TRUE with either side == 150 (toward-150 rule)
      if (mode === "fit") {
        const ms = Number(block.getFieldValue("MAXSIDE") || 0);
        return ms !== 150; // strict for this curriculum
      }

      if (mode === "size") {
        const keepRaw = block.getFieldValue("KEEP");
        const keep = String(keepRaw || "FALSE").toUpperCase() === "TRUE";
        const w = Number(block.getFieldValue("W") || 0);
        const h = Number(block.getFieldValue("H") || 0);
        // "towards 150": keep aspect and at least one side equals 150
        if (keep && (w === 150 || h === 150)) return false;
        return true;
      }

      // other modes not accepted for these stages
      return true;
    }

    if (spec.type === "pad") {
      const w = Number(block.getFieldValue("W") || 0);
      const h = Number(block.getFieldValue("H") || 0);
      return !(w === 150 && h === 150);
    }

    if (spec.type === "normalize") {
      // If stage specifies a mode, enforce it; otherwise accept any
      if ((spec as any).mode) {
        const m = block.getFieldValue("MODE");
        return m !== (spec as any).mode;
      }
      return false;
    }

    // Other blocks: no strict parameter enforcement in these stages
    return false;
  }

  function computeChecklist(ws: WorkspaceSvg, s: StageConfig): StageChecklistItem[] {
    const items: StageChecklistItem[] = [];

    if (s.type === "pipeline") {
      const topPipeline = findFirstPipelineTop(ws);
      const connectedOrder = topPipeline ? walkConnectedChainFrom(topPipeline) : [];

      const expected = s.expectedOrder || [];
      // presence & order maps
      const present = new Map<string, boolean>();
      expected.forEach(t => present.set(t, connectedOrder.includes(t)));

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

        // parameter-level check (only if block present)
        let paramOK = true;
        if (inChain && s.targetOps) {
          const spec = s.targetOps.find(o => "m2." + o.type === t);
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
      // -------- Stage 7: loop + export --------
      // IMPORTANT: loop may not be a top block (it’s often chained after dataset.select)
      const allBlocks = ws.getAllBlocks(false) as BlocklyBlock[];
      const loopBlock = allBlocks.find(b => b.type === "m2.loop_dataset") || null;
      const loopInner = loopBlock?.getInputTargetBlock("DO") || null;

      const innerOrder = loopInner ? walkConnectedChainFrom(loopInner) : [];

      const required = s.requiredBlocksWithinLoop || [];
      const expected = s.expectedOrderWithinLoop || required;

      // presence & order inside loop
      const present = new Map<string, boolean>();
      required.forEach(bt => present.set(bt, innerOrder.includes(bt)));

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

      required.forEach((t) => {
        const inLoop = !!present.get(t);
        const ok = !!orderOK.get(t);
        const state = !inLoop ? "missing" : ok ? "ok" : "wrong_place";
        items.push({
          key: t,
          label: `${t.replace("m2.", "").replaceAll("_", " ")} (inside loop)`,
          state,
        });
      });

      // export dataset after loop
      let exportState: Tri = "missing";
      if (loopBlock) {
        let cur: BlocklyBlock | null = loopBlock.getNextBlock();
        while (cur && cur.type !== "m2.export_dataset") cur = cur.getNextBlock();
        if (cur) exportState = "ok";
      }
      if (s.requireExportAfterLoop) {
        items.push({ key: "m2.export_dataset", label: "export dataset (after loop)", state: exportState });
      }
    }

    return items;
  }

  /* ----------- submit/run ----------- */

  async function run() {
    if (!stage || !workspaceRef.current) return;
    setRunning(true);

    try {
      const ws = workspaceRef.current;
      // Ensure we at least have the dataset key (Stage 7 may not have a sample block)
      ensureDatasetKey(ws);
      await ensureSample(ws);

      const newLogs: LogItem[] = [];
      let ok = true;
      const lines: string[] = [];

      if (stage.type === "pipeline") {
        const top = findFirstPipelineTop(ws);
        if (!top || !datasetKeyRef.current || !sampleRef.current) {
          ok = false;
          lines.push("• Make sure the dataset & sample blocks are connected to a preprocessing chain.");
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

          const itemsNow = computeChecklist(ws, stage);
          setCheckItems(itemsNow);
          ok = ok && itemsNow.every(i => i.state === "ok");

          if (ok) lines.push("✓ All required blocks used in the correct order (with correct settings).");
          else lines.push("• Some items are missing, out of order, or have incorrect settings (marked with “–” or “???”).");
        }
      } else {
        // Stage 7 — dataset-wide
        const allBlocks = ws.getAllBlocks(false) as BlocklyBlock[];
        const loopBlock = allBlocks.find(b => b.type === "m2.loop_dataset") || null;

        if (!loopBlock) {
          ok = false; lines.push("• Add the loop block and put the preprocessing pipeline inside it.");
        } else {
          const inner = loopBlock.getInputTargetBlock("DO");
          const ops = blocksToOps(inner);

          // Export block after loop
          let cur: BlocklyBlock | null = loopBlock.getNextBlock();
          let exportBlock: BlocklyBlock | null = null;
          while (cur) {
            if (cur.type === "m2.export_dataset") { exportBlock = cur; break; }
            cur = cur.getNextBlock();
          }

          // Evaluate structure synchronously
          const itemsNow = computeChecklist(ws, stage);
          setCheckItems(itemsNow);
          const structureOK = itemsNow.every(i => i.state === "ok");
          ok = ok && structureOK;

          if (ok && datasetKeyRef.current && exportBlock) {
            const newName = exportBlock.getFieldValue("NAME") || "processed";
            const overwrite = exportBlock.getFieldValue("OVERWRITE") === "TRUE";

            // Subset config
            const subsetMode = loopBlock.getFieldValue("SUBSET");
            const N = Number(loopBlock.getFieldValue("N") || 0);
            const shuffle = loopBlock.getFieldValue("SHUFFLE") === "TRUE";

            const resp = await fetchJSON<ExportResp>(`${API_BASE}/preprocess/batch_export`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                dataset_key: datasetKeyRef.current,
                subset: { mode: subsetMode, n: subsetMode === "all" ? null : N, shuffle },
                ops,
                new_dataset_name: newName,
                overwrite,
              }),
            });

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
            lines.push("• Fix the checklist items (pipeline must be inside loop; correct order; export after loop).");
          } else if (!datasetKeyRef.current) {
            ok = false;
            lines.push("• Add a 'use dataset' block so I know which dataset to process.");
          } else if (!exportBlock) {
            ok = false;
            lines.push("• Add 'export processed dataset' after the loop.");
          }
        }
      }

      setSubmitSuccess(ok);
      setSubmitTitle(ok ? "Stage Complete!" : "Keep Going");
      setSubmitLines(lines);
      setSubmitOpen(true);
      setLogs((prev) => [...prev, ...newLogs]);
      setBaymax(ok ? "Great job! That pipeline looks perfect. 🎉" : "Try reordering blocks or adjusting settings until the checklist turns green.");
    } catch (e: any) {
      setSubmitSuccess(false);
      setSubmitTitle("Error");
      setSubmitLines([e?.message || String(e)]);
      setSubmitOpen(true);
    } finally {
      setRunning(false);
    }
  }

  /* ----------- UI ----------- */

  if (!stage) {
    return <div className="p-6 text-red-600">Stage not found.</div>;
  }

  const appBg = dark ? "bg-neutral-950" : "bg-white";
  const barBg = dark ? "bg-neutral-900 border-neutral-800" : "bg-white border-gray-200";
  const barText = dark ? "text-neutral-100" : "text-gray-900";
  const rightBg = dark ? "bg-neutral-950 border-neutral-800" : "bg-gray-50 border-gray-200";

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
      <div className={`col-span-2 flex items-center justify-between px-3 border-b ${barBg}`}>
        <div className={`font-semibold ${barText}`}>VisionBlocks — Module 2: {stage.title}</div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setDark((d) => !d)}
            className={`px-3 py-1.5 rounded-md border ${
              dark ? "border-neutral-700 text-neutral-200 hover:bg-neutral-800" : "border-gray-300 text-gray-800 hover:bg-gray-50"
            }`}
            title="Toggle dark mode"
          >
            {dark ? "Light" : "Dark"}
          </button>
          <button
            onClick={() => { if (!running) run(); }}
            className={`px-4 py-1.5 rounded-md ${running ? "opacity-60 cursor-not-allowed" : ""} bg-black text-white`}
            disabled={running}
          >
            {running ? "Submitting…" : "Submit & Run"}
          </button>
        </div>
      </div>

      {/* Workspace */}
      <div ref={blocklyDivRef} className={`relative min-h-0 ${dark ? "bg-neutral-950" : "bg-white"}`} />

      {/* Right column */}
      <div className={`border-l p-3 min-h-0 ${rightBg}`}>
        <div className="h-full min-h-0 flex flex-col gap-4 overflow-y-auto pr-1">
          {/* Intro */}
          <div className={`rounded-xl border p-3 ${dark ? "border-neutral-800 bg-neutral-900/50" : "border-gray-200 bg-white"}`}>
            <h3 className={`font-semibold ${dark ? "text-neutral-100" : "text-gray-900"}`}>{stage.title}</h3>
            <ul className={`list-disc ml-5 mt-2 text-sm ${dark ? "text-neutral-300" : "text-gray-700"}`}>
              {stage.intro.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          </div>

          {/* Checklist */}
          <MissionChecklistStage items={checkItems} dark={dark} />

          {/* Target panel only for pipeline stages */}
          {stage.type === "pipeline" ? (
            <TargetPanel targetSrc={targetSrc} currentSrc={currentSrc} dark={dark} />
          ) : null}

          {/* Output & Baymax */}
          <OutputPanel logs={logs} onClear={() => setLogs([])} dark={dark} />
          <BaymaxPanel line={baymax} dark={dark} />
        </div>
      </div>

      {/* Info modal */}
      <InfoModal open={infoOpen} title={infoTitle} text={infoText} dark={dark} onClose={() => setInfoOpen(false)} />

      {/* Submission result modal */}
      <SubmissionModal open={submitOpen} onClose={() => setSubmitOpen(false)} dark={dark} title={submitTitle} lines={submitLines} success={submitSuccess} />
    </div>
  );
}
