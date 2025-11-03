"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceSvg, Block as BlocklyBlock } from "blockly";
import { Blockly, setDatasetOptions } from "@/lib/blockly";
import { toolboxJsonModule3 } from "@/components/toolboxModule3";
import OutputPanel, { type LogItem } from "@/components/OutputPanel";
import BaymaxPanel from "@/components/BaymaxPanel";
import { DarkTheme, LightTheme } from "@/lib/blockly/theme";
import InfoModal from "@/components/InfoModal";
import MissionChecklistM3 from "@/components/MissionChecklistM3";

const API_BASE = "http://localhost:8000";

/* ---------- Types ---------- */
type DatasetInfoResp = {
  key: string;
  name: string;
  classes: string[];
  approx_count: Record<string, number>;
};

type SplitPreviewResp = {
  dataset_key: string;
  train_pct: number;
  classes: string[];
  total_per_class: Record<string, number>;
  train_per_class: Record<string, number>;
  test_per_class: Record<string, number>;
};

type ApplySplitResp = {
  dataset_key: string;
  train_pct: number;
  classes: string[];
  train: { size: number; per_class: Record<string, number> };
  test: { size: number; per_class: Record<string, number> };
  note: string;
};

type BiasResp = {
  train_size: number;
  per_class: Record<string, number>;
  pct: Record<string, number>;
  mean_pct: number;
  threshold_pct: number;
  flagged: Record<string, { pct: number; diff: number }>;
  note: string;
};

type BalanceResp = {
  dataset_key: string;
  mode: "duplicate" | "augment" | "undersample";
  target_min_pct: number;
  before: { counts: Record<string, number>; pct: Record<string, number>; total: number };
  after: { counts: Record<string, number>; pct: Record<string, number>; total: number };
  note: string;
};

/* ---------- Helpers ---------- */
async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function refreshDatasets(workspace?: WorkspaceSvg) {
  const data = await fetchJSON<{ items: { key: string; name: string }[] }>(`${API_BASE}/datasets`);
  setDatasetOptions(data.items.map((i) => ({ name: i.name, key: i.key })));

  if (!workspace) return;
  const blocks = workspace.getAllBlocks(false);
  const valid = new Set(data.items.map((i) => i.key));
  for (const b of blocks) {
    if (b.type === "dataset.select") {
      const field = b.getField("DATASET") as any;
      const cur = field?.getValue?.();
      if (cur && !valid.has(cur) && data.items.length > 0) field.setValue(data.items[0].key);
      else field?.setValue(cur);
    }
  }
}

function getNum(b: BlocklyBlock, name: string, def: number): number {
  const raw = b.getFieldValue(name);
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? def), 10);
  return Number.isFinite(n) ? n : def;
}

/** Walk upward to see if there is a dataset.select in the SAME chain. */
function hasDatasetAbove(b: BlocklyBlock): { ok: boolean; key?: string } {
  let cur: BlocklyBlock | null = b;
  while (cur) {
    if (cur.type === "dataset.select") {
      const key = cur.getFieldValue("DATASET");
      return { ok: !!key, key };
    }
    cur = cur.getPreviousBlock();
  }
  return { ok: false };
}

/** Build a compact signature of the workspace to avoid re-running identical state. */
function buildSignature(ws: WorkspaceSvg): string {
  const tops = ws.getTopBlocks(true) as BlocklyBlock[];
  const chains: any[] = [];
  for (const top of tops) {
    const chain: any[] = [];
    for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
      const fields = (b.inputList || [])
        .flatMap((inp: any) => inp.fieldRow || [])
        .map((f: any) => [f?.name, f?.getValue?.()] as const)
        .filter(([n]) => !!n);
      chain.push([b.type, fields]);
    }
    chains.push(chain);
  }
  return JSON.stringify(chains);
}

/* ---------- Component ---------- */
export default function Module3Page() {
  const blocklyDivRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<WorkspaceSvg | null>(null);

  const [logs, setLogs] = useState<LogItem[]>([]);
  const [baymaxLine, setBaymaxLine] = useState("Let’s prepare fair training data!");
  const [dark, setDark] = useState(true);
  const [running, setRunning] = useState(false);

  // Info modal (from “i” icons)
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTitle, setInfoTitle] = useState<string | undefined>();
  const [infoText, setInfoText] = useState<string | undefined>();

  // Mission progress
  const [progress, setProgress] = useState({
    datasetSelected: false,
    splitPreviewed: false,
    splitApplied: false,
    biasChecked: false,
    balanced: false, // set after Submit & Run
  });

  const sizes = useMemo(() => ({ rightWidth: 420 }), []);

  // debounce + signature
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSigRef = useRef<string>("");

  useEffect(() => {
    const onInfo = (e: any) => {
      const { title, text } = (e?.detail ?? {}) as { title?: string; text?: string };
      setInfoTitle(title || "What does this block do?");
      setInfoText(text || "");
      setInfoOpen(true);
    };
    window.addEventListener("vb:blockInfo", onInfo as any);
    return () => window.removeEventListener("vb:blockInfo", onInfo as any);
  }, []);

  /** Instant scan that only evaluates blocks ATTACHED to a chain with 'use dataset'. */
  const scanInstant = async () => {
    const ws = workspaceRef.current;
    if (!ws) return;

    const sig = buildSignature(ws);
    if (sig === lastSigRef.current) return;
    lastSigRef.current = sig;

    const newLogs: LogItem[] = [];
    let datasetSelected = false;
    let splitPreviewed = false;
    let splitApplied = false;
    let biasChecked = false;

    const tops = ws.getTopBlocks(true) as BlocklyBlock[];

    // If any dataset.select exists anywhere, mark selected = true (the chain check still applies when running APIs)
    datasetSelected = tops.some((top) => {
      for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
        if (b.type === "dataset.select") return true;
      }
      return false;
    });

    for (const top of tops) {
      for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
        const upstream = hasDatasetAbove(b);
        if (!upstream.ok || !upstream.key) continue;
        const ds = upstream.key!;

        if (b.type === "dataset.info") {
          const info = await fetchJSON<DatasetInfoResp>(
            `${API_BASE}/datasets/${encodeURIComponent(ds)}/info`
          );
          newLogs.push({
            kind: "card",
            title: "Dataset Info",
            lines: [
              `Name: ${info.name}`,
              `Classes: ${info.classes.join(", ") || "(none)"}`,
            ],
          });
        }

        if (b.type === "dataset.class_counts") {
          const info = await fetchJSON<DatasetInfoResp>(
            `${API_BASE}/datasets/${encodeURIComponent(ds)}/info`
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

        if (b.type === "dataset.class_distribution_preview") {
          const info = await fetchJSON<DatasetInfoResp>(
            `${API_BASE}/datasets/${encodeURIComponent(ds)}/info`
          );
          const total = Object.values(info.approx_count || {}).reduce((a, c) => a + c, 0);
          const lines =
            total > 0
              ? info.classes.map((cls) => {
                  const n = info.approx_count?.[cls] ?? 0;
                  const pct = ((n / total) * 100).toFixed(1);
                  return `${cls}: ${pct}%`;
                })
              : ["(no images)"];
          newLogs.push({ kind: "card", title: "Class Distribution (%)", lines });
        }

        if (b.type === "m3.set_split_ratio") {
          const trainPct = getNum(b, "TRAIN", 80);
          const resp = await fetchJSON<SplitPreviewResp>(`${API_BASE}/split/preview`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataset_key: ds, train_pct: trainPct }),
          });
          const lines = [
            `Train%: ${resp.train_pct}`,
            ...resp.classes.map(
              (c) =>
                `${c}: total=${resp.total_per_class[c]}, train=${resp.train_per_class[c]}, test=${resp.test_per_class[c]}`
            ),
          ];
          newLogs.push({ kind: "card", title: "Split preview", lines });
          splitPreviewed = true;
        }

        if (b.type === "m3.apply_split") {
          let trainPct = 80;
          let cur: BlocklyBlock | null = b;
          while (cur) {
            if (cur.type === "m3.set_split_ratio") {
              trainPct = getNum(cur, "TRAIN", 80);
              break;
            }
            cur = cur.getPreviousBlock();
          }
          const resp = await fetchJSON<ApplySplitResp>(`${API_BASE}/split/apply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataset_key: ds, train_pct: trainPct, shuffle: true }),
          });
          newLogs.push({
            kind: "card",
            title: "Split applied",
            lines: [
              `Train% active: ${resp.train_pct}`,
              `Train size: ${resp.train.size}`,
              `Test size: ${resp.test.size}`,
            ],
          });
          splitApplied = true;
        }

        if (b.type === "m3.check_bias_train") {
          const thr = getNum(b, "THRESH", 10);
          try {
            const resp = await fetchJSON<BiasResp>(`${API_BASE}/split/bias`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ dataset_key: ds, threshold_pct: thr }),
            });
            const lines = [
              `Train size: ${resp.train_size}`,
              ...Object.keys(resp.per_class).map(
                (c) => `${c}: ${resp.per_class[c]} (${resp.pct[c].toFixed(1)}%)`
              ),
              ...(Object.keys(resp.flagged).length
                ? [
                    "Flagged (far from mean):",
                    ...Object.entries(resp.flagged).map(
                      ([c, v]) => `• ${c}: ${v.pct.toFixed(1)}% (diff ${v.diff.toFixed(1)}%)`
                    ),
                  ]
                : ["No strong bias detected."]),
            ];
            newLogs.push({ kind: "card", title: "Training bias check", lines });
            biasChecked = true;
          } catch {
            newLogs.push({ kind: "warn", text: "Apply the split first in this chain." });
          }
        }
      }
    }

    setLogs(newLogs.length ? newLogs : [{ kind: "info", text: "Add and connect blocks to see results." }]);
    setProgress((p) => ({
      ...p,
      datasetSelected,
      splitPreviewed,
      splitApplied,
      biasChecked,
      // p.balanced is only set on Submit & Run success
    }));
    setBaymaxLine("Up to date!");
  };

  const submitAndRun = async () => {
    const ws = workspaceRef.current;
    if (!ws) return;
    setRunning(true);

    try {
      let target: { ds: string; block: BlocklyBlock } | null = null;
      for (const top of ws.getTopBlocks(true) as BlocklyBlock[]) {
        for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
          if (b.type === "m3.balance_train") {
            const up = hasDatasetAbove(b);
            if (up.ok && up.key) {
              target = { ds: up.key, block: b };
              break;
            }
          }
        }
      }

      if (!target) {
        setLogs([{ kind: "warn", text: "Connect a 'balance training set' block to a chain with 'use dataset'." }]);
        return;
      }

      // ensure split is applied from the same chain if present
      let trainPct = 80;
      let cur: BlocklyBlock | null = target.block;
      while (cur) {
        if (cur.type === "m3.set_split_ratio") {
          trainPct = getNum(cur, "TRAIN", 80);
          break;
        }
        cur = cur.getPreviousBlock();
      }
      await fetchJSON<ApplySplitResp>(`${API_BASE}/split/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset_key: target.ds, train_pct: trainPct, shuffle: true }),
      });

      const mode = target.block.getFieldValue("MODE") as "duplicate" | "augment" | "undersample";
      const targetMin = getNum(target.block, "TARGET", 25);
      const resp = await fetchJSON<BalanceResp>(`${API_BASE}/split/balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset_key: target.ds, mode, target_min_pct: targetMin }),
      });

      const fmt = (x: number) => x.toFixed(1);
      const beforeLines = [
        `Total: ${resp.before.total}`,
        ...Object.keys(resp.before.counts).map(
          (c) => `${c}: ${resp.before.counts[c]} (${fmt(resp.before.pct[c])}%)`
        ),
      ];
      const afterLines = [
        `Total: ${resp.after.total}`,
        ...Object.keys(resp.after.counts).map(
          (c) => `${c}: ${resp.after.counts[c]} (${fmt(resp.after.pct[c])}%)`
        ),
      ];
      setLogs([
        { kind: "card", title: "Balanced (before)", lines: beforeLines },
        { kind: "card", title: "Balanced (after)", lines: afterLines },
      ]);
      setProgress((p) => ({ ...p, balanced: true }));
      setBaymaxLine("Training set looks fairer now!");
    } catch (e: any) {
      setLogs([{ kind: "error", text: `Submit failed: ${e?.message || String(e)}` }]);
      setBaymaxLine("Hmm, something went wrong—check the blocks.");
    } finally {
      setRunning(false);
    }
  };

  // Init Blockly + debounced change handling
  useEffect(() => {
    if (!blocklyDivRef.current) return;

    const ws = Blockly.inject(blocklyDivRef.current, {
      toolbox: toolboxJsonModule3,
      renderer: "zelos",
      theme: dark ? DarkTheme : LightTheme,
      trashcan: true,
      scrollbars: true,
      zoom: { controls: true, wheel: true, startScale: 0.9 },
    });
    workspaceRef.current = ws;

    ws.clear();
    (ws as any).scrollCenter?.();

    (async () => {
      await refreshDatasets(ws);
      await scanInstant();
    })();

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

      if (scanTimer.current) clearTimeout(scanTimer.current);
      scanTimer.current = setTimeout(() => {
        scanInstant().catch((e) =>
          setLogs([{ kind: "error", text: `Instant update failed: ${e?.message || String(e)}` }])
        );
      }, 300);
    };
    ws.addChangeListener(onChange);

    return () => {
      ws.removeChangeListener(onChange);
      ws.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocklyDivRef.current]);

  useEffect(() => {
    workspaceRef.current?.setTheme(dark ? DarkTheme : LightTheme);
  }, [dark]);

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
        <div className={`font-semibold ${barText}`}>VisionBlocks — Module 3: Splitting & Bias</div>
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
            onClick={() => { if (!running) submitAndRun(); }}
            className={`px-4 py-1.5 rounded-md ${running ? "opacity-60 cursor-not-allowed" : ""} bg-black text-white`}
            disabled={running}
          >
            {running ? "Submitting…" : "Submit & Run"}
          </button>
        </div>
      </div>

      {/* Workspace */}
      <div ref={blocklyDivRef} className={`relative min-h-0 ${dark ? "bg-neutral-950" : "bg-white"}`} />

      {/* Right column: Checklist + Output + Baymax (scrollable) */}
      <div className={`border-l p-3 min-h-0 ${rightBg}`}>
        <div className="h-full min-h-0 flex flex-col gap-4 overflow-y-auto pr-1">
          <MissionChecklistM3 dark={dark} progress={progress} />
          <OutputPanel logs={logs} onClear={() => setLogs([])} dark={dark} />
          <BaymaxPanel line={baymaxLine} dark={dark} />
        </div>
      </div>

      {/* Info modal */}
      <InfoModal
        open={infoOpen}
        title={infoTitle}
        text={infoText}
        dark={dark}
        onClose={() => setInfoOpen(false)}
      />
    </div>
  );
}
