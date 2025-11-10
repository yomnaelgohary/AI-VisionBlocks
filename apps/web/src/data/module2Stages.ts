// Stage configuration for Module 2 

export type OpSpec =
  | { type: "to_grayscale" }
  | { type: "resize"; mode: "size" | "fit" | "scale"; w?: number; h?: number; keep?: "TRUE" | "FALSE"; maxside?: number; pct?: number }
  | { type: "pad"; w: number; h: number; mode: "constant" | "edge" | "reflect"; r?: number; g?: number; b?: number }
  | { type: "crop_center"; w: number; h: number }
  | { type: "brightness_contrast"; b: number; c: number }
  | { type: "blur_sharpen"; blur: number; sharp: number }
  | { type: "edges"; method: "canny" | "sobel" | "laplacian" | "prewitt"; threshold: number; overlay: boolean }
  | { type: "normalize"; mode: "zero_one" | "minus_one_one" | "zscore" };

export type StageType = "pipeline" | "dataset";

export type StageConfig = {
  id: number | "bonus";
  title: string;
  type: StageType;
  intro: string[];
  // Pipeline stages (1-6, bonus)
  requiredBlocks?: string[];          // list of block types the learner must use
  expectedOrder?: string[];           // exact order for pipeline stages (prefix from dataset.select -> sample -> ...)
  targetOps?: OpSpec[];               // canonical ops used to generate dynamic target
  tolerances?: { ssimMin?: number };  // reserved; visual compare if you add it backend-side

  // Dataset stage (7)
  requiredBlocksWithinLoop?: string[];    // blocks that must be inside loop.DO in this exact order
  expectedOrderWithinLoop?: string[];
  requireExportAfterLoop?: boolean;

  // Stage routing
  next?: number | "bonus" | null;
};

export const module2Stages: StageConfig[] = [
  {
    id: 1,
    title: "Stage 1 — Grayscale",
    type: "pipeline",
    intro: [
      "Convert the sample image to grayscale.",
      "Use the dataset and sample blocks first, then discover the block that makes it look like the target."
    ],
    requiredBlocks: ["m2.to_grayscale"],
    expectedOrder: ["dataset.select", "dataset.sample_image", "m2.to_grayscale"],
    targetOps: [{ type: "to_grayscale" }],
    next: 2,
  },
  {
    id: 2,
    title: "Stage 2 — Resize",
    type: "pipeline",
    intro: [
      "Resize the grayscale image while keeping aspect ratio so one side approaches 150."
    ],
    requiredBlocks: ["m2.to_grayscale", "m2.resize"],
    expectedOrder: ["dataset.select", "dataset.sample_image", "m2.to_grayscale", "m2.resize"],
    targetOps: [
      { type: "to_grayscale" },
      { type: "resize", mode: "fit", maxside: 150 }
    ],
    next: 3,
  },
  {
    id: 3,
    title: "Stage 3 — Pad",
    type: "pipeline",
    intro: ["Pad the image to exactly 150×150."],
    requiredBlocks: ["m2.to_grayscale", "m2.resize", "m2.pad"],
    expectedOrder: ["dataset.select", "dataset.sample_image", "m2.to_grayscale", "m2.resize", "m2.pad"],
    targetOps: [
      { type: "to_grayscale" },
      { type: "resize", mode: "fit", maxside: 150 },
      { type: "pad", w: 150, h: 150, mode: "constant", r: 0, g: 0, b: 0 }
    ],
    next: 4,
  },
  {
    id: 4,
    title: "Stage 4 — Brightness/Contrast",
    type: "pipeline",
    intro: ["Make a gentle clarity adjustment using brightness/contrast."],
    requiredBlocks: ["m2.to_grayscale", "m2.resize", "m2.pad", "m2.brightness_contrast"],
    expectedOrder: [
      "dataset.select", "dataset.sample_image",
      "m2.to_grayscale", "m2.resize", "m2.pad", "m2.brightness_contrast"
    ],
    targetOps: [
      { type: "to_grayscale" },
      { type: "resize", mode: "fit", maxside: 150 },
      { type: "pad", w: 150, h: 150, mode: "constant", r: 0, g: 0, b: 0 },
      { type: "brightness_contrast", b: 10, c: 8 }
    ],
    next: 5,
  },
  {
    id: 5,
    title: "Stage 5 — Blur/Sharpen",
    type: "pipeline",
    intro: ["Apply a small amount of sharpening or blur to improve perception."],
    requiredBlocks: [
      "m2.to_grayscale", "m2.resize", "m2.pad",
      "m2.brightness_contrast", "m2.blur_sharpen"
    ],
    expectedOrder: [
      "dataset.select", "dataset.sample_image",
      "m2.to_grayscale", "m2.resize", "m2.pad", "m2.brightness_contrast", "m2.blur_sharpen"
    ],
    targetOps: [
      { type: "to_grayscale" },
      { type: "resize", mode: "fit", maxside: 150 },
      { type: "pad", w: 150, h: 150, mode: "constant", r: 0, g: 0, b: 0 },
      { type: "brightness_contrast", b: 10, c: 8 },
      { type: "blur_sharpen", blur: 0, sharp: 1.2 }
    ],
    next: 6,
  },
  {
    id: 6,
    title: "Stage 6 — Normalize",
    type: "pipeline",
    intro: ["Normalize pixel values to a consistent range."],
    requiredBlocks: [
      "m2.to_grayscale", "m2.resize", "m2.pad",
      "m2.brightness_contrast", "m2.blur_sharpen", "m2.normalize"
    ],
    expectedOrder: [
      "dataset.select", "dataset.sample_image",
      "m2.to_grayscale", "m2.resize", "m2.pad", "m2.brightness_contrast", "m2.blur_sharpen", "m2.normalize"
    ],
    targetOps: [
      { type: "to_grayscale" },
      { type: "resize", mode: "fit", maxside: 150 },
      { type: "pad", w: 150, h: 150, mode: "constant", r: 0, g: 0, b: 0 },
      { type: "brightness_contrast", b: 10, c: 8 },
      { type: "blur_sharpen", blur: 0, sharp: 1.2 },
      { type: "normalize", mode: "zero_one" }
    ],
    next: 7,
  },
  {
    id: 7,
    title: "Stage 7 — Loop & Export",
    type: "dataset",
    intro: [
      "Build the full preprocessing pipeline inside the loop and export a new dataset."
    ],
    requiredBlocksWithinLoop: [
      "m2.to_grayscale", "m2.resize", "m2.pad",
      "m2.brightness_contrast", "m2.blur_sharpen", "m2.normalize"
    ],
    expectedOrderWithinLoop: [
      "m2.to_grayscale", "m2.resize", "m2.pad", "m2.brightness_contrast", "m2.blur_sharpen", "m2.normalize"
    ],
    requireExportAfterLoop: true,
    next: "bonus",
  },
  {
    id: "bonus",
    title: "Bonus — Edge Detection",
    type: "pipeline",
    intro: [
      "Explore edge detection, see how methods differ, and when to use them.",
    ],
    requiredBlocks: ["m2.edges"],
    expectedOrder: ["dataset.select", "dataset.sample_image", "m2.edges"],
    targetOps: [
      { type: "edges", method: "canny", threshold: 100, overlay: false }
    ],
    next: null,
  },
];
