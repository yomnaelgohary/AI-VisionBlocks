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

type BaymaxMood = "neutral" | "hint" | "warning" | "success" | "error";

export default function Module1Page() {
  const router = useRouter();

  const blocklyDivRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<WorkspaceSvg | null>(null);

  const [running, setRunning] = useState<boolean>(false);

  const [logs, setLogs] = useState<LogItem[]>([]);
  const [baymax, setBaymax] = useState<string>(
    "Right now I’m basically staring into the void 😅. Start by hanging a “use dataset” block so we have something to look at."
  );
  const [baymaxMood, setBaymaxMood] = useState<BaymaxMood>("neutral");
  const [baymaxTyping, setBaymaxTyping] = useState<boolean>(false);

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

  /* ---------- Inject Blockly ---------- */
  useEffect(() => {
    if (!blocklyDivRef.current) return;

    const ws = Blockly.inject(blocklyDivRef.current, {
      toolbox: toolboxJson,
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

  /* ---------- Baymax helper driven by checklist ---------- */
  function updateBaymaxFromChecklist(args: {
    dsChain?: BlocklyBlock[];
    checkItems: StageChecklistItem[];
    sampleLoaded: boolean;
    showInChain: boolean;
  }) {
    const { dsChain, checkItems, sampleLoaded, showInChain } = args;
    const done = checkItems.filter((i) => i.state === "ok").length;

    const missingKeys = checkItems.filter((i) => i.state === "missing").map((i) => i.key);
    const wrongKeys = checkItems.filter((i) => i.state === "wrong_place").map((i) => i.key);

    // No dataset at all
    if (!dsChain) {
      setBaymax(
        "We don’t have a dataset picked yet. Try dropping one block that tells me *which* dataset we’re exploring, then stack the rest under it."
      );
      setBaymaxMood("hint");
      setBaymaxTyping(false);
      return;
    }

    // Some blocks exist but order is off
    if (wrongKeys.length > 0) {
      setBaymax(
        "A few blocks are hanging in there, but the order feels a bit scrambled. Keep it as one neat vertical chain: choose the dataset first, then info/stats, then image stuff lower down."
      );
      setBaymaxMood("warning");
      setBaymaxTyping(true);
      return;
    }

    // Missing: dataset info
    if (missingKeys.includes("dataset.info")) {
      setBaymax(
        "We know *which* dataset we’re using, but we’re not asking it for any basic info yet. Maybe try adding something under the dataset that lets us read its summary."
      );
      setBaymaxMood("hint");
      setBaymaxTyping(true);
      return;
    }

    // Missing: counts / distribution
    if (
      missingKeys.includes("dataset.class_counts") ||
      missingKeys.includes("dataset.class_distribution_preview")
    ) {
      setBaymax(
        "We’ve got the dataset, but we’re not really looking at how the labels are spread out. Think of a block that shows how many examples each class has or how the classes are distributed."
      );
      setBaymaxMood("hint");
      setBaymaxTyping(true);
      return;
    }

    // Missing: sample image
    if (missingKeys.includes("dataset.sample_image")) {
      setBaymax(
        "Right now we’re only talking *about* the dataset, not actually looking at a picture from it. Try adding something that grabs one example image for us."
      );
      setBaymaxMood("hint");
      setBaymaxTyping(true);
      return;
    }

    // Sample loaded but nothing displays it
    if (sampleLoaded && !showInChain) {
      setBaymax(
        "We’re pulling an image, but we never actually show it on screen. Maybe think of a block that takes that sample and turns it into a visible preview."
      );
      setBaymaxMood("hint");
      setBaymaxTyping(true);
      return;
    }

    // Missing: channels / grayscale previews
    if (
      missingKeys.includes("image.channels_split") &&
      missingKeys.includes("image.to_grayscale_preview")
    ) {
      setBaymax(
        "We see the full-color image, but we haven’t tried breaking it down or simplifying it yet. Look for blocks that let you split colors or view a simpler, one-channel version."
      );
      setBaymaxMood("hint");
      setBaymaxTyping(true);
      return;
    } else if (missingKeys.includes("image.channels_split")) {
      setBaymax(
        "We’ve got the picture, but we’re not inspecting the color channels separately. Try something that peels the image into red, green, and blue pieces."
      );
      setBaymaxMood("hint");
      setBaymaxTyping(true);
      return;
    } else if (missingKeys.includes("image.to_grayscale_preview")) {
      setBaymax(
        "We’re still only viewing the full-color image. Maybe try a block that shows what it looks like if we collapse it into just light/dark values."
      );
      setBaymaxMood("hint");
      setBaymaxTyping(true);
      return;
    }

    // Everything present & in order
    if (done === checkItems.length && checkItems.length > 0) {
      setBaymax(
        "This chain is doing everything we need: info, counts, distribution, and visuals all in one line. If it looks good to you, try hitting “Submit & Run”."
      );
      setBaymaxMood("success");
      setBaymaxTyping(false);
      return;
    }

    // Default “almost there” vibe
    setBaymax(
      "You’re pretty close. Just keep everything stacked under the dataset block and think in this order: understand the dataset first, then grab a sample, then explore how it looks."
    );
    setBaymaxMood("neutral");
    setBaymaxTyping(true);
  }

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
    const splitInChain = !!(
      dsChain && isAfter(dsChain, "dataset.select", "image.channels_split")
    );
    const grayInChain = !!(
      dsChain && isAfter(dsChain, "dataset.select", "image.to_grayscale_preview")
    );

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
      const checklistNow = computeChecklist(ws);
      setCheckItems(checklistNow);
      updateBaymaxFromChecklist({
        dsChain,
        checkItems: checklistNow,
        sampleLoaded: !!(datasetKeyRef.current && sampleConf && sampleInChain),
        showInChain,
      });
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
            Object.values(dsInfoRef.current.approx_count || {}).reduce((a, c) => a + c, 0) ||
            1;
          const chart = Object.entries(dsInfoRef.current.approx_count || {}).map(
            ([label, count]) => ({
              label,
              percent: (count / total) * 100,
            })
          );
          newLogs.push({ kind: "chart", title: "Class Distribution (%)", data: chart });
        }
      }

      // sample + previews
      let sampleLoaded = false;

      if (datasetKeyRef.current && sampleConf && sampleInChain) {
        const url =
          sampleConf.mode === "index"
            ? `${API_BASE}/datasets/${encodeURIComponent(
                datasetKeyRef.current
              )}/sample?mode=index&index=${sampleConf.index}`
            : `${API_BASE}/datasets/${encodeURIComponent(datasetKeyRef.current)}/sample?mode=random`;

        sampleRef.current = await fetchJSON<SampleResponse>(url);
        sampleLoaded = true;

        if (showInChain) {
          newLogs.push({
            kind: "image",
            src: sampleRef.current.image_data_url,
            caption: `Original — label: ${sampleRef.current.label}`,
          });
        } else {
          newLogs.push({
            kind: "preview",
            text: `[preview] sample loaded (index ${sampleRef.current.index_used}); add a visual block after it to actually see the image.`,
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
          newLogs.push({
            kind: "image",
            src: gray.image_data_url,
            caption: "Grayscale preview",
          });
        }
      }

      if (myToken === tokenRef.current) setLogs(newLogs);

      const checklistNow = computeChecklist(ws);
      setCheckItems(checklistNow);
      updateBaymaxFromChecklist({
        dsChain,
        checkItems: checklistNow,
        sampleLoaded,
        showInChain,
      });
    } catch {
      // ignore transient errors
    }
  }

  /* ---------- Checklist (hidden in UI, but used logically) ---------- */
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
          const okOrder =
            isAfter(dsChain, "dataset.select", it.key) || it.key === "dataset.select";
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
    setBaymaxTyping(true);
    try {
      await instantFeedback();
      const items = computeChecklist(ws);
      const ok = items.every((i) => i.state === "ok");
      setSubmitSuccess(ok);
      setSubmitTitle(ok ? "Mission Complete!" : "Keep Exploring");
      setSubmitLines(
        ok
          ? [
              "✓ You explored dataset info, class counts, class distribution, loaded a sample, and visualized it in one clean chain.",
            ]
          : [
              "• Some blocks are still missing or not lined up under the dataset in a single chain. Adjust the order and try again.",
            ]
      );
      setSubmitOpen(true);

      if (ok) {
        setBaymax(
          "Nice work. You’ve basically taught me how to look at a dataset like a tiny researcher. When you’re ready, we can head to Module 2 and start preprocessing."
        );
        setBaymaxMood("success");
        setBaymaxTyping(false);
      } else {
        setBaymax(
          "Not bad at all, just a few pieces out of place. Keep everything under the dataset block and think: info → stats → sample → visuals."
        );
        setBaymaxMood("warning");
        setBaymaxTyping(false);
      }

      if (ok && !module2Unlocked) setModule2Unlocked(true);
    } finally {
      setRunning(false);
    }
  }

  /* ---------- UI ---------- */

  return (
    <div className="h-screen w-screen bg-[#E3E7F5]">
      {/* Top nav (matches home style) */}
      <header className="fixed top-0 left-0 right-0 z-20 backdrop-blur-xl bg-white/70 border-b border-white/60 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold text-slate-900">VisionBlocks</span>
            <span className="text-xs text-slate-500">Module 1 · Learn to See</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Home button */}
            <button
              onClick={() => router.push("/")}
              className="px-3 py-1.5 rounded-full border border-slate-300 bg-white/80 text-xs font-medium text-slate-700 hover:border-sky-400 hover:text-sky-600 hover:shadow-[0_0_0_1px_rgba(56,189,248,0.45)] transition"
            >
              Home
            </button>

            {/* Submit & Run (green) */}
            <button
              onClick={() => {
                if (!running) run();
              }}
              disabled={running}
              className={`relative px-4 py-1.5 rounded-full text-sm font-semibold text-white shadow-md transition
                ${
                  running
                    ? "bg-emerald-500/70 cursor-not-allowed"
                    : "bg-emerald-500 hover:bg-emerald-400 hover:shadow-[0_0_15px_rgba(16,185,129,0.7)]"
                }`}
            >
              <span className="relative z-10">
                {running ? "Submitting…" : "Submit & Run"}
              </span>
              {!running && (
                <span className="absolute inset-0 rounded-full bg-emerald-400/40 blur-sm opacity-0 hover:opacity-100 transition" />
              )}
            </button>

            {/* Module 2 button (unlocks on success) */}
            {module2Unlocked ? (
              <button
                onClick={() => router.push("/module2")}
                className="px-4 py-1.5 rounded-full border border-sky-400 bg-white/80 text-sm font-medium text-sky-700 hover:bg-sky-50 hover:shadow-[0_0_0_1px_rgba(56,189,248,0.55)] transition"
                title="Go to Module 2"
              >
                Module 2
              </button>
            ) : (
              <button
                type="button"
                aria-disabled="true"
                className="px-4 py-1.5 rounded-full border border-slate-300 bg-white/60 text-sm font-medium text-slate-400 cursor-not-allowed"
                title="Complete this mission to unlock Module 2"
              >
                Module 2
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main layout */}
      <div className="pt-20 h-full">
        <div
          className="max-w-[1400px] mx-auto px-4 h-[calc(100vh-5rem)] grid gap-4"
          style={{ gridTemplateColumns: `minmax(0, 1.9fr) minmax(0, 1.2fr)` }}
        >
          {/* LEFT: Blockly workspace */}
          <div className="h-full min-h-0 rounded-3xl bg-white shadow-[0_22px_60px_rgba(15,23,42,0.25)] border border-white/70 overflow-hidden">
            <div ref={blocklyDivRef} className="w-full h-full min-h-0" />
          </div>

          {/* RIGHT: Baymax + Output (scrollable) */}
          <div className="h-full min-h-0 rounded-3xl border border-white/80 bg-gradient-to-b from-white/90 to-[#E0E5F4] shadow-[0_18px_45px_rgba(15,23,42,0.22)] flex flex-col">
            <div className="flex flex-col min-h-0 px-4 py-4 gap-4">
              {/* Baymax “free in the panel” */}
              <div className="shrink-0">
                <BaymaxPanel
                  line={baymax}
                  mood={baymaxMood}
                  typing={baymaxTyping}
                  dark={false}
                />
              </div>

              {/* Output takes rest */}
              <div className="flex-1 min-h-0">
                <OutputPanel logs={logs} onClear={() => setLogs([])} dark={false} />
              </div>

              {/* Hidden checklist – still used, not shown */}
              <div className="hidden">
                <MissionChecklistStage items={checkItems} dark={false} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Info Modal */}
      <InfoModal
        open={infoOpen}
        title={infoTitle}
        text={infoText}
        dark={false}
        onClose={() => setInfoOpen(false)}
      />

      {/* Submission Modal */}
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
