"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceSvg, Block as BlocklyBlock } from "blockly";
import { Blockly, setDatasetOptions } from "@/lib/blockly";
import { toolboxJsonModule4 } from "@/components/toolboxModule4";
import OutputPanel, { type LogItem } from "@/components/OutputPanel";
import BaymaxPanel from "@/components/BaymaxPanel";
import { DarkTheme, LightTheme } from "@/lib/blockly/theme";
import InfoModal from "@/components/InfoModal";
import SubmissionModal from "@/components/SubmissionModal";

const API_BASE = "http://localhost:8000";

// ---- Reuse basic dataset/sample shapes from Module 2 ----
type DatasetList = { items: { key: string; name: string }[] };
type DatasetInfo = {
  key: string;
  name: string;
  classes: string[];
  approx_count: Record<string, number>;
};

type SampleResponse = {
  dataset_key: string;
  index_used: number;
  label: string;
  image_data_url: string;
  path: string;
};

// ---- Model spec types (frontend) ----
type ModelSpec = {
  name: string;
  layers: { type: string; params: Record<string, any> }[];
};

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

// Load datasets (so user can pick on this page too)
async function refreshDatasets(workspace?: WorkspaceSvg) {
  const data = await fetchJSON<DatasetList>(`${API_BASE}/datasets`);
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

// Extract a model spec from the first chain that includes any m4.* block
function blocksToModelSpec(top: BlocklyBlock | null): ModelSpec | null {
  if (!top) return null;
  let b: BlocklyBlock | null = top;

  let name = "my-model";
  const layers: { type: string; params: any }[] = [];
  let sawModel = false;

  while (b) {
    switch (b.type) {
      case "m4.model_init":
        name = (b.getFieldValue("NAME") as string) || "my-model";
        sawModel = true;
        break;

      case "m4.layer_conv2d": {
        const s = b.getFieldValue("STRENGTH");
        const filters = s === "strong" ? 64 : s === "medium" ? 32 : 16;
        layers.push({ type: "conv2d", params: { filters, kernel: 3, stride: 1, padding: "same", activation: "relu" }});
        break;
      }

      case "m4.layer_pool": {
        const t = b.getFieldValue("TYPE");
        layers.push({ type: "pool", params: { kind: t, size: 2 }});
        break;
      }

      case "m4.layer_dense": {
        const sz = b.getFieldValue("SIZE");
        const units = sz === "large" ? 256 : sz === "medium" ? 128 : 64;
        layers.push({ type: "dense", params: { units, activation: "relu" }});
        break;
      }

      case "m4.model_summary":
        // no-op; just triggers preview
        break;
    }
    b = b.getNextBlock();
  }

  if (!sawModel) return null;
  return { name, layers };
}

function findFirstModelChain(ws: WorkspaceSvg): BlocklyBlock | null {
  for (const top of ws.getTopBlocks(true) as BlocklyBlock[]) {
    for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
      if (b.type.startsWith("m4.")) return top;
    }
  }
  return null;
}

export default function Module4Page() {
  const blocklyDivRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<WorkspaceSvg | null>(null);

  const [logs, setLogs] = useState<LogItem[]>([]);
  const [baymaxLine, setBaymaxLine] = useState("Time to build a brain for Baymax!");
  const [dark, setDark] = useState(true);
  const [running, setRunning] = useState(false);

  // Info modal
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTitle, setInfoTitle] = useState<string | undefined>();
  const [infoText, setInfoText] = useState<string | undefined>();

  // Submission modal
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitLines, setSubmitLines] = useState<string[]>([]);
  const [submitTitle, setSubmitTitle] = useState("Training Result");

  // Session refs
  const datasetKeyRef = useRef<string | null>(null);
  const sampleRef = useRef<SampleResponse | null>(null);

  const sizes = useMemo(() => ({ rightWidth: 420 }), []);

  // Live model summary
  async function liveSummary(): Promise<void> {
    const ws = workspaceRef.current;
    if (!ws) return;

    // update current dataset key if present
    for (const top of ws.getTopBlocks(true) as BlocklyBlock[]) {
      for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
        if (b.type === "dataset.select") {
          datasetKeyRef.current = b.getFieldValue("DATASET");
        }
        if (b.type === "dataset.sample_image") {
          if (!datasetKeyRef.current) continue;
          const mode = b.getFieldValue("MODE") as "random" | "index";
          const idxRaw = b.getFieldValue("INDEX");
          const idx =
            typeof idxRaw === "number"
              ? idxRaw
              : parseInt(String(idxRaw || 0), 10) || 0;
          const url = `${API_BASE}/datasets/${encodeURIComponent(
            datasetKeyRef.current!
          )}/sample?mode=${mode}${mode === "index" ? `&index=${idx}` : ""}`;
          try {
            sampleRef.current = await fetchJSON<SampleResponse>(url);
          } catch {}
        }
      }
    }

    const chain = findFirstModelChain(ws);
    const spec = blocksToModelSpec(chain);

    const newLogs: LogItem[] = [];
    if (!spec) {
      setLogs(newLogs);
      return;
    }

    newLogs.push({ kind: "card", title: "Model (preview)", lines: [`Name: ${spec.name}`] });

    // Pretty layer list
    const layerLines: string[] = [];
    let idx = 1;
    for (const L of spec.layers) {
      if (L.type === "conv2d") {
        layerLines.push(`${idx++}. Conv2D — ${L.params.filters} filters, 3×3, ReLU`);
      } else if (L.type === "pool") {
        layerLines.push(`${idx++}. ${L.params.kind === "max" ? "MaxPool" : "AvgPool"} — 2×2`);
      } else if (L.type === "dense") {
        layerLines.push(`${idx++}. Dense — ${L.params.units} units, ReLU`);
      }
    }
    if (!layerLines.length) layerLines.push("(no layers yet)");
    newLogs.push({ kind: "card", title: "Layers", lines: layerLines });

    // If we have a sample, show it so they can later predict on it
    if (sampleRef.current) {
      newLogs.push({
        kind: "image",
        src: sampleRef.current.image_data_url,
        caption: `Sample for prediction — ${sampleRef.current.label}`,
      });
    }

    setLogs(newLogs);
    setBaymaxLine("Nice stack! Add a few layers, then train me!");
  }

  useEffect(() => {
    if (!blocklyDivRef.current) return;

    const ws = Blockly.inject(blocklyDivRef.current, {
      toolbox: toolboxJsonModule4,
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
      const { title, text } = (e?.detail ?? {}) as { title?: string; text?: string };
      setInfoTitle(title || "What does this block do?");
      setInfoText(text || "");
      setInfoOpen(true);
    };
    window.addEventListener("vb:blockInfo", onInfo as any);

    const onChange = (evt: any) => {
      const E = (Blockly as any).Events;
      const uiTypes = new Set([
        E.UI, E.CLICK, E.VIEWPORT_CHANGE, E.TOOLBOX_ITEM_SELECT,
        E.THEME_CHANGE, E.BUBBLE_OPEN, E.TRASHCAN_OPEN, E.SELECTED,
      ]);
      if (evt && evt.type && uiTypes.has(evt.type)) return;
      // live summary whenever structure changes
      liveSummary().catch(() => {});
    };
    ws.addChangeListener(onChange);

    // initial render
    liveSummary().catch(() => {});

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

  function buildModelSpecFromWorkspace(ws: WorkspaceSvg): ModelSpec | null {
    const top = findFirstModelChain(ws);
    return blocksToModelSpec(top);
  }

  // Submit & Run = build -> train -> evaluate -> predict (if requested)
  async function run(): Promise<void> {
    const ws = workspaceRef.current;
    if (!ws) return;
    setRunning(true);

    const newLogs: LogItem[] = [];

    try {
      // 1) dataset selected?
      if (!datasetKeyRef.current) {
        // best effort: scan for dataset.select now
        for (const top of ws.getTopBlocks(true) as BlocklyBlock[]) {
          for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
            if (b.type === "dataset.select") {
              datasetKeyRef.current = b.getFieldValue("DATASET");
            }
          }
        }
      }
      if (!datasetKeyRef.current) {
        newLogs.push({ kind: "warn", text: "Please add 'use dataset' first." });
        setLogs((prev) => [...prev, ...newLogs]);
        return;
      }

      // 2) model spec
      const spec = buildModelSpecFromWorkspace(ws);
      if (!spec) {
        newLogs.push({ kind: "warn", text: "Add 'start new model' and some layers." });
        setLogs((prev) => [...prev, ...newLogs]);
        return;
      }

      // 3) optional training hparams
      let epochs = 5, batch = 32;
      for (const top of ws.getTopBlocks(true) as BlocklyBlock[]) {
        for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
          if (b.type === "m4.train_hparams") {
            epochs = Number(b.getFieldValue("EPOCHS") || 5);
            batch = Number(b.getFieldValue("BATCH") || 32);
          }
        }
      }

      // 4) Build model (backend)
      newLogs.push({ kind: "info", text: "[model] Building model…" });
      const buildResp = await fetchJSON<{ ok: boolean; details?: string }>(
        `${API_BASE}/model/build`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataset_key: datasetKeyRef.current,
            spec,
            use_active_split: true, // Module 3 split/session
          }),
        }
      );
      if (!buildResp.ok) throw new Error(buildResp.details || "Build failed");

      // 5) Train if block present
      let wantsTrain = false;
      for (const top of ws.getTopBlocks(true) as BlocklyBlock[]) {
        for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
          if (b.type === "m4.train_start") wantsTrain = true;
        }
      }

      if (wantsTrain) {
        newLogs.push({ kind: "info", text: `[train] epochs=${epochs}, batch=${batch}` });
        const trainResp = await fetchJSON<{
          ok: boolean;
          epochs: { epoch: number; train_acc: number; train_loss: number }[];
        }>(`${API_BASE}/train/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataset_key: datasetKeyRef.current,
            epochs,
            batch,
          }),
        });
        if (!trainResp.ok) throw new Error("Training failed");
        const lines = trainResp.epochs.map(
          (e) => `Epoch ${e.epoch}: acc ${(e.train_acc * 100).toFixed(1)}%, loss ${e.train_loss.toFixed(3)}`
        );
        newLogs.push({ kind: "card", title: "Training", lines });
      }

      // 6) Evaluate if requested
      let wantsEval = false;
      let wantsPredict = false;
      for (const top of ws.getTopBlocks(true) as BlocklyBlock[]) {
        for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
          if (b.type === "m4.eval_test") wantsEval = true;
          if (b.type === "m4.predict_sample") wantsPredict = true;
        }
      }

      if (wantsEval) {
        const evalResp = await fetchJSON<{
          ok: boolean;
          accuracy: number;
          per_class?: { name: string; acc: number }[];
          confusion_data_url?: string;
        }>(`${API_BASE}/evaluate/test`);
        if (!evalResp.ok) throw new Error("Evaluation failed");
        const lines = [
          `Test accuracy: ${(evalResp.accuracy * 100).toFixed(1)}%`,
          ...(evalResp.per_class || []).map(
            (pc) => `${pc.name}: ${(pc.acc * 100).toFixed(1)}%`
          ),
        ];
        newLogs.push({ kind: "card", title: "Evaluation", lines });
        if (evalResp.confusion_data_url) {
          newLogs.push({
            kind: "image",
            src: evalResp.confusion_data_url,
            caption: "Confusion Matrix",
          });
        }
      }

      // 7) Predict if requested
      if (wantsPredict) {
        if (!sampleRef.current) {
          newLogs.push({
            kind: "warn",
            text: "Pick a sample image first (Images → get sample image).",
          });
        } else {
          const predResp = await fetchJSON<{
            ok: boolean;
            class: string;
            confidence: number;
          }>(`${API_BASE}/predict/sample`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path: sampleRef.current.path,
              dataset_key: sampleRef.current.dataset_key,
            }),
          });
          if (!predResp.ok) throw new Error("Prediction failed");
          newLogs.push({
            kind: "card",
            title: "Prediction",
            lines: [
              `Class: ${predResp.class}`,
              `Confidence: ${(predResp.confidence * 100).toFixed(1)}%`,
            ],
          });
        }
      }

      setSubmitSuccess(true);
      setSubmitTitle("Great work!");
      setSubmitLines([
        "Your model pipeline ran.",
        wantsTrain ? "Training finished." : "No training block present (skipped).",
        wantsEval ? "Evaluation shown." : "No evaluation block present (skipped).",
      ]);
      setSubmitOpen(true);
      setLogs((prev) => [...prev, ...newLogs]);
      setBaymaxLine("I’m learning! Let’s see how I did.");
    } catch (e: any) {
      setSubmitSuccess(false);
      setSubmitTitle("Run failed");
      setSubmitLines([e?.message || String(e)]);
      setSubmitOpen(true);
      setLogs((prev) => [...prev, { kind: "error", text: String(e?.message || e) }]);
      setBaymaxLine("Uh-oh. Something went wrong—check the message.");
    } finally {
      setRunning(false);
    }
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
        <div className={`font-semibold ${barText}`}>VisionBlocks — Module 4: Model</div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => refreshDatasets(workspaceRef.current)}
            className={`px-3 py-1.5 rounded-md border ${
              dark ? "border-neutral-700 text-neutral-200 hover:bg-neutral-800" : "border-gray-300 text-gray-800 hover:bg-gray-50"
            }`}
            title="Reload dataset list"
          >
            Refresh datasets
          </button>
          <button
            onClick={() => setDark(!dark)}
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
            {running ? "Running…" : "Submit & Run"}
          </button>
        </div>
      </div>

      {/* Workspace */}
      <div ref={blocklyDivRef} className={`relative min-h-0 ${dark ? "bg-neutral-950" : "bg-white"}`} />

      {/* Right column: scrollable Output + Baymax */}
      <div className={`border-l p-3 min-h-0 ${rightBg}`}>
        <div className="h-full min-h-0 flex flex-col gap-4 overflow-y-auto pr-1">
          <OutputPanel logs={logs} onClear={() => setLogs([])} dark={dark} />
          <BaymaxPanel line={baymaxLine} dark={dark} />
        </div>
      </div>

      {/* Info modal */}
      <InfoModal open={infoOpen} title={infoTitle} text={infoText} dark={dark} onClose={() => setInfoOpen(false)} />

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
