export type Tri = "ok" | "wrong_place" | "missing";

export type OpSpec =
  | { type: "to_grayscale" }
  | {
      type: "resize";
      mode?: "size" | "fit";
      w?: number;
      h?: number;
      maxside?: number;
      keep?: "TRUE" | "FALSE";
    }
  | { type: "pad"; w: number; h: number; mode?: "constant" | "edge" | "reflect" }
  | { type: "brightness_contrast"; b?: number; c?: number }
  | { type: "blur_sharpen"; blur?: number; sharp?: number }
  | { type: "normalize"; mode?: "zero_one" | "minus_one_one" | "zscore" }
  | {
      type: "edges";
      method?: "canny" | "sobel" | "laplacian" | "prewitt";
      threshold?: number;
      overlay?: boolean;
    };

export type StageConfig =
  | {
      id: number | string;
      title: string;
      type: "pipeline";
      intro: string[];
      help: { title: string; text: string };
      requiredBlocks: string[];
      expectedOrder?: string[];
      targetOps?: OpSpec[];
    }
  | {
      id: number | string;
      title: string;
      type: "loop_export";
      intro: string[];
      help: { title: string; text: string };
      requiredBlocksWithinLoop: string[];
      expectedOrderWithinLoop?: string[];
      requireExportAfterLoop?: boolean;
    };

// ---------- Stages (new structure) ----------

export const module2Stages: StageConfig[] = [
  // STAGE 1 – Grayscale + Cleanup (merged)
  {
    id: 1,
    title: "Stage 1: Grayscale + Cleanup",
    type: "pipeline",
    intro: [
      "Convert the image to grayscale, then gently clean up brightness and detail.",
      "This helps the model focus on shape without harsh lighting or noisy edges.",
    ],
    help: {
      title: "Why Grayscale and Cleanup?",
      text: `
    Grayscale removes color and keeps only brightness, which makes shape and structure easier to see.
    Then we do small cleanup steps so the image is clearer and less noisy:

    • Brightness and contrast make important details pop.
    • Blur or sharpen removes noise or clarifies edges.

    The goal is not a dramatic filter, just a clean, readable image.
    `.trim(),
    },
    requiredBlocks: [
      "m2.to_grayscale",
      "m2.brightness_contrast",
      "m2.blur_sharpen",
    ],
    expectedOrder: [
      "m2.to_grayscale",
      "m2.brightness_contrast",
      "m2.blur_sharpen",
    ],
    targetOps: [
      { type: "to_grayscale" },
      { type: "brightness_contrast", b: 10, c: 10 },
      { type: "blur_sharpen", blur: 0, sharp: 1.0 },
    ],
  },

  // STAGE 2 – Resize & Pad
  {
    id: 2,
    title: "Stage 2: Resize & Pad",
    type: "pipeline",
    intro: [
      "Resize images so they share a consistent size while keeping aspect ratio.",
      "Then pad to a clean 150×150 square so every sample fits the same frame.",
    ],
    help: {
      title: "Why Resize and Pad Images?",
      text: `
    Neural networks expect every image to be the same size, but real datasets come in all shapes:
    wide, tall, small, big, or anything in between.

    • Resize: shrinks or expands the image so its biggest side fits the target size.
      (We keep the original shape so things don’t look stretched or squished.)
    • Pad: adds blank space around the image so it becomes a perfect square like 150×150.

    Imagine placing many different photos into identical picture frames.
    Resizing makes them fit inside; padding fills the leftover space so the frame stays neat.
    `.trim(),
    },
    // Build on Stage 1, then add resize + pad
    requiredBlocks: [
      "m2.to_grayscale",
      "m2.brightness_contrast",
      "m2.blur_sharpen",
      "m2.resize",
      "m2.pad",
    ],
    expectedOrder: [
      "m2.to_grayscale",
      "m2.brightness_contrast",
      "m2.blur_sharpen",
      "m2.resize",
      "m2.pad",
    ],
    targetOps: [
      { type: "to_grayscale" },
      { type: "brightness_contrast", b: 10, c: 10 },
      { type: "blur_sharpen", blur: 0, sharp: 1.0 },
      // then resize towards 150 while keeping aspect ratio
      { type: "resize", mode: "size", w: 150, h: 256, keep: "TRUE" },
      // and pad to exactly 150×150
      { type: "pad", w: 150, h: 150, mode: "constant" },
    ],
  },

  // STAGE 3 – Normalize
  {
    id: 3,
    title: "Stage 3: Normalize",
    type: "pipeline",
    intro: [
      "Normalize pixel values into a small, consistent range such as 0–1.",
      "This helps training stay stable and prevents large raw values from causing trouble.",
    ],
    help: {
      title: "Why Normalize Pixel Values?",
      text: `
    Raw pixel values go from 0 to 255.
    Feeding these big numbers into a model can make learning uneven or unstable.

    Normalization rescales every pixel into a small, predictable range like 0–1. This helps because:

    • All images become comparable to each other.
    • The model learns more smoothly and consistently.
    • Training becomes faster and avoids “wild jumps”.

    It’s like converting all exam scores to a 0–1 scale before averaging them, everything becomes fair and stable.
    `.trim(),
    },
    // Build on Stage 2, then add normalization at the end
    requiredBlocks: [
      "m2.to_grayscale",
      "m2.brightness_contrast",
      "m2.blur_sharpen",
      "m2.resize",
      "m2.pad",
      "m2.normalize",
    ],
    expectedOrder: [
      "m2.to_grayscale",
      "m2.brightness_contrast",
      "m2.blur_sharpen",
      "m2.resize",
      "m2.pad",
      "m2.normalize",
    ],
    targetOps: [
      { type: "to_grayscale" },
      { type: "brightness_contrast", b: 10, c: 10 },
      { type: "blur_sharpen", blur: 0, sharp: 1.0 },
      // then resize towards 150 while keeping aspect ratio
      { type: "resize", mode: "size", w: 150, h: 256, keep: "TRUE" },
      // and pad to exactly 150×150
      { type: "pad", w: 150, h: 150, mode: "constant" },
      { type: "normalize", mode: "zero_one" },
    ],
  },

  // STAGE 4 – Loop & Export
  {
    id: 4,
    title: "Stage 4: Loop & Export",
    type: "loop_export",
    intro: [
      "Put your whole preprocessing pipeline inside the loop block.",
      "Then export a new processed dataset that you can use in later modules.",
    ],
    help: {
      title: "Why Use a Loop and Export the Dataset?",
      text: `
    So far, you tested your pipeline on a single sample image. In real projects, you need to apply the same steps to *every* image.

    • The loop runs your processing pipeline on one image at a time.
    • It repeats until all images in the dataset are processed.
    • The export block saves these cleaned images as a brand-new dataset.

    Think of it like applying the same photo filter to an entire album automatically,
    then saving the whole improved collection for training later.
    `.trim(),
    },
    requiredBlocksWithinLoop: [
      "m2.to_grayscale",
      "m2.brightness_contrast",
      "m2.blur_sharpen",
      "m2.resize",
      "m2.pad",
      "m2.normalize",
    ],
    expectedOrderWithinLoop: [
      "m2.to_grayscale",
      "m2.brightness_contrast",
      "m2.blur_sharpen",
      "m2.resize",
      "m2.pad",
      "m2.normalize",
    ],
    requireExportAfterLoop: true,
    targetOps: [
      { type: "resize", mode: "size", w: 150, h: 150 },
      { type: "pad", w: 150, h: 150, mode: "constant", r: 0, g: 0, b: 0 },
    ],
  },

  // BONUS – Edge Detection (unchanged)
  {
    id: "bonus",
    title: "Bonus: Edge Detection",
    type: "pipeline",
    intro: [
      "Try an edge detector (like Canny) to highlight outlines.",
      "This is useful for shape-heavy tasks, but not required for every dataset.",
    ],
    help: {
      title: "When Should You Use Edge Detection?",
      text: `
    Edge detection highlights where brightness changes sharply, usually object outlines or strong textures.

    It’s useful when:
    • Shape matters more than color (like signs, symbols, tools).
    • You want the model to pay attention to boundaries.

    But for natural photos (animals, landscapes, people), edges can remove too much information.
    So think of edge detection as a special tool, not a default step, in your image toolbox.
    `.trim(),
    },
    requiredBlocks: ["m2.edges"],
    expectedOrder: ["m2.edges"],
    targetOps: [{ type: "edges", method: "canny", threshold: 100, overlay: false }],
  },
];
