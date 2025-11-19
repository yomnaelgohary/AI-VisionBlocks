"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceSvg, Block as BlocklyBlock } from "blockly";
import { Blockly } from "@/lib/blockly";
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

/* ----------------- Baymax mood ----------------- */

type BaymaxMood = "neutral" | "hint" | "warning" | "success" | "error";

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

  const [dark, setDark] = useState(false); // keep API compatibility, but UI stays light
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogItem[]>([]);

  const [baymax, setBaymax] = useState<string>(
    "This stage is all about shaping the image before the model sees it. Start by chaining your preprocessing blocks under the sample image."
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

  // last successful completion toggle (enables Next Stage)
  const [canGoNext, setCanGoNext] = useState(false);

  const sampleRef = useRef<SampleResp | null>(null);
  const datasetKeyRef = useRef<string | null>(null);

  const [targetSrc, setTargetSrc] = useState<string>();
  const [currentSrc, setCurrentSrc] = useState<string>();

  // debounce/thrash control
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genTokenRef = useRef(0);
  const lastCtxSigRef = useRef<string>("");

  const sizes = useMemo(() => ({ rightWidth: 420 }), []);

  const [checkItems, setCheckItems] = useState<StageChecklistItem[]>([]);

  /* ---------- Blockly inject + listeners ---------- */
  useEffect(() => {
    if (!stage || !blocklyDivRef.current) return;

    // reset image state + tokens on stage change
    lastCtxSigRef.current = "";
    genTokenRef.current++;
    setTargetSrc(undefined);
    setCurrentSrc(undefined);
    setCanGoNext(false);

    const ws = Blockly.inject(blocklyDivRef.current, {
      toolbox: toolboxJsonModule2,
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
      // Slight delay to coalesce UI events
      setTimeout(async () => {
        if (stage?.type === "pipeline") {
          previewPipelineDebounced();
        }
        const items = computeChecklist(ws, stage);
        setCheckItems(items);
        updateBaymaxFromChecklist(stage, items);
      }, 200);
    };
    ws.addChangeListener(onChange);

    // initial checklist + Baymax text
    const initialItems = computeChecklist(ws, stage);
    setCheckItems(initialItems);
    updateBaymaxFromChecklist(stage, initialItems);

    return () => {
      window.removeEventListener("vb:blockInfo", onInfo as any);
      ws.removeChangeListener(onChange);
      ws.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageId, dark]);

  useEffect(() => {
    if (workspaceRef.current)
      workspaceRef.current.setTheme(dark ? DarkTheme : LightTheme);
  }, [dark]);

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
      return;
    }

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

    // show unprocessed current image immediately
    setCurrentSrc(sample.image_data_url);

    // Build target (pipeline stages only)
    if (stage?.type === "pipeline" && stage.targetOps) {
      const tgt = await fetchJSON<ApplyResp>(`${API_BASE}/preprocess/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_key: foundDsKey,
          path: sample.path,
          ops: stage.targetOps,
        }),
      });
      setTargetSrc(tgt.after_data_url);
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

  async function previewPipelineDebounced() {
    const ws = workspaceRef.current;
    if (!ws || !stage) return;

    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(async () => {
      const token = ++genTokenRef.current;

      await ensureSample(ws);
      if (!sampleRef.current || !datasetKeyRef.current) return;

      const top = findFirstPipelineTop(ws);
      if (!top) return;

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
        }
      } catch {
        // ignore rapid-edit errors
      }
    }, 350);
  }

  /* ---------- Checklist (tri-state) ---------- */

  function paramMismatch(block: BlocklyBlock | null, spec?: OpSpec): boolean {
    if (!block || !spec) return false;

    if (spec.type === "resize") {
      const mode = block.getFieldValue("MODE");
      if (mode === "fit") {
        const ms = Number(block.getFieldValue("MAXSIDE") || 0);
        return ms !== 150;
      }
      if (mode === "size") {
        const keepRaw = block.getFieldValue("KEEP");
        const keep = String(keepRaw || "FALSE").toUpperCase() === "TRUE";
        const w = Number(block.getFieldValue("W") || 0);
        const h = Number(block.getFieldValue("H") || 0);
        if (keep && (w === 150 || h === 150)) return false;
        return true;
      }
      return true;
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
        if (inChain && s.targetOps) {
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

  /* ---------- Baymax driven by checklist ---------- */

  function updateBaymaxFromChecklist(s: StageConfig, items: StageChecklistItem[]) {
    const done = items.filter((i) => i.state === "ok").length;
    const missing = items.filter((i) => i.state === "missing");
    const wrong = items.filter((i) => i.state === "wrong_place");

    const stageKey = String(s.id);

    // No required items (fallback)
    if (items.length === 0) {
      setBaymax("Drag your preprocessing blocks into a single chain under the sample image. Each stage builds on the previous one.");
      setBaymaxMood("neutral");
      setBaymaxTyping(false);
      return;
    }

    // If some blocks are present but in the wrong place
    if (wrong.length > 0) {
      setBaymax(
        "You dropped some good blocks, but the order feels off. Try keeping them in one straight line, and think: earlier steps closer to the sample image, later tweaks lower in the chain."
      );
      setBaymaxMood("warning");
      setBaymaxTyping(true);
      return;
    }

    // Handle missing blocks with stage-specific vibes (but no exact block names)
    if (missing.length > 0) {
      const firstMissing = missing[0];

      if (s.type === "loop_export") {
        setBaymax(
          "For this mission we want the whole preprocessing recipe running inside the loop, then a final step after it that saves everything as a new dataset. Check that all the key steps made it into the loop body."
        );
        setBaymaxMood("hint");
        setBaymaxTyping(true);
        return;
      }

      // Pipeline stages
      if (stageKey === "1") {
        setBaymax(
          "This stage is about stripping away color so we only care about light and dark. Make sure your chain includes a step that simplifies the image like that, after the sample image."
        );
      } else if (stageKey === "2") {
        setBaymax(
          "Here we’re doing gentle cleanup, small brightness/contrast tweaks and maybe smoothing or sharpening. Check that the chain actually includes a lighting tweak and an edge/detail tweak."
        );
      } else if (stageKey === "3") {
        setBaymax(
          "We’re trying to get everything into a comfy, square frame. Ask yourself: do I have steps that control size and how empty space is handled around the image?"
        );
      } else if (stageKey === "4") {
        setBaymax(
          "The goal now is to get pixel values into a nice, consistent numeric range. Look for the step that rescales numbers rather than changing how the image looks."
        );
      } else if (stageKey === "5") {
        setBaymax(
          "This mission is about automation: run your full recipe over many images, then save them out. Your loop body should look like a mini preprocessing pipeline, and there should be a save step after the loop."
        );
      } else if (stageKey === "bonus") {
        setBaymax(
          "Bonus time: we’re hunting for outlines. Check that your chain includes a step that focuses on edges and structure, not brightness or size."
        );
      } else {
        setBaymax(
          "Some of the core steps for this mission are still missing. Compare what the intro says you should practice with what you actually dropped into the chain."
        );
      }

      setBaymaxMood("hint");
      setBaymaxTyping(true);
      return;
    }

    // All required blocks present and in order
    if (done === items.length && items.length > 0) {
      if (s.type === "loop_export") {
        setBaymax(
          "Nice, you’ve turned your preprocessing into a full-on production line and saved out a new dataset. Hit Submit & Run when you’re ready to process the real thing."
        );
      } else {
        setBaymax(
          "This chain looks solid for this stage. If the target image on the right matches what you’re getting, you’re good to go. Try Submit & Run."
        );
      }
      setBaymaxMood("success");
      setBaymaxTyping(false);
      return;
    }

    // Fallback “almost there”
    setBaymax(
      "You’re close. Keep everything in one chain under the sample image and ask: have I covered all the steps this stage talks about, in a sensible order?"
    );
    setBaymaxMood("neutral");
    setBaymaxTyping(true);
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
          lines.push("• Make sure the dataset, sample, and preprocessing blocks are connected in one chain.");
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
          const allOk = itemsNow.every((i) => i.state === "ok");
          ok = ok && allOk;

          if (!allOk) {
            lines.push(
              "• Some preprocessing steps are missing or not in the right place. Check the mission text and Baymax’s hints, then adjust your chain."
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

            const resp = await fetchJSON<ExportResp>(`${API_BASE}/preprocess/batch_export`, {
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
            lines.push(
              "• The loop body should contain the full preprocessing recipe, and there should be a save step right after the loop."
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

      // Stage-specific submission copy
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
          setSubmitLines(["✓ All required preprocessing steps are in place for this mission."]);
        }

        setCanGoNext(true);
        setLogs((prev) => [...prev, ...newLogs]);
        setBaymax(
          stage.type === "loop_export"
            ? "That’s a full preprocessing production line right there. Your dataset is officially glow-up ready for training."
            : "Nice, this stage’s pipeline looks solid. When you’re ready, we can hop to the next mission and layer more steps on top."
        );
        setBaymaxMood("success");
        setBaymaxTyping(false);
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
        setBaymax(
          "You’re not far off. Check the mission description, follow the target image, and treat Baymax’s hints as gentle nudges, not spoilers."
        );
        setBaymaxMood("warning");
        setBaymaxTyping(false);
        setCanGoNext(false);
      }

      setSubmitOpen(true);
    } catch (e: any) {
      setSubmitSuccess(false);
      setCanGoNext(false);
      setSubmitTitle("Error while running");
      setSubmitLines([e?.message || String(e)]);
      setSubmitOpen(true);
      setBaymax("Something broke while running the pipeline. Fix any obvious errors and try again.");
      setBaymaxMood("error");
      setBaymaxTyping(false);
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

          {/* RIGHT: intro + Baymax + target + output */}
          <div className="h-full min-h-0 rounded-3xl border border-white/80 bg-gradient-to-b from-white/90 to-[#E0E5F4] shadow-[0_18px_45px_rgba(15,23,42,0.22)] flex flex-col">
            <div className="flex flex-col min-h-0 px-4 py-4 gap-4">
              {/* Stage intro card */}
              <div className="shrink-0 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      {stage.title}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Use the blocks to build the preprocessing steps described here. Try to make your result match the target image.
                    </p>
                  </div>
                  {/* Stage help */}
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
                <ul className="list-disc ml-5 mt-2 text-xs text-slate-700">
                  {stage.intro.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>

              {/* Baymax helper */}
              <div className="shrink-0">
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
