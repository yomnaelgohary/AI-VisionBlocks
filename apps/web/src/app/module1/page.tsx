"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceSvg, Block as BlocklyBlock } from "blockly";
import { Blockly } from "@/lib/blockly";
import { DarkTheme, LightTheme } from "@/lib/blockly/theme";
import { toolboxJson } from "@/components/Toolbox";

import OutputPanel, { type LogItem } from "@/components/OutputPanel";
import BaymaxPanel from "@/components/BaymaxPanel";
import InfoModal from "@/components/InfoModal";
import SubmissionModal from "@/components/SubmissionModal";
import MissionChecklistStage, {
  type StageChecklistItem,
  type Tri,
} from "@/components/MissionChecklistStage";

const API_BASE = "http://localhost:8000";

/* ----------------- API types ----------------- */
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

type SampleResponse = {
  dataset_key: string;
  index_used: number;
  label: string;
  image_data_url: string;
  path: string;
};

type SplitResp = { r_data_url: string; g_data_url: string; b_data_url: string };
type GrayResp = { image_data_url: string };

/* ----------------- HTTP helper ----------------- */
async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* ----------------- Chain helpers ----------------- */
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
const hasType = (chain: BlocklyBlock[], type: string) => chain.some((b) => b.type === type);
const indexOfType = (chain: BlocklyBlock[], type: string) =>
  chain.findIndex((b) => b.type === type);
const isAfter = (chain: BlocklyBlock[], beforeType: string, targetType: string) => {
  const a = indexOfType(chain, beforeType);
  const b = indexOfType(chain, targetType);
  return a !== -1 && b !== -1 && b > a;
};

export default function Module1Page() {
  const router = useRouter();

  const blocklyDivRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<WorkspaceSvg | null>(null);

  const [dark, setDark] = useState<boolean>(true);
  const [running, setRunning] = useState<boolean>(false);

  const [logs, setLogs] = useState<LogItem[]>([]);
  const [baymax, setBaymax] = useState<string>(
    "Hello… I don’t know how to see yet. Can you help me?"
  );

  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTitle, setInfoTitle] = useState<string>();
  const [infoText, setInfoText] = useState<string>();

  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitTitle, setSubmitTitle] = useState("Submission");
  const [submitLines, setSubmitLines] = useState<string[]>([]);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Unlock Module 2 only after success
  const [module2Unlocked, setModule2Unlocked] = useState(false);

  // Live refs
  const datasetKeyRef = useRef<string | null>(null);
  const dsInfoRef = useRef<DatasetInfo | null>(null);
  const sampleRef = useRef<SampleResponse | null>(null);

  // Debounce
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef(0);
  const lastSigRef = useRef<string>("");

  const [checkItems, setCheckItems] = useState<StageChecklistItem[]>([]);
  const sizes = useMemo(() => ({ rightWidth: 380 }), []);

  /* ---------- Inject Blockly ---------- */
  useEffect(() => {
    if (!blocklyDivRef.current) return;

    const ws = Blockly.inject(blocklyDivRef.current, {
      toolbox: toolboxJson,
      renderer: "zelos",
      theme: dark ? DarkTheme : LightTheme,
      trashcan: true,
      scrollbars: true,
      zoom: { controls: true, wheel: true, startScale: 0.9 },
    });
    workspaceRef.current = ws;
    try {
      (ws as any).scrollCenter?.();
    } catch {}

    const onInfo = (e: any) => {
      const { title, text } = e?.detail ?? {};
      setInfoTitle(title || "About this block");
      setInfoText(text || "");
      setInfoOpen(true);
    };
    window.addEventListener("vb:blockInfo", onInfo as any);

    const onChange = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        instantFeedback();
      }, 250);
    };
    ws.addChangeListener(onChange);

    setCheckItems(computeChecklist(ws));

    return () => {
      window.removeEventListener("vb:blockInfo", onInfo as any);
      ws.removeChangeListener(onChange);
      ws.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocklyDivRef.current]);

  // Live theme
  useEffect(() => {
    if (!workspaceRef.current) return;
    workspaceRef.current.setTheme(dark ? DarkTheme : LightTheme);
  }, [dark]);

  /* ---------- Instant feedback (attached-chain only) ---------- */
  async function instantFeedback() {
    const ws = workspaceRef.current;
    if (!ws) return;

    const chains = getTopChains(ws);
    const dsChain = chains.find((ch) => hasType(ch, "dataset.select"));

    // dataset key from that chain
    if (dsChain) {
      const dsBlock = dsChain.find((b) => b.type === "dataset.select");
      datasetKeyRef.current = (dsBlock?.getFieldValue("DATASET") as string) || null;
    } else {
      datasetKeyRef.current = null;
    }

    // same-chain checks
    const infoInChain = !!(dsChain && isAfter(dsChain, "dataset.select", "dataset.info"));
    const countsInChain = !!(dsChain && isAfter(dsChain, "dataset.select", "dataset.class_counts"));
    const distInChain = !!(
      dsChain && isAfter(dsChain, "dataset.select", "dataset.class_distribution_preview")
    );
    const sampleInChain = !!(dsChain && isAfter(dsChain, "dataset.select", "dataset.sample_image"));
    const showInChain = !!(dsChain && isAfter(dsChain, "dataset.select", "image.show"));
    const splitInChain = !!(dsChain && isAfter(dsChain, "dataset.select", "image.channels_split"));
    const grayInChain = !!(dsChain && isAfter(dsChain, "dataset.select", "image.to_grayscale_preview"));

    // sample config
    let sampleConf: { mode: "random" | "index"; index?: number } | null = null;
    if (sampleInChain && dsChain) {
      const smp = dsChain.find((b) => b.type === "dataset.sample_image");
      if (smp) {
        const mode = (smp.getFieldValue("MODE") as "random" | "index") || "random";
        const raw = smp.getFieldValue("INDEX");
        const idx = typeof raw === "number" ? raw : parseInt(String(raw || 0), 10) || 0;
        sampleConf = mode === "index" ? { mode, index: idx } : { mode };
      }
    }

    // signature
    const sig = JSON.stringify({
      ds: datasetKeyRef.current ?? null,
      infoInChain,
      countsInChain,
      distInChain,
      sampleInChain,
      sample: sampleConf || null,
      showInChain,
      splitInChain,
      grayInChain,
    });
    if (sig === lastSigRef.current) {
      setCheckItems(computeChecklist(ws));
      return;
    }
    lastSigRef.current = sig;
    const myToken = ++tokenRef.current;

    try {
      const newLogs: LogItem[] = [];

      // dataset info family
      if (datasetKeyRef.current) {
        if (infoInChain) {
          dsInfoRef.current = await fetchJSON<DatasetInfo>(
            `${API_BASE}/datasets/${encodeURIComponent(datasetKeyRef.current)}/info`
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
        if (countsInChain) {
          if (!dsInfoRef.current) {
            dsInfoRef.current = await fetchJSON<DatasetInfo>(
              `${API_BASE}/datasets/${encodeURIComponent(datasetKeyRef.current)}/info`
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
        if (distInChain) {
          if (!dsInfoRef.current) {
            dsInfoRef.current = await fetchJSON<DatasetInfo>(
              `${API_BASE}/datasets/${encodeURIComponent(datasetKeyRef.current)}/info`
            );
          }
          const total =
            Object.values(dsInfoRef.current.approx_count || {}).reduce((a, c) => a + c, 0) || 1;
          const chart = Object.entries(dsInfoRef.current.approx_count || {}).map(([label, count]) => ({
            label,
            percent: (count / total) * 100,
          }));
          newLogs.push({ kind: "chart", title: "Class Distribution (%)", data: chart });
        }
      }

      // sample + previews
      if (datasetKeyRef.current && sampleConf && sampleInChain) {
        const url =
          sampleConf.mode === "index"
            ? `${API_BASE}/datasets/${encodeURIComponent(
                datasetKeyRef.current
              )}/sample?mode=index&index=${sampleConf.index}`
            : `${API_BASE}/datasets/${encodeURIComponent(datasetKeyRef.current)}/sample?mode=random`;

        sampleRef.current = await fetchJSON<SampleResponse>(url);

        if (showInChain) {
          newLogs.push({
            kind: "image",
            src: sampleRef.current.image_data_url,
            caption: `Original — label: ${sampleRef.current.label}`,
          });
        } else {
          newLogs.push({
            kind: "preview",
            text: `[preview] sample loaded (index ${sampleRef.current.index_used}); add 'show image' after 'use dataset' to display it`,
          });
        }

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

        if (grayInChain) {
          const gray = await fetchJSON<GrayResp>(
            `${API_BASE}/datasets/${encodeURIComponent(
              datasetKeyRef.current
            )}/grayscale?path=${encodeURIComponent(sampleRef.current.path)}`
          );
          newLogs.push({ kind: "image", src: gray.image_data_url, caption: "Grayscale preview" });
        }

        setBaymax("Nice! That chain works. Try showing channels or grayscale to explore.");
      } else {
        if (dsChain) {
          setBaymax(
            "Great—now connect blocks after ‘use dataset’. Put ‘get sample image’ and ‘show image’ in the same chain."
          );
        } else {
          setBaymax("Start by dragging in ‘use dataset’. Then attach other blocks below it.");
        }
      }

      if (myToken === tokenRef.current) setLogs(newLogs);
    } catch {
      // ignore transient errors
    } finally {
      setCheckItems(computeChecklist(ws));
    }
  }

  /* ---------- Checklist ---------- */
  function computeChecklist(ws: WorkspaceSvg): StageChecklistItem[] {
    const chains = getTopChains(ws);
    const dsChain = chains.find((ch) => hasType(ch, "dataset.select"));
    const items: StageChecklistItem[] = [];

    const spec = [
      { key: "dataset.select", label: "use dataset" },
      { key: "dataset.info", label: "dataset info" },
      { key: "dataset.class_counts", label: "class counts" },
      { key: "dataset.class_distribution_preview", label: "class distribution preview" },
      { key: "dataset.sample_image", label: "get sample image" },
      { key: "image.show", label: "show image" },
      { key: "image.channels_split", label: "split RGB channels (preview)" },
      { key: "image.to_grayscale_preview", label: "grayscale preview" },
    ];

    for (const it of spec) {
      let state: Tri = "missing";

      if (!dsChain) {
        state = "missing";
      } else {
        const present = hasType(dsChain, it.key);
        if (!present) state = "missing";
        else {
          const okOrder = isAfter(dsChain, "dataset.select", it.key) || it.key === "dataset.select";
          state = okOrder ? "ok" : "wrong_place";
        }
      }

      items.push({ key: it.key, label: it.label, state });
    }
    return items;
  }

  /* ---------- Submit & Run ---------- */
  async function run() {
    const ws = workspaceRef.current;
    if (!ws) return;

    setRunning(true);
    try {
      await instantFeedback();
      const items = computeChecklist(ws);
      const ok = items.every((i) => i.state === "ok");
      setSubmitSuccess(ok);
      setSubmitTitle(ok ? "Mission Complete!" : "Keep Exploring");
      setSubmitLines(
        ok
          ? ["✓ Great work! You explored dataset info, loaded a sample, and visualized it in one chain."]
          : ["• Some items are missing or not attached after ‘use dataset’. Reorder until they turn green."]
      );
      setSubmitOpen(true);
      setBaymax(
        ok
          ? "You’ve got the basics! Time to try Module 2 and start preprocessing. 🚀"
          : "Make sure each block is connected below ‘use dataset’ in the same chain."
      );

      if (ok && !module2Unlocked) setModule2Unlocked(true);
    } finally {
      setRunning(false);
    }
  }

  /* ---------- UI ---------- */
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
        <div className={`font-semibold ${barText}`}>VisionBlocks — Module 1: Learn to See</div>
        <div className="flex gap-2 items-center">
          {/* Theme toggle */}
          <button
            onClick={() => setDark((d) => !d)}
            className={`px-3 py-1.5 rounded-md border ${
              dark
                ? "border-neutral-700 text-neutral-200 hover:bg-neutral-800"
                : "border-gray-300 text-gray-800 hover:bg-gray-50"
            }`}
            title="Toggle dark mode"
          >
            {dark ? "Light" : "Dark"}
          </button>

          {/* Submit & Run */}
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

          {/* Module 2 button — exact style/position as StageRunner's Next Stage */}
          {module2Unlocked ? (
            <button
              onClick={() => router.push("/module2")}
              className={`px-4 py-1.5 rounded-md border ${
                dark
                  ? "border-emerald-600 text-emerald-300 hover:bg-emerald-900/20"
                  : "border-emerald-500 text-emerald-700 hover:bg-emerald-50"
              }`}
              title="Go to Module 2"
            >
              Module 2
            </button>
          ) : (
            <button
              type="button"
              aria-disabled="true"
              className={`px-4 py-1.5 rounded-md border ${
                dark
                  ? "border-neutral-700 text-neutral-400 cursor-not-allowed"
                  : "border-gray-300 text-gray-400 cursor-not-allowed"
              }`}
              title="Complete this mission to unlock Module 2"
            >
              Module 2
            </button>
          )}
        </div>
      </div>

      {/* Middle: Blockly workspace */}
      <div ref={blocklyDivRef} className={`relative min-h-0 ${appBg}`} />

      {/* Right: Checklist + Output + Baymax */}
      <div className={`border-l p-3 min-h-0 ${rightBg}`}>
        <div className="h-full min-h-0 flex flex-col gap-4 overflow-y-auto pr-1">
          <MissionChecklistStage items={checkItems} dark={dark} />
          <OutputPanel logs={logs} onClear={() => setLogs([])} dark={dark} />
          <BaymaxPanel line={baymax} dark={dark} />
        </div>
      </div>

      {/* Info Modal */}
      <InfoModal
        open={infoOpen}
        title={infoTitle}
        text={infoText}
        dark={dark}
        onClose={() => setInfoOpen(false)}
      />

      {/* Submission Modal */}
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
