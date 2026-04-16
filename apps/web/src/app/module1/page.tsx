"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceSvg, Block as BlocklyBlock } from "blockly";
import { Blockly, setDatasetOptions } from "@/lib/blockly";
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

const API_BASE = "http://127.0.0.1:8000";
const AGENT_THROTTLE_MS = 1500;

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

type DatasetListItem = {
  key: string;
  name: string;
};

type DatasetListResponse = {
  items: DatasetListItem[];
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
function blockToModel(b: BlocklyBlock): { type: string; fields: Record<string, unknown> } {
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
function workspaceToAnalyzePayload(ws: WorkspaceSvg, clientSignature?: string) {
  const chains = getTopChains(ws).map((chain) => ({
    top_block_type: chain[0]?.type ?? null,
    blocks: chain.map(blockToModel),
  }));
  return clientSignature ? { chains, client_signature: clientSignature } : { chains };
}
const hasType = (chain: BlocklyBlock[], type: string) =>
  chain.some((b) => b.type === type);
const indexOfType = (chain: BlocklyBlock[], type: string) =>
  chain.findIndex((b) => b.type === type);
const isAfter = (chain: BlocklyBlock[], beforeType: string, targetType: string) => {
  const a = indexOfType(chain, beforeType);
  const b = indexOfType(chain, targetType);
  return a !== -1 && b !== -1 && b > a;
};

type BaymaxMood = "neutral" | "hint" | "warning" | "success" | "error";

type CardPos = { top: number; left: number } | null;

// Mission-critical block types (for glow + counter)
const REQUIRED_MISSION_KEYS = [
  "dataset.select",
  "dataset.info",
  "dataset.class_counts",
  "dataset.class_distribution_preview",
  "dataset.sample_image",
  "image.channels_split",
];

// Which blocks glow in the toolbox (same as required for stage)
const REQUIRED_TOOLBOX_BLOCK_TYPES = new Set<string>(REQUIRED_MISSION_KEYS);

// Friendly names for Baymax messages
const FRIENDLY_NAMES: Record<string, string> = {
  "dataset.select": "“use dataset”",
  "dataset.info": "“dataset info”",
  "dataset.class_counts": "“class counts”",
  "dataset.class_distribution_preview": "“class distribution preview”",
  "dataset.sample_image": "“get sample image”",
  "image.channels_split": "“split RGB channels”",
};

// Helper to randomise lines a bit
function pickOne(options: string[]): string {
  return options[Math.floor(Math.random() * options.length)];
}

export default function Module1Page() {
  const router = useRouter();

  const blocklyDivRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<WorkspaceSvg | null>(null);

  // For tutorial spotlight positioning
  const workspaceContainerRef = useRef<HTMLDivElement | null>(null);
  const baymaxPanelRef = useRef<HTMLDivElement | null>(null);
  const outputPanelRef = useRef<HTMLDivElement | null>(null);

  const [running, setRunning] = useState<boolean>(false);

  const [logs, setLogs] = useState<LogItem[]>([]);
  const [baymax, setBaymax] = useState<string>(
    "Right now I’m basically staring into the void. Start by hanging a “use dataset” block so we have something to look at."
  );
  const [baymaxMood, setBaymaxMood] = useState<BaymaxMood>("neutral");
  const [baymaxTyping, setBaymaxTyping] = useState<boolean>(false);

  // Baymax animation
  const [baymaxBump, setBaymaxBump] = useState(false);
  const lastBaymaxTextRef = useRef<string>(baymax);

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
  const clientSignatureRef = useRef<string>("");

  // Debounce
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef(0);
  const lastSigRef = useRef<string>("");
  const lastSampleSigRef = useRef<string>("");
  const lastAnalyzerSigRef = useRef<string>("");
  const analyzerTokenRef = useRef<number>(0);
  const lastAgentCallAtRef = useRef<number>(0);
  const pendingAgentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAgentPayloadRef = useRef<string | null>(null);

  const [checkItems, setCheckItems] = useState<StageChecklistItem[]>([]);
  const lastChecklistRef = useRef<StageChecklistItem[] | null>(null);

  /* ---------- Tutorial state ---------- */
  const [tutorialPromptOpen, setTutorialPromptOpen] = useState(true);
  const [tutorialActive, setTutorialActive] = useState(false);
  const [tutorialStep, setTutorialStep] = useState<number>(2);
  const [focusRect, setFocusRect] = useState<DOMRect | null>(null);
  const [cardPos, setCardPos] = useState<CardPos>(null);

  /* ---------- Load dataset options for "use dataset" block ---------- */
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
        // keep fallback "Recyclables (Mini)" option on error
      }
    }

    loadDatasets();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let id = window.localStorage.getItem("vb_client_signature");
    if (!id) {
      const rand =
        typeof window.crypto?.randomUUID === "function"
          ? window.crypto.randomUUID()
          : `vb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      id = rand;
      window.localStorage.setItem("vb_client_signature", id);
    }
    clientSignatureRef.current = id;
  }, []);

  /* ---------- Global CSS for glow + Baymax animation ---------- */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const existing = document.getElementById("vb-mission-glow-style");
    if (existing) return;

    const style = document.createElement("style");
    style.id = "vb-mission-glow-style";
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

  /* ---------- Helper: highlight needed blocks in the toolbox flyout ---------- */
  function updateToolboxGlow() {
    const wsAny = workspaceRef.current as any;
    if (!wsAny) return;

    const flyout =
      wsAny.getFlyout?.() ||
      wsAny.toolbox_?.flyout_ ||
      wsAny.toolbox_?.getFlyout?.();
    if (!flyout) return;

    const flyWs = flyout.getWorkspace?.();
    if (!flyWs) return;

    const topBlocks = flyWs.getTopBlocks(false) || [];
    topBlocks.forEach((b: any) => {
      const svgRoot = b.getSvgRoot?.();
      if (!svgRoot) return;

      if (REQUIRED_TOOLBOX_BLOCK_TYPES.has(b.type)) {
        svgRoot.classList.add("vb-mission-glow-block");
      } else {
        svgRoot.classList.remove("vb-mission-glow-block");
      }
    });
  }

  /* ---------- Helper: set Baymax with animation ---------- */
  function setBaymaxState(text: string, mood: BaymaxMood, typing: boolean) {
    setBaymax(text);
    setBaymaxMood(mood);
    setBaymaxTyping(typing);

    if (text !== lastBaymaxTextRef.current) {
      lastBaymaxTextRef.current = text;
      // Restart bump animation
      setBaymaxBump(false);
      requestAnimationFrame(() => {
        setBaymaxBump(true);
        setTimeout(() => setBaymaxBump(false), 500);
      });
    }
  }

  function setAgentCard(lines: string[]) {
    setLogs((prev) => {
      const filtered = prev.filter(
        (item) => !(item.kind === "card" && item.title === "Agent")
      );
      return [{ kind: "card", title: "Agent", lines }, ...filtered];
    });
  }

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

    // initial toolbox glow once flyout exists
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
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        instantFeedback();
      }, 100);

      // refresh toolbox glow after changes / category switches
      setTimeout(() => {
        updateToolboxGlow();
      }, 0);
    };
    ws.addChangeListener(onChange);

    setCheckItems(computeChecklist(ws));
    setTimeout(() => {
      instantFeedback();
    }, 0);

    return () => {
      window.removeEventListener("vb:blockInfo", onInfo as any);
      ws.removeChangeListener(onChange);
      ws.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocklyDivRef.current]);

  /* ---------- Tutorial helpers ---------- */

  function getDefaultRect(): DOMRect {
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    const width = Math.min(500, vw - 80);
    const height = 220;
    const left = (vw - width) / 2;
    const top = (vh - height) / 2;
    return new DOMRect(left, top, width, height);
  }

  function updateFocusRectForStep(step: number) {
    let target: HTMLElement | null = null;

    if (step === 2) {
      target = workspaceContainerRef.current;
    } else if (step === 3) {
      target = baymaxPanelRef.current;
    } else if (step === 4) {
      target = outputPanelRef.current;
    }

    if (target) {
      const rect = target.getBoundingClientRect();
      setFocusRect(rect);
    } else {
      setFocusRect(getDefaultRect());
    }
  }

  useEffect(() => {
    if (!tutorialActive) {
      setFocusRect(null);
      setCardPos(null);
      return;
    }

    updateFocusRectForStep(tutorialStep);

    const onResize = () => {
      updateFocusRectForStep(tutorialStep);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorialActive, tutorialStep]);

  // compute card position when focusRect changes
  useEffect(() => {
    if (!tutorialActive || !focusRect) {
      setCardPos(null);
      return;
    }

    const margin = 16;
    const cardWidth = 340;
    const cardHeight = 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = focusRect;

    let top = rect.top;
    let left = rect.right + margin;

    // 1. Try right side
    if (rect.right + margin + cardWidth < vw) {
      top = Math.min(rect.top, vh - cardHeight - margin);
      left = rect.right + margin;
    } else if (rect.left - margin - cardWidth > 0) {
      // 2. Try left side
      top = Math.min(rect.top, vh - cardHeight - margin);
      left = rect.left - cardWidth - margin;
    } else if (rect.bottom + margin + cardHeight < vh) {
      // 3. Try below
      top = rect.bottom + margin;
      left = Math.min(rect.left, vw - cardWidth - margin);
    } else {
      // 4. Above as fallback
      top = rect.top - cardHeight - margin;
      left = Math.min(rect.left, vw - cardWidth - margin);
    }

    if (top < margin) top = margin;
    if (left < margin) left = margin;

    setCardPos({ top, left });
  }, [tutorialActive, focusRect, tutorialStep]);

  function renderTutorialTitle(step: number): string {
    switch (step) {
      case 2:
        return "This is your building area";
      case 3:
        return "Meet Baymax 👋";
      case 4:
        return "See what your blocks do";
      default:
        return "Welcome to VisionBlocks";
    }
  }

  function renderTutorialBody(step: number): string {
    switch (step) {
      case 2:
        return "This area includes both the toolbox on the left and the main workspace. You'll drag blocks from the toolbox and snap them together in this space to build your computer-vision pipeline. Try to keep everything hanging from a single “use dataset” block so the robot knows what to work on.";
      case 3:
        return "Baymax watches what you build and gives hints if something’s missing or out of order. When you’re stuck, check this panel first.";
      case 4:
        return "The output panel shows dataset cards, charts, and image previews your blocks produce. It’s where you see the results of your chain.";
      default:
        return "We’ll take a super quick tour of the interface, then you’ll be ready to explore the mission.";
    }
  }

  function handleTutorialPrimary() {
    // Next or finish
    if (tutorialStep >= 4) {
      setTutorialActive(false);
      setFocusRect(null);
      setCardPos(null);
      return;
    }
    setTutorialStep((s) => Math.min(4, s + 1));
  }

  function handleTutorialSecondary() {
    // Back or skip
    if (tutorialStep <= 1) {
      setTutorialActive(false);
      setFocusRect(null);
      setCardPos(null);
      return;
    }
    setTutorialStep((s) => Math.max(1, s - 1));
  }

  /* ---------- Baymax helper driven by checklist ---------- */
  function updateBaymaxFromChecklist(args: {
    dsChain?: BlocklyBlock[];
    checkItems: StageChecklistItem[];
    sampleLoaded: boolean;
    prevCheckItems?: StageChecklistItem[];
  }) {
    const { dsChain, checkItems, sampleLoaded, prevCheckItems } = args;
    const done = checkItems.filter((i) => i.state === "ok").length;

    const missingKeys = checkItems
      .filter((i) => i.state === "missing")
      .map((i) => i.key);
    const wrongKeys = checkItems
      .filter((i) => i.state === "wrong_place")
      .map((i) => i.key);

    // In mission order, so we can talk about "next"
    const missionOrder = [
      "dataset.select",
      "dataset.info",
      "dataset.class_counts",
      "dataset.class_distribution_preview",
      "dataset.sample_image",
      "image.channels_split",
    ] as const;

    const firstMissing = missionOrder.find((k) => missingKeys.includes(k)) || null;

    // Build sets of OK states to detect newly-correct blocks
    const prevOk = new Set(
      (prevCheckItems || [])
        .filter((i) => i.state === "ok")
        .map((i) => i.key)
    );
    const nowOk = new Set(
      checkItems.filter((i) => i.state === "ok").map((i) => i.key)
    );

    const newlyOkOrdered = missionOrder.filter(
      (k) => nowOk.has(k) && !prevOk.has(k)
    );

    // No dataset at all
    if (!dsChain) {
      const line = pickOne([
        "I don’t see a “use dataset” block yet. Drop one in first so I know which folder of images we’re exploring.",
        "Step one: pick a dataset. Try dragging a “use dataset” block into the workspace to get us started.",
        "Right now I’m guessing in the dark. Add a “use dataset” block so we can plug into some real images.",
      ]);
      setBaymaxState(line, "hint", false);
      return;
    }

    // Some blocks exist but order is off
    if (wrongKeys.length > 0) {
      const wrongKey = wrongKeys[0];
      const wrongNice = FRIENDLY_NAMES[wrongKey] ?? "that block";
      const wrongIdx = missionOrder.indexOf(wrongKey as (typeof missionOrder)[number]);
      const prevKey = wrongIdx > 0 ? missionOrder[wrongIdx - 1] : null;
      const prevNice = prevKey ? FRIENDLY_NAMES[prevKey] ?? "the previous step" : null;

      if (prevNice) {
        const line = pickOne([
          `${wrongNice} needs to come after ${prevNice}. Try moving it below so the order makes sense.`,
          `I see ${wrongNice} before ${prevNice}. Swap them so the chain reads in order.`,
        ]);
        setBaymaxState(line, "warning", true);
        return;
      }

      const line = pickOne([
        "You’ve got some good blocks in there, but the order is a bit jumbled. Keep everything hanging in one straight chain under “use dataset”.",
        "Nice start! Try putting all the info and image blocks directly under the dataset block, top to bottom.",
        "Almost there straighten the chain: dataset at the top, then info, then counts, then distribution, then image stuff.",
      ]);
      setBaymaxState(line, "warning", true);
      return;
    }

    // ⚡ New: user added *some* mission block, but not the one that's next
    if (firstMissing && newlyOkOrdered.length > 0) {
      const justAdded = newlyOkOrdered[0];
      if (justAdded !== firstMissing) {
        const addedNice = FRIENDLY_NAMES[justAdded] ?? "that block";
        const wantNice = FRIENDLY_NAMES[firstMissing] ?? "the earlier step";

        // A couple of special cases to feel extra smart:
        if (
          justAdded === "dataset.sample_image" &&
          firstMissing === "dataset.class_counts"
        ) {
          setBaymaxState(
            pickOne([
              "Nice, you grabbed a sample image already! Before we admire it too much, let’s slot in a “class counts” block above so we know how many examples each label has.",
              "I like that you went straight to a picture. Now add “class counts” earlier in the chain so we understand the dataset before we stare at it.",
            ]),
            "hint",
            true
          );
          return;
        }

        if (
          justAdded === "dataset.sample_image" &&
          firstMissing === "dataset.class_distribution_preview"
        ) {
          setBaymaxState(
            pickOne([
              "Cool sample! One more thing before we rely on it: add a “class distribution preview” block earlier so we can see if any label is dominating.",
              "Jumping to an image is fun, but let’s drop in “class distribution preview” above it so we know how balanced things are.",
            ]),
            "hint",
            true
          );
          return;
        }

        if (
          justAdded === "image.channels_split" &&
          firstMissing === "dataset.sample_image"
        ) {
          setBaymaxState(
            pickOne([
              "You added “split RGB channels”, nice! Now we just need a “get sample image” block before it so there’s an actual picture to split.",
              "Great, you’re ready to split colors. Pop a “get sample image” block right before it so we have something to dissect.",
            ]),
            "hint",
            true
          );
          return;
        }

        // Generic “nice, but we still need X earlier”
        setBaymaxState(
          pickOne([
            `Nice, you added ${addedNice}. To finish this mission, we still need ${wantNice} earlier in the chain.`,
            `That block will help later! Now let’s try not to skip some steps, add ${wantNice} above it so the story makes sense.`,
          ]),
          "hint",
          true
        );
        return;
      }
    }

    // If something specific is next, talk about that
    if (firstMissing) {
      const nice = FRIENDLY_NAMES[firstMissing] ?? "the next block in the list";

      if (firstMissing === "dataset.info") {
        setBaymaxState(
          pickOne([
            "We know which dataset we’re using, but we’re not asking it any basic questions yet. Drop in a “dataset info” block next.",
            "Dataset chosen. Now add “dataset info” so we can see its name and the list of classes.",
          ]),
          "hint",
          true
        );
        return;
      }

      if (firstMissing === "dataset.class_counts") {
        setBaymaxState(
          pickOne([
            "Let’s see how many images we have for each label. A “class counts” block under the info block would be perfect now.",
            "Good, we know the dataset. Next up, try the “class counts” block so we can catch any super tiny classes early.",
          ]),
          "hint",
          true
        );
        return;
      }

      if (firstMissing === "dataset.class_distribution_preview") {
        setBaymaxState(
          pickOne([
            "We know the counts, but not the percentages yet. Add a “class distribution preview” block to spot any big imbalances.",
            "Counts are cool, but percentages help your brain. Try the “class distribution preview” block next.",
          ]),
          "hint",
          true
        );
        return;
      }

      if (firstMissing === "dataset.sample_image") {
        setBaymaxState(
          pickOne([
            "Right now we’re only talking *about* the dataset, not looking at any pictures. Add a “get sample image” block so we can see one.",
            "Let’s grab a concrete example. A “get sample image” block will pull one picture out of the dataset for us.",
          ]),
          "hint",
          true
        );
        return;
      }

      if (firstMissing === "image.channels_split") {
        if (sampleLoaded) {
          setBaymaxState(
            pickOne([
              "Nice, we’ve got a sample image! Drop in “split RGB channels” so we can peek at red, green, and blue separately.",
              "That sample looks good. Now try “split RGB channels” to see what each color channel is contributing.",
            ]),
            "hint",
            true
          );
        } else {
          setBaymaxState(
            pickOne([
              "We’ll want “split RGB channels” after we pull a sample. Make sure you’ve got a “get sample image” block running first.",
              "Once you’ve grabbed a sample image, add “split RGB channels” to really dissect it.",
            ]),
            "hint",
            true
          );
        }
        return;
      }

      // Generic fallback
      setBaymaxState(
        `We still haven’t added ${nice}. Try snapping it into the chain under the dataset block.`,
        "hint",
        true
      );
      return;
    }

    // All mission pieces present & in order
    if (done === checkItems.length && checkItems.length > 0) {
      const line = pickOne([
        "This chain is doing everything we need: info, counts, distribution, and image exploration. If it looks good, hit “Submit & Run”.",
        "Mission blocks all in place. You’re reading the dataset like a tiny researcher now.",
        "Nice! You’ve built a full dataset-inspection pipeline. When you’re ready, run it and see everything in the panel.",
      ]);
      setBaymaxState(line, "success", false);
      return;
    }

    // Default “almost there” vibe
    setBaymaxState(
      pickOne([
        "You’re pretty close. Keep everything stacked under the dataset block and think: info → counts → distribution → sample → RGB split.",
        "This is shaping up nicely. Check which mission blocks are still dim in the toolbox and drag them into your main chain.",
        "Keep going, use the glowing blocks in the toolbox as a checklist. Snap them in order under “use dataset”.",
      ]),
      "neutral",
      true
    );
  }

  /* ---------- Instant feedback (attached-chain only) ---------- */
  async function instantFeedback() {
    const ws = workspaceRef.current;
    if (!ws) return;

    const chains = getTopChains(ws);
    // Fire-and-forget analyzer call (no UI layout changes)
    try {
      const payload = workspaceToAnalyzePayload(ws, clientSignatureRef.current || undefined);
      const analyzerSig = JSON.stringify(payload);
      if (analyzerSig !== lastAnalyzerSigRef.current) {
        lastAnalyzerSigRef.current = analyzerSig;
        pendingAgentPayloadRef.current = analyzerSig;

        const fireAgentRequest = (payloadStr: string) => {
          const myAnalyzerToken = ++analyzerTokenRef.current;
          lastAgentCallAtRef.current = Date.now();
          setAgentCard(["Thinking…"]);

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 7000);

          fetch(`${API_BASE}/analyze/module1/agent`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payloadStr,
            signal: controller.signal,
          })
            .then(async (res) => {
              if (res.ok) return res.json();
              const text = await res.text().catch(() => "");
              return { __error: true, status: res.status, text } as const;
            })
            .then((data) => {
              if (myAnalyzerToken !== analyzerTokenRef.current) return;
              if ((data as any)?.__error) {
                const status = (data as any).status;
                if (status === 429) {
                  setAgentCard(["Rate limited. Try again in a moment."]);
                } else {
                  setAgentCard(["Agent error. Try again soon."]);
                }
                return;
              }
              const nextText = String(data?.agent_text || "").trim();
              if (!nextText) {
                setAgentCard(["Hint unavailable right now."]);
                return;
              }
              const lines = nextText
                .split(/\r?\n/)
                .map((ln) => ln.trim())
                .filter((ln) => ln.length > 0);
              setAgentCard(lines);
            })
            .catch(() => {
              if (myAnalyzerToken !== analyzerTokenRef.current) return;
              setAgentCard(["Hint unavailable right now."]);
            })
            .finally(() => clearTimeout(timeoutId));
        };

        const now = Date.now();
        const elapsed = now - lastAgentCallAtRef.current;
        if (elapsed >= AGENT_THROTTLE_MS && !pendingAgentTimerRef.current) {
          fireAgentRequest(analyzerSig);
        } else if (!pendingAgentTimerRef.current) {
          const wait = Math.max(AGENT_THROTTLE_MS - elapsed, 0);
          pendingAgentTimerRef.current = setTimeout(() => {
            pendingAgentTimerRef.current = null;
            const latest = pendingAgentPayloadRef.current;
            if (latest) {
              fireAgentRequest(latest);
            }
          }, wait);
        }
      }
    } catch {
      setAgentCard(["Hint unavailable right now."]);
      // ignore analyzer errors
    }

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
    const grayInChain = !!(
      dsChain && isAfter(dsChain, "dataset.select", "image.to_grayscale_preview")
    ); // still supported if present, but not required

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

    // signature ONLY depends on the chain attached to dataset.select
    const sig = JSON.stringify({
      ds: datasetKeyRef.current ?? null,
      infoInChain,
      countsInChain,
      distInChain,
      sampleInChain,
      sample: sampleConf || null,
      splitInChain,
      grayInChain,
    });

    // If nothing about the dataset chain changed, do NOT update Baymax.
    if (sig === lastSigRef.current) {
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

      // sample + previews
      let sampleLoaded = false;

      if (datasetKeyRef.current && sampleConf && sampleInChain) {
        const sampleSig = JSON.stringify({
          ds: datasetKeyRef.current,
          sampleConf,
        });

        if (sampleSig !== lastSampleSigRef.current || !sampleRef.current) {
          const url =
            sampleConf.mode === "index"
              ? `${API_BASE}/datasets/${encodeURIComponent(
                  datasetKeyRef.current
                )}/sample?mode=index&index=${sampleConf.index}`
              : `${API_BASE}/datasets/${encodeURIComponent(
                  datasetKeyRef.current
                )}/sample?mode=random`;

          sampleRef.current = await fetchJSON<SampleResponse>(url);
          lastSampleSigRef.current = sampleSig;
        }

        if (sampleRef.current) {
          sampleLoaded = true;

          // Always show the pinned sample image
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
      }

      if (myToken === tokenRef.current) setLogs(newLogs);

      const checklistNow = computeChecklist(ws);
      setCheckItems(checklistNow);
      const prevChecklist = lastChecklistRef.current || undefined;
      lastChecklistRef.current = checklistNow;

      updateBaymaxFromChecklist({
        dsChain,
        checkItems: checklistNow,
        sampleLoaded,
        prevCheckItems: prevChecklist,
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
      {
        key: "dataset.class_distribution_preview",
        label: "class distribution preview",
      },
      { key: "dataset.sample_image", label: "get sample image" },
      { key: "image.channels_split", label: "split RGB channels (preview)" },
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
            isAfter(dsChain, "dataset.select", it.key) ||
            it.key === "dataset.select";
          state = okOrder ? "ok" : "wrong_place";
        }
      }

      items.push({ key: it.key, label: it.label, state });
    }
    return items;
  }

  /* ---------- Mission counter (how many required blocks are used) ---------- */
  const missionProgress = useMemo(() => {
    const total = REQUIRED_MISSION_KEYS.length;
    let done = 0;
    for (const it of checkItems) {
      if (it.state === "ok" && REQUIRED_MISSION_KEYS.includes(it.key)) {
        done++;
      }
    }
    return { total, done };
  }, [checkItems]);

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
        setBaymaxState(
          "Nice work. You’ve basically taught me how to look at a dataset like a tiny researcher. When you’re ready, we can head to Module 2 and start preprocessing.",
          "success",
          false
        );
      } else {
        setBaymaxState(
          "Not bad at all, just a few pieces out of place. Keep everything under the dataset block and think: info → stats → sample → visuals.",
          "warning",
          false
        );
      }

      if (ok && !module2Unlocked) setModule2Unlocked(true);
    } finally {
      setRunning(false);
    }
  }

  /* ---------- UI ---------- */

  return (
    <div className="h-screen w-screen bg-[#E3E7F5] relative">
      {/* Top nav (matches home style) */}
      <header className="fixed top-0 left-0 right-0 z-20 backdrop-blur-xl bg-white/70 border-b border-white/60 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold text-slate-900">
              VisionBlocks
            </span>
            <span className="text-xs text-slate-500">
              Module 1 · Learn to See
            </span>
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
          <div
            ref={workspaceContainerRef}
            className="h-full min-h-0 rounded-3xl bg-white shadow-[0_22px_60px_rgba(15,23,42,0.25)] border border-white/70 overflow-hidden"
          >
            <div ref={blocklyDivRef} className="w-full h-full min-h-0" />
          </div>

          {/* RIGHT: Baymax + Output (scrollable) */}
          <div className="h-full min-h-0 rounded-3xl border border-white/80 bg-gradient-to-b from-white/90 to-[#E0E5F4] shadow-[0_18px_45px_rgba(15,23,42,0.22)] flex flex-col">
            <div className="flex flex-col min-h-0 px-4 py-4 gap-4">
              {/* Baymax panel wrapper (for tutorial focus) + mission counter */}
              <div
                ref={baymaxPanelRef}
                className={`shrink-0 transition-transform ${
                  baymaxBump ? "vb-baymax-bump" : ""
                }`}
              >
                <div className="flex items-center justify-end mb-2">
                  <div
                    className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border shadow-sm transition-colors ${
                      missionProgress.done >= missionProgress.total
                        ? "bg-emerald-100 border-emerald-400 text-emerald-700"
                        : "bg-amber-50 border-amber-300 text-amber-700"
                    }`}
                  >
                    <span>Mission blocks:</span>
                    <span>
                      {missionProgress.done} / {missionProgress.total}
                    </span>
                  </div>
                </div>

                <BaymaxPanel
                  line={baymax}
                  mood={baymaxMood}
                  typing={baymaxTyping}
                  dark={false}
                />
              </div>

              {/* Output takes rest */}
              <div ref={outputPanelRef} className="flex-1 min-h-0">
                <OutputPanel
                  logs={logs}
                  onClear={() => setLogs([])}
                  dark={false}
                />
              </div>

              {/* Hidden checklist – still used, not shown */}
              <div className="hidden">
                <MissionChecklistStage items={checkItems} dark={false} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tutorial spotlight overlay */}
      {tutorialActive && focusRect && (
        <div className="fixed inset-0 z-[900] pointer-events-none">
          {/* Four blurred/dim regions around the focus rect */}
          {/* Top */}
          <div
            className="absolute left-0 right-0 bg-slate-900/55 backdrop-blur-[3px] pointer-events-auto"
            style={{ top: 0, height: Math.max(0, focusRect.top) }}
          />
          {/* Bottom */}
          <div
            className="absolute left-0 right-0 bg-slate-900/55 backdrop-blur-[3px] pointer-events-auto"
            style={{ top: focusRect.bottom, bottom: 0 }}
          />
          {/* Left */}
          <div
            className="absolute bg-slate-900/55 backdrop-blur-[3px] pointer-events-auto"
            style={{
              top: focusRect.top,
              height: focusRect.height,
              left: 0,
              width: Math.max(0, focusRect.left),
            }}
          />
          {/* Right */}
          <div
            className="absolute bg-slate-900/55 backdrop-blur-[3px] pointer-events-auto"
            style={{
              top: focusRect.top,
              height: focusRect.height,
              left: focusRect.right,
              right: 0,
            }}
          />

          {/* Highlight border around focus area */}
          <div
            className="absolute rounded-2xl pointer-events-none"
            style={{
              top: Math.max(0, focusRect.top - 6),
              left: Math.max(0, focusRect.left - 6),
              width: focusRect.width + 12,
              height: focusRect.height + 12,
              boxShadow:
                "0 0 0 2px rgba(251,191,36,0.9), 0 0 30px rgba(251,191,36,0.85)",
            }}
          />

          {/* Tutorial card positioned next to focus */}
          {cardPos && (
            <div
              className="absolute z-[1000] pointer-events-auto"
              style={{ top: cardPos.top, left: cardPos.left }}
            >
              <div className="max-w-[340px] w-[340px] rounded-2xl bg-white shadow-2xl border border-slate-200 p-5">
                <h2 className="text-lg font-semibold text-slate-900 mb-2">
                  {renderTutorialTitle(tutorialStep)}
                </h2>
                <p className="text-sm text-slate-600 mb-4">
                  {renderTutorialBody(tutorialStep)}
                </p>

                <div className="flex items-center justify-between gap-3 mt-2">
                  <button
                    onClick={handleTutorialSecondary}
                    className="px-3 py-1.5 rounded-full border border-slate-300 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-400 transition"
                  >
                    {tutorialStep <= 1 ? "Skip tour" : "Back"}
                  </button>

                  <button
                    onClick={handleTutorialPrimary}
                    className="px-4 py-1.5 rounded-full bg-sky-500 text-xs font-semibold text-white shadow-sm hover:bg-sky-400 hover:shadow-[0_0_12px_rgba(56,189,248,0.7)] transition"
                  >
                    {tutorialStep >= 4 ? "Finish" : "Next"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tutorial opt-in prompt (centered) */}
      {tutorialPromptOpen && !tutorialActive && (
        <div className="fixed inset-0 z-[950] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="max-w-md w-full mx-4 rounded-2xl bg-white shadow-2xl border border-slate-200 p-6">
            <h2 className="text-xl font-semibold text-slate-900 mb-2">
              Welcome to VisionBlocks 👋
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              This is your first mission: learning how to “see” a dataset. Do you
              want a 30-second tour of the interface before you start?
            </p>

            <div className="flex items-center justify-end gap-3 mt-2">
              <button
                onClick={() => {
                  setTutorialPromptOpen(false);
                  setTutorialActive(false);
                }}
                className="px-3 py-1.5 rounded-full border border-slate-300 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-400 transition"
              >
                Skip for now
              </button>
              <button
                onClick={() => {
                  setTutorialPromptOpen(false);
                  setTutorialActive(true);
                  setTutorialStep(2);
                  // Force an initial focus rect in case the effect hasn't run yet
                  setTimeout(() => {
                    try {
                      updateFocusRectForStep(2);
                    } catch {
                      // ignore
                    }
                  }, 0);
                }}
                className="px-4 py-1.5 rounded-full bg-sky-500 text-xs font-semibold text-white shadow-sm hover:bg-sky-400 hover:shadow-[0_0_12px_rgba(56,189,248,0.7)] transition"
              >
                Start quick tour
              </button>
            </div>
          </div>
        </div>
      )}

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
