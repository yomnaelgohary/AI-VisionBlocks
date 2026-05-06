"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceSvg, Block as BlocklyBlock } from "blockly";
import { Blockly, setDatasetOptions } from "@/lib/blockly";
import { DarkTheme, LightTheme } from "@/lib/blockly/theme";
import { toolboxJsonModule2 } from "@/components/toolboxModule2";

import OutputPanel, { type LogItem } from "@/components/OutputPanel";
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

const API_BASE = "http://127.0.0.1:8000";

const STAGE1_REQUIRED = [
  "m2.to_grayscale",
  "m2.brightness_contrast",
  "m2.blur_sharpen",
];

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

type AnalyzerBlock = { type: string; fields: Record<string, unknown> };
type AnalyzerChain = { top_block_type: string | null; blocks: AnalyzerBlock[] };
type AnalyzeAgentReq = {
  chains: AnalyzerChain[];
  client_signature?: string;
  stage_id?: string;
};
type AnalyzeAgentResp = {
  analyzer: {
    signature: string;
  };
  agent_text: string;
};

type ChatRole = "user" | "assistant";

type ChatEntry = {
  ts: number;
  role: ChatRole;
  text: string;
  source?: "hint" | "chat";
};

type BaymaxMood = "neutral" | "hint" | "warning" | "success" | "error";

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

function blockToAnalyzerModel(b: BlocklyBlock): AnalyzerBlock {
  const fields: Record<string, unknown> = {};
  for (const input of b.inputList || []) {
    for (const field of input.fieldRow || []) {
      const name = (field as any).name as string | undefined;
      if (!name) continue;
      const val = (field as any).getValue?.() ?? (field as any).getText?.();
      fields[name] = val;
    }
  }
  return { type: b.type, fields };
}

const hasType = (chain: BlocklyBlock[], type: string) => chain.some((b) => b.type === type);
const indexOfType = (chain: BlocklyBlock[], type: string) => chain.findIndex((b) => b.type === type);
const isAfter = (chain: BlocklyBlock[], beforeType: string, targetType: string) => {
  const a = indexOfType(chain, beforeType);
  const b = indexOfType(chain, targetType);
  return a !== -1 && b !== -1 && b > a;
};

function findFirstPipelineTop(ws: WorkspaceSvg | null): BlocklyBlock | null {
  if (!ws) return null;
  const tops = ws.getTopBlocks(true) as BlocklyBlock[];
  for (const top of tops) {
    for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) {
      if (b.type && b.type.startsWith("m2.")) return top;
    }
  }
  return null;
}

function walkConnectedChainFrom(top: BlocklyBlock | null): string[] {
  const types: string[] = [];
  for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) types.push(b.type);
  return types;
}

function findBlockByTypeInChain(top: BlocklyBlock | null, type: string): BlocklyBlock | null {
  for (let b: BlocklyBlock | null = top; b; b = b.getNextBlock()) if (b.type === type) return b;
  return null;
}

function buildTargetOpsForStage(s: StageConfig): OpSpec[] | undefined {
  return (s as any).targetOps ?? undefined;
}

function pickLine(options: string[], key: string): string {
  if (!options.length) return "";
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % options.length;
  return options[idx];
}

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

/* ----------------- param mismatch for checklist ----------------- */
function paramMismatch(block: BlocklyBlock | null, spec?: OpSpec): boolean {
  if (!block || !spec) return false;

  if (spec.type === "resize") {
    const mode = block.getFieldValue("MODE");
    if (spec.mode && mode !== spec.mode) return true;

    if (spec.w !== undefined) {
      const w = Number(block.getFieldValue("W") || 0);
      if (w !== spec.w) return true;
    }

    if (spec.h !== undefined) {
      const h = Number(block.getFieldValue("H") || 0);
      if (h !== spec.h) return true;
    }

    if (spec.maxside !== undefined) {
      const maxside = Number(block.getFieldValue("MAXSIDE") || 0);
      if (maxside !== spec.maxside) return true;
    }

    if (spec.keep !== undefined) {
      const keep = block.getFieldValue("KEEP");
      if (keep !== spec.keep) return true;
    }

    return false;
  }

  if (spec.type === "pad") {
    if (spec.w !== undefined) {
      const w = Number(block.getFieldValue("W") || 0);
      if (w !== spec.w) return true;
    }

    if (spec.h !== undefined) {
      const h = Number(block.getFieldValue("H") || 0);
      if (h !== spec.h) return true;
    }

    if (spec.mode !== undefined) {
      const mode = block.getFieldValue("MODE");
      if (mode !== spec.mode) return true;
    }

    if (spec.r !== undefined) {
      const r = Number(block.getFieldValue("R") || 0);
      if (r !== spec.r) return true;
    }

    if (spec.g !== undefined) {
      const g = Number(block.getFieldValue("G") || 0);
      if (g !== spec.g) return true;
    }

    if (spec.b !== undefined) {
      const b = Number(block.getFieldValue("B") || 0);
      if (b !== spec.b) return true;
    }

    return false;
  }

  if (spec.type === "brightness_contrast") {
    if (spec.b !== undefined) {
      const b = Number(block.getFieldValue("B") || 0);
      if (b !== spec.b) return true;
    }

    if (spec.c !== undefined) {
      const c = Number(block.getFieldValue("C") || 0);
      if (c !== spec.c) return true;
    }

    return false;
  }

  if (spec.type === "blur_sharpen") {
    if (spec.blur !== undefined) {
      const blur = Number(block.getFieldValue("BLUR") || 0);
      if (blur !== spec.blur) return true;
    }

    if (spec.sharp !== undefined) {
      const sharp = Number(block.getFieldValue("SHARP") || 0);
      if (sharp !== spec.sharp) return true;
    }

    return false;
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
  const [aiAssistantText, setAiAssistantText] = useState<string>(
    "LLM assistant is waiting for your Stage 1 edits..."
  );
  const [aiAssistantLoading, setAiAssistantLoading] = useState(false);
  const [agentHistory, setAgentHistory] = useState<ChatEntry[]>([]);
  const [agentHistoryOpen, setAgentHistoryOpen] = useState(false);
  // Module 2 chat UI state
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

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
  const m2AgentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const m2AgentTokenRef = useRef(0);
  const m2AgentSigRef = useRef("");

  const assistantHistoryKey = `vb_module2_stage${String(stageId)}_history`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(assistantHistoryKey);
      setAgentHistory(raw ? JSON.parse(raw) : []);
    } catch {
      setAgentHistory([]);
    }
  }, [assistantHistoryKey]);

  function persistAssistantHistory(text: string) {
    const trimmed = text.trim();
    if (!trimmed || trimmed === "Thinking...") return;
    if (trimmed.startsWith("LLM assistant is waiting")) return;
    appendChatEntry({ ts: Date.now(), role: "assistant", text: trimmed, source: "hint" });
  }

  function appendChatEntry(entry: ChatEntry) {
    setAgentHistory((prev) => {
      const next = [...prev, entry].slice(-200);
      try {
        window.localStorage.setItem(assistantHistoryKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  // Initialize chat history from localStorage
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(assistantHistoryKey);
      if (!raw) {
        setAgentHistory([]);
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setAgentHistory([]);
        return;
      }

      const normalized = parsed
        .map((item: any) => {
          if (!item || typeof item !== "object") return null;
          const text = String(item.text ?? item.content ?? "").trim();
          if (!text) return null;
          return {
            ts: Number(item.ts) || Date.now(),
            role: item.role === "user" ? "user" : "assistant",
            text,
            source: item.source === "chat" ? "chat" : "hint",
          } satisfies ChatEntry;
        })
        .filter(Boolean) as ChatEntry[];

      setAgentHistory(normalized);
    } catch {
      setAgentHistory([]);
    }
  }, [assistantHistoryKey]);

  useEffect(() => {
    if (!chatPanelOpen || !chatContainerRef.current) return;
    const timer = setTimeout(() => {
      try {
        chatContainerRef.current?.scrollTo({
          top: chatContainerRef.current.scrollHeight,
          behavior: "smooth",
        });
      } catch {}
    }, 0);
    return () => clearTimeout(timer);
  }, [chatPanelOpen, agentHistory]);

  // Send chat message to Module 2 backend
  async function sendChatMessage(text: string) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    const ws = workspaceRef.current;

    const chains = (ws && getTopChains(ws).map((chain) => ({
      top_block_type: chain[0]?.type || null,
      blocks: chain.map((b) => blockToAnalyzerModel(b)),
    }))) || [];

    const payload = {
      user_id: window.localStorage.getItem("vb_user_id") || "anon",
      message: trimmed,
      workspace_state: { chains },
      stage_id: String(stage?.id || "1"),
    };

    appendChatEntry({ ts: Date.now(), role: "user", text: trimmed, source: "chat" });
    setChatInput("");
    setChatSending(true);
    setAiAssistantText("Thinking...");
    setAiAssistantLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/module2/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || resp.statusText);
      }
      const data = await resp.json();
      const assistant = (data.assistant_response || "").toString();
      if (assistant) {
        // store assistant reply in persisted assistant history
        persistAssistantHistory(assistant);
        setAiAssistantText(assistant);
        setAiAssistantLoading(false);
      }
    } catch (e: any) {
      const msg = (e?.message || "Request failed").toString();
      const errorText = `Error: ${msg}`;
      setAiAssistantText(errorText);
      setAiAssistantLoading(false);
      appendChatEntry({ ts: Date.now(), role: "assistant", text: errorText, source: "chat" });
    } finally {
      setChatSending(false);
      setAiAssistantLoading(false);
      // scroll to bottom
      requestAnimationFrame(() => {
        try {
          chatContainerRef.current?.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: "smooth" });
        } catch {}
      });
    }
  }

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

  function requestStageAgentHintDebounced(ws: WorkspaceSvg) {
    if (!stage) return;
    const sid = String(stage.id);
    if (sid !== "1" && sid !== "2" && sid !== "3" && sid !== "4") return;

    if (m2AgentTimerRef.current) clearTimeout(m2AgentTimerRef.current);
    m2AgentTimerRef.current = setTimeout(async () => {
      const chains = getTopChains(ws).map((chain): AnalyzerChain => ({
        top_block_type: chain[0]?.type || null,
        blocks: chain.map((b) => blockToAnalyzerModel(b)),
      }));

      if (sid === "3") {
        const allBlocks = ws.getAllBlocks(false) as BlocklyBlock[];
        const loopBlock = allBlocks.find((b) => b.type === "m2.loop_dataset") || null;
        const loopInner = loopBlock?.getInputTargetBlock("DO") || null;
        if (loopInner) {
          const loopBodyBlocks: AnalyzerBlock[] = [];
          for (let b: BlocklyBlock | null = loopInner; b; b = b.getNextBlock()) {
            loopBodyBlocks.push(blockToAnalyzerModel(b));
          }
          chains.push({ top_block_type: "m2.loop_dataset.body", blocks: loopBodyBlocks });
        }
      }

      const payload: AnalyzeAgentReq = {
        chains,
        stage_id: sid,
        client_signature: `module2-stage${sid}-live`,
      };

      const sig = JSON.stringify(payload);
      if (sig === m2AgentSigRef.current) return;
      m2AgentSigRef.current = sig;
      const myToken = ++m2AgentTokenRef.current;

      try {
        setAiAssistantLoading(true);
        const resp = await fetchJSON<AnalyzeAgentResp>(`${API_BASE}/analyze/module2/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (myToken !== m2AgentTokenRef.current) return;
        const text = (resp.agent_text || "").trim();
        if (!text) return;
        setAiAssistantText(text);
        persistAssistantHistory(text);
      } catch (e: any) {
        if (myToken !== m2AgentTokenRef.current) return;
        const msg = (e?.message || "Request failed").toString();
        setAiAssistantText(`LLM error: ${msg}`);
        persistAssistantHistory(`LLM error: ${msg}`);
      } finally {
        if (myToken === m2AgentTokenRef.current) {
          setAiAssistantLoading(false);
        }
      }
    }, 800);
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
    m2AgentSigRef.current = "";
    setAiAssistantLoading(false);
    setAiAssistantText(
      String(stage.id) === "1"
        ? "LLM assistant is waiting for your Stage 1 edits..."
        : String(stage.id) === "2"
        ? "LLM assistant is waiting for your Stage 2 edits..."
        : String(stage.id) === "3"
        ? "LLM assistant is waiting for your Stage 3 edits..."
        : String(stage.id) === "4"
        ? "LLM assistant is waiting for your quiz attempt..."
        : ""
    );
      setAgentHistory([]);

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

      // Stage 2 starts with Stage 1 preprocessing chain already connected.
      // Student only needs to add resize + pad (with the correct 150x150 settings).
      if (String(stage.id) === "2" || String(stage.id) === "4") {
        const gray = ws.newBlock("m2.to_grayscale");
        gray.initSvg();
        gray.render();

        const bc = ws.newBlock("m2.brightness_contrast");
        bc.initSvg();
        bc.setFieldValue("10", "B");
        bc.setFieldValue("10", "C");
        bc.render();

        const bs = ws.newBlock("m2.blur_sharpen");
        bs.initSvg();
        bs.setFieldValue("0", "BLUR");
        bs.setFieldValue("1", "SHARP");
        bs.render();

        const sampleNext = (smp as any).nextConnection;
        if (sampleNext && gray.previousConnection) {
          sampleNext.connect(gray.previousConnection);
        }
        if (gray.nextConnection && bc.previousConnection) {
          gray.nextConnection.connect(bc.previousConnection);
        }
        if (bc.nextConnection && bs.previousConnection) {
          bc.nextConnection.connect(bs.previousConnection);
        }

        if (String(stage.id) === "4") {
          const resize = ws.newBlock("m2.resize");
          resize.initSvg();
          resize.setFieldValue("size", "MODE");
          resize.setFieldValue("150", "W");
          resize.setFieldValue("256", "H");
          resize.setFieldValue("TRUE", "KEEP");
          resize.render();

          const pad = ws.newBlock("m2.pad");
          pad.initSvg();
          pad.setFieldValue("150", "W");
          pad.setFieldValue("150", "H");
          pad.setFieldValue("constant", "MODE");
          pad.setFieldValue("0", "R");
          pad.setFieldValue("0", "G");
          pad.setFieldValue("0", "B");
          pad.render();

          if (bs.nextConnection && resize.previousConnection) {
            bs.nextConnection.connect(resize.previousConnection);
          }
          if (resize.nextConnection && pad.previousConnection) {
            resize.nextConnection.connect(pad.previousConnection);
          }
        }
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
        requestStageAgentHintDebounced(wsNow);
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
      if (m2AgentTimerRef.current) clearTimeout(m2AgentTimerRef.current);
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
      if (expected.length > 0 && String(s.id) !== "1") {
        let pos = -1;
        for (const t of expected) {
          const i = connectedOrder.indexOf(t);
          const ok = i !== -1 && i > pos;
          orderOK.set(t, ok);
          if (ok) pos = i;
        }
      } else if (String(s.id) === "1") {
        expected.forEach((t) => orderOK.set(t, true));
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

    // Stage 1: gently warn about very strong edits
    if (stageKey === "1") {
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

    // Stage 2: resize + pad present but not exactly 150×150 (pipeline)
    if (stageKey === "2") {
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

    // Stage 3: resize + pad in loop body but not exactly 150×150
    if (stageKey === "3") {
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

    // Friendly label for a block type (used in Baymax hints)
  function labelForType(type: string): string {
    if (type === "dataset.select") return "use dataset";
    if (type === "dataset.sample_image") return "get sample image";
    return type.replace("m2.", "").replaceAll("_", " ");
  }

  /**
   * For pipeline stages: walk the user's chain top-to-bottom and compare it
   * with the stage's expectedOrder / requiredBlocks.
   *
   * Returns a sentence like:
   *   “After X, I was expecting Y, but I see Z instead.”
   *
   * Used for the “the next step should be THIS block, not THAT block”
  * behaviour (including normalize in Stage 2).
   */
  function pipelineNextStepHint(
    s: StageConfig,
    _items: StageChecklistItem[]
  ): string | null {
    if (s.type !== "pipeline") return null;

    const ws = workspaceRef.current;
    if (!ws) return null;

    const top = findFirstPipelineTop(ws);
    if (!top) return null;

    const chainTypes = walkConnectedChainFrom(top);

    // What the stage *wants*, in order
    const rawExpected =
      (s.expectedOrder && s.expectedOrder.length
        ? s.expectedOrder
        : s.requiredBlocks || []) || [];

    // Only look at the m2.* preprocessing blocks
    const expected = rawExpected.filter((t) => t.startsWith("m2."));
    if (!expected.length) return null;

    const pipelineTypes = chainTypes.filter((t) => t.startsWith("m2."));
    if (!pipelineTypes.length) return null;

    const maxLen = Math.max(expected.length, pipelineTypes.length);

    for (let i = 0; i < maxLen; i++) {
      const expType = expected[i];
      const actType = pipelineTypes[i];

      if (!expType) break; // nothing more expected

      const prevType = i === 0 ? null : expected[i - 1];

      // No block in this slot yet → "you’re missing Y after X"
      if (!actType) {
        const prevLabel = prevType
          ? `"${labelForType(prevType)}"`
          : "the sample image";
        const expLabel = `"${labelForType(expType)}"`;
        return `I’m reading your blocks from top to bottom. Right after ${prevLabel}, I was expecting ${expLabel}, but there’s no block there yet. Try adding ${expLabel} in that spot.`;
      }

      // Wrong block in this slot → "this should be Y, not Z"
      if (actType !== expType) {
        const prevLabel = prevType
          ? `"${labelForType(prevType)}"`
          : "the sample image";
        const expLabel = `"${labelForType(expType)}"`;
        const actLabel = `"${labelForType(actType)}"`;
        return `Checking top to bottom: after ${prevLabel} I expected ${expLabel}, but I see ${actLabel} instead. Try moving ${expLabel} into this spot and sliding ${actLabel} further down.`;
      }
    }

    // Order matches our simple check, nothing specific to say
    return null;
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

  // Nothing to inspect yet
  if (items.length === 0) {
    const lines = [
      "Drag your preprocessing blocks into a single chain under the sample image. Each stage builds on the previous one.",
      "Start by choosing a dataset, grabbing a sample image block, then stack the preprocessing steps straight underneath.",
      "Think of this like plumbing: connect the dataset tap, attach the sample image, then route the flow through the blocks this stage cares about.",
    ];
    setBaymaxState(pickLine(lines, stageKey + "-empty"), "neutral", false);
    return;
  }

  /* ---------- Wrong-place blocks ---------- */
  if (wrong.length > 0) {
    // For pipeline stages 1–4, we want the top-to-bottom
    // "after this block should be THAT block" style hints.
    if (s.type === "pipeline" && ["1", "2"].includes(stageKey)) {
      // Special param hints first: 150×150 and normalize-mode
      if (
        stageKey === "2" &&
        missing.length === 0 &&
        hints.resizePadAlmost150
      ) {
        const lines = [
          "You’ve found the right blocks for this stage, and resize/pad are in place. Now fine-tune both to exactly 150 × 150, then check normalize mode is set to 0–1.",
          "Almost perfect framing. Set resize and pad to 150 by 150, then switch normalize to 0–1 so the output fully matches the stage goal.",
          "The structure is correct. Final tuning: resize and pad should both be 150 × 150, and normalize should use 0–1.",
        ];
        setBaymaxState(
          pickLine(lines, stageKey + "-wrong-params-150"),
          "warning",
          true
        );
        return;
      }

      if (stageKey === "2" && missing.length === 0 && hints.normalizeModeNot01) {
        const lines = [
          "Nice, you’ve wired in normalize, that’s exactly what this stage needs. For this mission, switch the mode to 0–1.",
          "You’re using a normalization block, which is perfect. To complete Stage 2, change its mode to 0–1 so pixel values land between 0 and 1.",
          "Normalization is in the right place, but its mode doesn’t match this stage. Pick the 0–1 mode.",
        ];
        setBaymaxState(
          pickLine(lines, stageKey + "-wrong-normalize-mode"),
          "warning",
          true
        );
        return;
      }

      // Now do the "after this block, that block should be here" logic.
      const seqLine = pipelineNextStepHint(s, items);
      if (seqLine) {
        setBaymaxState(seqLine, "warning", true);
        return;
      }
      // If we somehow can't compute a sequence hint, fall through
      // to the generic wrong-place messages below.
    }

    // Stage 3 – loop body has resize/pad but not 150×150
    if (
      s.type === "loop_export" &&
      stageKey === "3" &&
      missing.length === 0 &&
      hints.resizePadAlmost150
    ) {
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

    // Loop/export stage (Stage 3) or generic fallback
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

  /* ---------- Missing blocks ---------- */
  if (missing.length > 0) {
    if (s.type === "loop_export") {
      // Stage 3 / loop-export style hints
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
          "Loop is in the right place, now you need an export step after the loop to produce a new dataset.",
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
            "Your loop is running, but not all the core steps are inside it yet. Treat the loop body like a tiny version of your Stage 1–2 pipeline.",
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
        "This stage starts by stripping away color, then tidying the image. Make sure you have a grayscale step plus brightness/contrast and blur/sharpen cleanup blocks in your chain.",
        "We’re teaching the model to ignore color and reduce noise. Add grayscale, then include a brightness/contrast tweak and a blur/sharpen step.",
        "Somewhere after the sample image we’re expecting grayscale and two cleanup blocks (light levels + blur/sharpen). Add those in to complete this mission.",
      ];
      setBaymaxState(
        pickLine(lines, stageKey + "-missing-" + missing.length),
        "hint",
        true
      );
    } else if (stageKey === "2") {
      const lines = [
        "We’re aiming for a complete model-ready chain: resize and pad should both be 150 × 150, then normalize should be set to 0–1.",
        "This mission is about framing and value scaling together. Check resize/pad at 150×150 and add normalize in 0–1 mode.",
        "Your chain should include 150×150 resize, 150×150 pad, and a normalize step in 0–1. If any part is missing or off, the target won’t match.",
      ];
      setBaymaxState(
        pickLine(lines, stageKey + "-missing-" + missing.length),
        "hint",
        true
      );
    } else if (stageKey === "4") {
      const lines = [
        "This is a quiz stage, so the chain is already there except for one missing block. Look for normalize at the end.",
        "You’ve already got the Stage 1 and Stage 2 blocks. Now add the missing normalize block to finish the chain.",
        "The clue is at the end of the pipeline: resize, then pad, then normalize. One of those steps is still missing.",
      ];
      setBaymaxState(
        pickLine(lines, stageKey + "-missing-" + missing.length),
        "hint",
        true
      );
    } else if (stageKey === "3") {
      const lines = [
        "This mission is about automation: run your full recipe over many images, then save them out. Your loop body should look like a mini version of the Stage 1–2 pipeline, and there should be a save step after the loop.",
        "We’re almost in production mode. Make sure your loop actually applies the full recipe, and that the export block is ready to write out the new dataset.",
        "Stage 3 expects: dataset → loop over images → full preprocessing inside the loop → one export block at the end. Something in that chain is still missing.",
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

  /* ---------- All checklist items structurally OK ---------- */
  if (done === items.length && items.length > 0) {
    // Stage 1: gentle nudge about extreme values
    if (stageKey === "1" && (hints.extremeBC || hints.extremeBlurSharp)) {
      const lines = [
        "Your Stage 1 pipeline is structurally correct, but those brightness/contrast or blur/sharpen values are pretty strong. For preprocessing we usually prefer gentle nudges. Try smaller numbers so the images don’t look over-edited.",
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

    if (stageKey === "4") {
      const lines = [
        "Quiz complete: you found the missing normalize block and finished the preprocessing chain.",
        "Nice work. The missing block is in place, so the full Stage 1 + Stage 2 chain is now complete.",
        "That’s the right answer. Your pipeline now includes the final normalize step where it belongs.",
      ];
      setBaymaxState(pickLine(lines, stageKey + "-done-quiz"), "success", false);
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
    } else if (stageKey === "2") {
      const lines = [
        "Perfect: your Stage 2 chain now frames images to 150 × 150 and normalizes to 0–1.",
        "Great work. Resize and pad are aligned at 150×150, and normalize is set for stable model input.",
        "Stage 2 complete: framing and normalization are both correct, so your data is model-ready.",
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

  /* ---------- Fallback “nearly there” ---------- */
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
      const stageKey = String(stage.id);
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
              "• Some preprocessing steps are missing, out of order, or have settings that don’t match this stage’s goal. Compare your output to the target image and follow Baymax’s hints. For Stage 2, resize and pad should be 150×150 and normalize should use 0–1 mode."
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

      if (ok) {
        setSubmitSuccess(true);

        if (stage.type === "loop_export") {
          setSubmitTitle("Stage Complete - Pipeline on repeat!");
          setSubmitLines([
            "✓ You wrapped the preprocessing steps inside a loop and exported a new dataset. This is exactly how real ML pipelines get their data ready.",
          ]);
        } else if (stageKey === "1") {
          setSubmitTitle("Stage 1 Complete - Preprocessing chain ready");
          setSubmitLines(["✓ Your grayscale and cleanup pipeline is in place."]);
        } else if (stageKey === "2") {
          setSubmitTitle("Stage 2 Complete - Frame + Normalize locked in");
          setSubmitLines([
            "✓ Your pipeline now shapes images into a consistent 150×150 frame and normalizes values to 0–1.",
          ]);
        } else if (stageKey === "4") {
          setSubmitTitle("Quiz Complete - Missing block found");
          setSubmitLines([
            "✓ You identified the missing normalize block and completed the preprocessing chain.",
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
        } else if (stageKey === "2") {
          failLine =
            "You’re not far off. Set resize and pad to 150 × 150, then make sure normalize is in 0–1 mode to match this merged stage.";
        } else if (stageKey === "4") {
          failLine =
            "You’re close. This quiz only needs the missing normalize block added after pad to finish the chain.";
        } else if (stageKey === "1") {
          failLine =
            "You’re close. Make sure the Stage 1 preprocessing chain is complete and in a sensible order before submitting.";
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

  const chatSignal = !chatPanelOpen
    ? aiAssistantLoading
      ? "thinking"
      : aiAssistantText
      ? "ready"
      : "idle"
    : "open";

  const getMood = () => {
    if (aiAssistantLoading) return "thinking";
    if (!aiAssistantText) return "idle";
    const lower = aiAssistantText.toLowerCase();
    if (lower.includes("error") || lower.includes("failed")) return "error";
    if (lower.includes("warning") || lower.includes("wrong") || lower.includes("incorrect")) return "warning";
    if (lower.includes("great") || lower.includes("excellent") || lower.includes("perfect") || lower.includes("mission")) return "success";
    return "hint";
  };

  if (!stage) return <div className="p-6 text-red-600">Stage not found.</div>;

  return (
    <div className="h-[100dvh] w-full bg-[#E3E7F5] overflow-hidden">
      {/* Top nav – styled like Module 1’s, but for Module 2 */}
      <header className="fixed top-0 left-0 right-0 z-20 backdrop-blur-xl bg-white/70 border-b border-white/60 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-4 lg:px-5 h-14 flex items-center justify-between">
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
      <div className="pt-16 h-full">
        <div
          className="max-w-[1400px] mx-auto px-3 lg:px-4 h-[calc(100dvh-4rem)] grid gap-3 lg:gap-4 grid-cols-1 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1.15fr)]"
        >
          {/* LEFT: Blockly workspace */}
          <div className="h-full min-h-0 rounded-3xl bg-white shadow-[0_22px_60px_rgba(15,23,42,0.25)] border border-white/70 overflow-hidden">
            <div ref={blocklyDivRef} className="w-full h-full min-h-0" />
          </div>

          {/* RIGHT: Baymax + target + output */}
          <div className="h-full min-h-0 rounded-3xl border border-white/80 bg-gradient-to-b from-white/90 to-[#E0E5F4] shadow-[0_18px_45px_rgba(15,23,42,0.22)] flex flex-col overflow-hidden">
            <div className="flex flex-col min-h-0 px-3 lg:px-4 py-3 gap-3 overflow-y-auto">
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

              {(String(stage.id) === "1" || String(stage.id) === "2" || String(stage.id) === "3" || String(stage.id) === "4") && (
                <div className="shrink-0 flex flex-col items-center justify-center">
                  {/* Floating chat FAB + drawer (Module 2) */}
                  <div className="fixed bottom-6 right-6 z-[970] flex flex-col items-end gap-3">
                    {chatPanelOpen && (
                      <div className="w-[380px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-3xl border border-sky-100 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
                        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 bg-gradient-to-r from-sky-50 to-blue-50">
                          <div className="flex items-center gap-2">
                            <svg
                              viewBox="0 0 100 100"
                              className="h-6 w-6 drop-shadow-[0_0_4px_rgba(56,189,248,0.3)]"
                              xmlns="http://www.w3.org/2000/svg"
                              aria-hidden="true"
                            >
                              <defs>
                                <radialGradient id="m2ChatAvatar" cx="50%" cy="40%" r="70%">
                                  <stop offset="0%" stopColor="#ecfeff" />
                                  <stop offset="100%" stopColor="#7dd3fc" />
                                </radialGradient>
                              </defs>
                              <circle cx="50" cy="50" r="30" fill="url(#m2ChatAvatar)" />
                              <circle cx="32" cy="28" r="3" fill="#38bdf8" opacity="0.7" />
                              <circle cx="70" cy="30" r="2.5" fill="#0ea5e9" opacity="0.55" />
                              <circle cx="41" cy="44" r="5" fill="white" stroke="#bae6fd" strokeWidth="0.6" />
                              <circle cx="59" cy="44" r="5" fill="white" stroke="#bae6fd" strokeWidth="0.6" />
                              <circle cx="42" cy="46" r="2.2" fill="#0ea5e9" />
                              <circle cx="58" cy="46" r="2.2" fill="#0ea5e9" />
                              <path d="M 40 62 Q 50 66 60 62" stroke="#0ea5e9" strokeWidth="2" fill="none" strokeLinecap="round" />
                            </svg>
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">NeuraBuddy</div>
                              <div className="text-[10px] text-sky-500 font-medium">Module 2 chat assistant</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              className="rounded-full px-3 py-1 text-[11px] font-semibold text-sky-700 hover:bg-white hover:text-sky-800 transition"
                              onClick={() => setAgentHistoryOpen(true)}
                            >
                              History
                            </button>
                            <button
                              className="rounded-full p-2 text-slate-500 hover:bg-white hover:text-slate-700 transition"
                              onClick={() => setChatPanelOpen(false)}
                              aria-label="Close chat"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        <div ref={chatContainerRef} className="max-h-[42vh] space-y-2 overflow-auto px-4 py-3">
                          {agentHistory.length === 0 && (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                              No conversation yet. Ask a question to start the assistant chat.
                            </div>
                          )}
                          {agentHistory.map((entry, idx) => {
                            const isUser = entry.role === "user";
                            return (
                              <div key={`${entry.ts}-${idx}`} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                                <div
                                  className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap shadow-sm ${
                                    isUser
                                      ? "bg-sky-500 text-white"
                                      : entry.source === "hint"
                                      ? "bg-sky-50 text-sky-900 border border-sky-200"
                                      : "bg-slate-100 text-slate-800 border border-slate-200"
                                  }`}
                                >
                                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">
                                    {isUser ? "You" : "NeuraBuddy"}
                                  </div>
                                  {entry.text}
                                </div>
                              </div>
                            );
                          })}
                          {chatSending && (
                            <div className="flex justify-start">
                              <div className="rounded-2xl bg-slate-100 border border-slate-200 px-3 py-2 shadow-sm">
                                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70 text-slate-600">
                                  NeuraBuddy
                                </div>
                                <div className="flex items-center gap-1.5 py-1">
                                  <span className="h-2 w-2 rounded-full bg-slate-400 animate-[vb-think-dot_1s_ease-in-out_infinite]" />
                                  <span className="h-2 w-2 rounded-full bg-slate-400 animate-[vb-think-dot_1s_ease-in-out_infinite_0.15s]" />
                                  <span className="h-2 w-2 rounded-full bg-slate-400 animate-[vb-think-dot_1s_ease-in-out_infinite_0.3s]" />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="border-t border-slate-100 bg-slate-50 p-3">
                          <textarea
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void sendChatMessage(chatInput);
                              }
                            }}
                            rows={3}
                            placeholder='Ask things like “Explain more” or “Why is this wrong?”'
                            className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-200"
                          />
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-500">Shift+Enter for a new line.</span>
                            <button
                              className={`rounded-full px-4 py-1.5 text-xs font-semibold text-white transition ${
                                chatSending || !chatInput.trim()
                                  ? "bg-slate-400 cursor-not-allowed"
                                  : "bg-sky-500 hover:bg-sky-400"
                              }`}
                              disabled={chatSending || !chatInput.trim()}
                              onClick={() => void sendChatMessage(chatInput)}
                            >
                              {chatSending ? "Sending…" : "Send"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    <button
                      className={`relative flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-[0_18px_35px_rgba(14,165,233,0.35)] ring-2 transition hover:scale-105 ${
                        chatSignal === "thinking"
                          ? "ring-amber-400"
                          : chatSignal === "ready"
                          ? "ring-emerald-400"
                          : "ring-sky-300"
                      }`}
                      onClick={() => setChatPanelOpen((open) => !open)}
                      aria-label={chatPanelOpen ? "Close assistant chat" : "Open assistant chat"}
                      title={chatPanelOpen ? "Close chat" : "Open chat"}
                    >
                      <span className="sr-only">Assistant character</span>
                      {!chatPanelOpen && chatSignal !== "open" && (
                        <span className="absolute -inset-4 rounded-full border border-dashed border-sky-200/70 opacity-60" />
                      )}
                      {!chatPanelOpen && chatSignal === "thinking" && (
                        <span className="absolute -top-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/90 px-2 py-1 shadow-[0_8px_20px_rgba(251,191,36,0.18)] ring-1 ring-amber-200/80">
                          <span className="h-2 w-2 rounded-full bg-amber-400 animate-[vb-think-dot_1s_ease-in-out_infinite]" />
                          <span className="h-2 w-2 rounded-full bg-amber-400 animate-[vb-think-dot_1s_ease-in-out_infinite_0.18s]" />
                          <span className="h-2 w-2 rounded-full bg-amber-400 animate-[vb-think-dot_1s_ease-in-out_infinite_0.36s]" />
                        </span>
                      )}
                      {!chatPanelOpen && chatSignal === "ready" && (
                        <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(236,253,245,0.95)] ring-2 ring-white animate-[vb-ready-badge_1.2s_ease-in-out_infinite]">
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        </span>
                      )}
                      {chatPanelOpen && (
                        <span className="absolute -bottom-1.5 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.8)]" />
                      )}
                      <svg
                        viewBox="0 0 100 100"
                        className="h-12 w-12 drop-shadow-[0_0_10px_rgba(56,189,248,0.35)]"
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true"
                      >
                        <defs>
                          <radialGradient id="launcherBody" cx="50%" cy="40%" r="70%">
                            <stop offset="0%" stopColor="#ecfeff" />
                            <stop offset="100%" stopColor="#7dd3fc" />
                          </radialGradient>
                        </defs>
                        <circle cx="50" cy="50" r="30" fill="url(#launcherBody)" />
                        <circle cx="32" cy="28" r="3" fill="#38bdf8" opacity="0.7" />
                        <circle cx="70" cy="30" r="2.5" fill="#0ea5e9" opacity="0.55" />
                        <circle cx="74" cy="52" r="2" fill="#38bdf8" opacity="0.45" />
                        <circle cx="30" cy="72" r="2.5" fill="#0ea5e9" opacity="0.55" />
                        <circle cx="41" cy="44" r="5" fill="white" stroke="#bae6fd" strokeWidth="0.6" />
                        <circle cx="59" cy="44" r="5" fill="white" stroke="#bae6fd" strokeWidth="0.6" />
                        <circle cx="42" cy="46" r="2.2" fill="#0ea5e9" />
                        <circle cx="58" cy="46" r="2.2" fill="#0ea5e9" />
                        <path d="M 40 62 Q 50 66 60 62" stroke="#0ea5e9" strokeWidth="2" fill="none" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {/* Target vs current (pipeline stages only) */}
              {stage.type === "pipeline" && (
                <TargetPanel
                  targetSrc={targetSrc}
                  currentSrc={currentSrc}
                  dark={false}
                />
              )}

              {/* Output panel */}
              <div className="flex-1 min-h-[220px]">
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

        {agentHistoryOpen && (
          <div className="fixed inset-0 z-[980] flex items-center justify-center bg-black/40">
            <div className="max-w-2xl w-[92%] max-h-[80vh] overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold">AI Assistant chat</h3>
                <div className="flex items-center gap-2">
                  <button
                    className="text-sm text-slate-600 hover:underline"
                    onClick={() => {
                      try {
                        window.localStorage.removeItem(assistantHistoryKey);
                      } catch {}
                      setAgentHistory([]);
                    }}
                  >
                    Clear
                  </button>
                  <button
                    className="px-3 py-1 rounded-full bg-sky-500 text-xs text-white"
                    onClick={() => setAgentHistoryOpen(false)}
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="overflow-auto h-[60vh] pr-2">
                {agentHistory.length === 0 && (
                  <div className="text-sm text-slate-500">No history yet.</div>
                )}
                {agentHistory.map((entry) => (
                  <div key={entry.ts} className="mb-3 border-b pb-2">
                    <div className="text-[11px] text-slate-400 mb-1">{new Date(entry.ts).toLocaleString()}</div>
                    <div className="whitespace-pre-wrap text-sm text-slate-800">{entry.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

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
