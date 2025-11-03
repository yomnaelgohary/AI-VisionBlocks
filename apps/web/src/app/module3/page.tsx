"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceSvg, Block as BlocklyBlock } from "blockly";
import { Blockly, setDatasetOptions } from "@/lib/blockly";
import { toolboxJsonModule3 } from "@/components/toolboxModule3"; // your Module 3 toolbox
import OutputPanel, { type LogItem } from "@/components/OutputPanel";
import BaymaxPanel from "@/components/BaymaxPanel";
import { DarkTheme, LightTheme } from "@/lib/blockly/theme";

const API_BASE = "http://localhost:8000";

// Common helpers
async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

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
      const field = (b as any).getField("DATASET");
      const cur = field?.getValue?.();
      if (cur && !validKeys.has(cur) && data.items.length > 0) {
        field.setValue(data.items[0].key);
      } else if (cur) {
        // nudge update
        field.setValue(cur);
      }
    }
  }
}

export default function Module3Page() {
  const blocklyDivRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<WorkspaceSvg | null>(null);

  const [logs, setLogs] = useState<LogItem[]>([]);
  const [baymaxLine, setBaymaxLine] = useState<string>(
    "Let’s make our training set fair and ready!"
  );
  const [dark, setDark] = useState<boolean>(true);
  const [running, setRunning] = useState<boolean>(false);

  // Info modal state (for the (i) icons)
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTitle, setInfoTitle] = useState<string>("Info");
  const [infoText, setInfoText] = useState<string>("");

  const sizes = useMemo(() => ({ rightWidth: 380 }), []);

  // Inject Blockly
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
    try {
      (ws as any).scrollCenter?.();
    } catch {}

    // Load datasets into dropdowns initially
    refreshDatasets(ws).catch(() => {});

    return () => ws.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocklyDivRef.current]);

  // Toggle theme on the live workspace
  useEffect(() => {
    if (!workspaceRef.current) return;
    workspaceRef.current.setTheme(dark ? DarkTheme : LightTheme);
  }, [dark]);

  // Listen for block info events dispatched from appendInfo(...)
  useEffect(() => {
    function onInfo(e: Event) {
      const ce = e as CustomEvent<{ title?: string; text?: string }>;
      setInfoTitle(ce.detail?.title || "Info");
      setInfoText(ce.detail?.text || "");
      setInfoOpen(true);
    }
    window.addEventListener("vb:blockInfo", onInfo as any);
    return () => window.removeEventListener("vb:blockInfo", onInfo as any);
  }, []);

  // OPTIONAL: instant feedback wiring for preview-only blocks
  // If you’ve already added the same pattern as Module 2 (onChange → call APIs),
  // you can keep that hook here. Below is a placeholder you can extend.
  useEffect(() => {
    const ws = workspaceRef.current;
    if (!ws) return;

    function onChange(_evt: any) {
      // You can mirror Module 2’s instant preview logic here
      // e.g., when m3.set_split_ratio changes: compute preview counts (no server write)
      // when m3.apply_split is placed: mark current split active in-session (no disk write)
      // when m3.check_bias_train changes: compute bias summary from current split
      // Update logs with preview cards/images as needed
    }

    ws.addChangeListener(onChange);
    return () => ws.removeChangeListener(onChange);
  }, []);

  // “Submit & Run” executes heavy steps like balance_train
  async function run(): Promise<void> {
    const ws = workspaceRef.current;
    if (!ws) return;

    setRunning(true);
    const newLogs: LogItem[] = [];

    try {
      // Example: walk blocks, find a balance block with its parameters and call your API.
      // (Adjust this to fit whatever JSON your /split/balance endpoint expects.)
      let found = false;
      for (const top of ws.getTopBlocks(true) as BlocklyBlock[]) {
        for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
          if (b.type === "m3.balance_train") {
            const mode = b.getFieldValue("MODE");
            const target = Number(b.getFieldValue("TARGET") || 25);
            newLogs.push({
              kind: "card",
              title: "Balancing Training Set",
              lines: [`Mode: ${mode}`, `Target min %: ${target}`],
            });

            // Example POST (adjust your backend route if different)
            // const resp = await fetchJSON<{ summary: string[] }>(
            //   `${API_BASE}/split/balance`,
            //   {
            //     method: "POST",
            //     headers: { "Content-Type": "application/json" },
            //     body: JSON.stringify({ mode, target }),
            //   }
            // );
            // newLogs.push({ kind: "card", title: "Balance Result", lines: resp.summary });

            found = true;
            break;
          }
        }
        if (found) break;
      }

      if (!found) {
        newLogs.push({
          kind: "warn",
          text:
            "Add the ‘balance training set’ block before submitting, or use the instant preview blocks to explore the dataset.",
        });
      }

      setLogs(newLogs);
      setBaymaxLine("Teamwork makes the classes fair!");
    } catch (e: any) {
      setLogs((prev) => [
        ...prev,
        { kind: "error", text: `Run failed: ${e?.message || String(e)}` },
      ]);
      setBaymaxLine("Hmm, something went off. Can you check your blocks?");
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

      {/* Output + Baymax (scrollable column) */}
      <div className={`border-l p-3 flex flex-col gap-4 min-h-0 overflow-y-auto ${rightBg}`}>
        <div className="min-h-[240px]">
          <OutputPanel logs={logs} onClear={() => setLogs([])} dark={dark} />
        </div>
        <div className="flex-1 min-h-0">
          <BaymaxPanel line={baymaxLine} dark={dark} />
        </div>
      </div>

      {/* Info modal (for (i) icons) */}
      {infoOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setInfoOpen(false)} />
          <div
            className={`relative w-[92%] max-w-md rounded-2xl border p-5 shadow-xl ${
              dark ? "bg-neutral-900 border-neutral-800 text-neutral-100" : "bg-white border-gray-200 text-gray-900"
            }`}
          >
            <div className="text-lg font-semibold mb-2">{infoTitle}</div>
            <div className="text-sm whitespace-pre-line">{infoText}</div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setInfoOpen(false)}
                className={`px-3 py-1.5 rounded-md border ${
                  dark ? "border-neutral-700 text-neutral-200 hover:bg-neutral-800" : "border-gray-300 text-gray-800 hover:bg-gray-50"
                }`}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
