"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceSvg, Block as BlocklyBlock } from "blockly";
import { Blockly } from "@/lib/blockly";
import { toolboxJson } from "@/components/Toolbox";
import OutputPanel, { type LogItem } from "@/components/OutputPanel";
import BaymaxPanel from "@/components/BaymaxPanel";
import { DarkTheme, LightTheme } from "@/lib/blockly/theme";

const API_BASE = "http://localhost:8000";

type DatasetInfo = {
  key: string;
  name: string;
  description?: string;
  image_shape: [number | null, number | null, number | null];
  num_classes: number;
  classes: string[];
  approx_count: Record<string, number>;
  version?: string;
};

type SampleResponse = {
  dataset_key: string;
  index_used: number;
  label: string;
  image_data_url: string;
  path?: string;
};

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function runWorkspace(workspace: WorkspaceSvg): Promise<{ logs: LogItem[]; baymax: string }> {
  const logs: LogItem[] = [];
  let baymax = "I don't know how to see yet. Can we start by choosing a dataset?";

  let datasetKey: string | null = null;
  let dsInfo: DatasetInfo | null = null;
  let lastSample: SampleResponse | null = null;

  const tops = workspace.getTopBlocks(true) as BlocklyBlock[];

  for (const top of tops) {
    let b: BlocklyBlock | null = top;
    while (b) {
      const type = b.type;

      if (type === "dataset.select") {
        datasetKey = (b.getFieldValue("DATASET") as string) ?? null;
        dsInfo = null;
        lastSample = null;
        logs.push({ kind: "info", text: `[info] Using dataset: ${datasetKey}` });
        baymax = `Okay… I picked ${datasetKey}. What should we look at next?`;
      }

      if (type === "dataset.info") {
        if (!datasetKey) {
          logs.push({ kind: "warn", text: "Please add 'use dataset' before 'dataset info'." });
        } else {
          dsInfo = await fetchJSON<DatasetInfo>(`${API_BASE}/datasets/${encodeURIComponent(datasetKey)}/info`);
          const lines = [
            `Name: ${dsInfo.name}`,
            `Classes: ${dsInfo.classes.join(", ")}`,
          ];
          logs.push({ kind: "card", title: "Dataset Info", lines });
          baymax = "That gives me some clues. Maybe we can try a sample image?";
        }
      }

      if (type === "dataset.class_counts") {
        if (!datasetKey) {
          logs.push({ kind: "warn", text: "Please add 'use dataset' before 'class counts'." });
        } else {
          if (!dsInfo) dsInfo = await fetchJSON<DatasetInfo>(`${API_BASE}/datasets/${encodeURIComponent(datasetKey)}/info`);
          const lines = Object.entries(dsInfo.approx_count).map(([k, v]) => `${k}: ${v}`);
          logs.push({ kind: "card", title: "Class Counts", lines });
          baymax = "So some classes appear more than others. That could matter later.";
        }
      }

      if (type === "dataset.sample_image") {
        if (!datasetKey) {
          logs.push({ kind: "warn", text: "Please add 'use dataset' before 'get sample image'." });
        } else {
          const mode = (b.getFieldValue("MODE") as string) as "random" | "index";
          const idxRaw = b.getFieldValue("INDEX");
          const idx = typeof idxRaw === "number" ? idxRaw : parseInt(String(idxRaw || 0), 10) || 0;
          const url = `${API_BASE}/datasets/${encodeURIComponent(datasetKey)}/sample?mode=${mode}${
            mode === "index" ? `&index=${idx}` : ""
          }`;
          lastSample = await fetchJSON<SampleResponse>(url);
          logs.push({
            kind: "preview",
            text:
              mode === "index"
                ? `[preview] sample image loaded (index ${lastSample.index_used})`
                : `[preview] sample image loaded (random index ${lastSample.index_used})`,
          });
          baymax = "I see something! Can you show it to me?";
        }
      }

      if (type === "image.show") {
        if (!lastSample) {
          logs.push({ kind: "warn", text: "Please get a sample image first, then 'show image'." });
        } else {
          const title = (b.getFieldValue("TITLE") as string) || "Sample";
          logs.push({
            kind: "image",
            src: lastSample.image_data_url,
            caption: `${title} - label: ${lastSample.label}`,
          });
          baymax = "I can see the picture! What size is it?";
        }
      }

      if (type === "image.shape") {
        logs.push({ kind: "info", text: `[shape] (we'll compute this precisely in Module 2)` });
      }

      if (type === "image.channels_split") {
        if (!lastSample || !lastSample.path || !datasetKey) {
          logs.push({ kind: "warn", text: "Please get a sample image first, then 'split RGB channels'." });
        } else {
          const url = `${API_BASE}/datasets/${encodeURIComponent(datasetKey)}/split_channels?path=${encodeURIComponent(
            lastSample.path!
          )}`;
          const resp = await fetchJSON<{ r_data_url: string; g_data_url: string; b_data_url: string }>(url);
          logs.push({
            kind: "images",
            items: [
              { src: resp.r_data_url, caption: "Red channel" },
              { src: resp.g_data_url, caption: "Green channel" },
              { src: resp.b_data_url, caption: "Blue channel" },
            ],
          });
          baymax = "Oh! Colors are made of pieces. That's new to me!";
        }
      }

      if (type === "image.to_grayscale_preview") {
        if (!lastSample || !lastSample.path || !datasetKey) {
          logs.push({ kind: "warn", text: "Please get a sample image first, then 'grayscale preview'." });
        } else {
          const url = `${API_BASE}/datasets/${encodeURIComponent(datasetKey)}/grayscale?path=${encodeURIComponent(
            lastSample.path!
          )}`;
          const resp = await fetchJSON<{ image_data_url: string }>(url);
          logs.push({ kind: "image", src: resp.image_data_url, caption: "Grayscale" });
          baymax = "This looks simpler. I think I'm beginning to get it.";
        }
      }

      if (type === "dataset.class_distribution_preview") {
        if (!datasetKey) {
          logs.push({ kind: "warn", text: "Please add 'use dataset' before 'class distribution preview'." });
        } else {
          if (!dsInfo) dsInfo = await fetchJSON<DatasetInfo>(`${API_BASE}/datasets/${encodeURIComponent(datasetKey)}/info`);
          const total = Object.values(dsInfo.approx_count).reduce((a, b) => a + b, 0) || 1;
          const data = Object.entries(dsInfo.approx_count).map(([label, count]) => ({
            label,
            percent: (count / total) * 100,
          }));
          logs.push({ kind: "chart", title: "Class Distribution (%)", data });
          baymax = "If some classes are rare, that might be hard for me later.";
        }
      }

      b = b.getNextBlock();
    }
  }

  if (logs.length === 0) {
    logs.push({ kind: "warn", text: "No blocks to run. Try adding 'use dataset' and 'get sample image'." });
  }

  return { logs, baymax };
}

export default function Page() {
  const blocklyDivRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<WorkspaceSvg | null>(null);

  const [logs, setLogs] = useState<LogItem[]>([]);
  const [baymaxLine, setBaymaxLine] = useState<string>(
    "Hello… I don’t know how to see yet. Can you help me?"
  );
  const [dark, setDark] = useState<boolean>(true);
  const [running, setRunning] = useState<boolean>(false);

  const sizes = useMemo(() => ({ rightWidth: 380 }), []);

  // Inject workspace once
  useEffect(() => {
    if (!blocklyDivRef.current) return;

    const workspace = Blockly.inject(blocklyDivRef.current, {
      toolbox: toolboxJson,
      renderer: "zelos",
      theme: dark ? DarkTheme : LightTheme,
      trashcan: true,
      scrollbars: true,
      zoom: { controls: true, wheel: true, startScale: 0.9 },
    });
    workspaceRef.current = workspace;

    workspace.clear();
    try {
      (workspace as any).scrollCenter?.();
    } catch {}

    return () => workspace.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocklyDivRef.current]);

  // Toggle theme live
  useEffect(() => {
    if (!workspaceRef.current) return;
    workspaceRef.current.setTheme(dark ? DarkTheme : LightTheme);
  }, [dark]);

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
        <div className={`font-semibold ${barText}`}>VisionBlocks | Mission 1: Learn to See</div>
        <div className="flex gap-2 items-center">
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
            onClick={async () => {
              if (!workspaceRef.current || running) return;
              setRunning(true);
              setLogs((prev) => [...prev, { kind: "info", text: "Running..." }]);
              try {
                const result = await runWorkspace(workspaceRef.current);
                setLogs(result.logs);
                setBaymaxLine(result.baymax);
              } catch (e: any) {
                setLogs((prev) => [...prev, { kind: "error", text: `Run failed: ${e?.message || String(e)}` }]);
              } finally {
                setRunning(false);
              }
            }}
            className={`px-4 py-1.5 rounded-md ${running ? "opacity-60 cursor-not-allowed" : ""} bg-black text-white`}
            disabled={running}
          >
            {running ? "Running…" : "Run"}
          </button>
        </div>
      </div>

      {/* Middle: Blockly workspace */}
      <div ref={blocklyDivRef} className={`relative min-h-0 ${dark ? "bg-neutral-950" : "bg-white"}`} />

      {/* Right: Output (fixed height, scrolls inside) + Baymax */}
      <div className={`border-l p-3 flex flex-col gap-4 min-h-0 ${rightBg}`}>
        {/* Fixed height area that always stays the same; OutputPanel scrolls inside */}
        <div className="h-[40vh]">
          <OutputPanel logs={logs} onClear={() => setLogs([])} dark={dark} />
        </div>

        {/* Baymax panel below, takes remaining space */}
        <div className="flex-1 min-h-0">
          <BaymaxPanel line={baymaxLine} dark={dark} />
        </div>
      </div>
    </div>
  );
}
