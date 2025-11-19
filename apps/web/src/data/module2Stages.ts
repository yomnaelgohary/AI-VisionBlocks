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
  // STAGE 1 – Grayscale (unchanged)
  {
    id: 1,
    title: "Stage 1: Grayscale",
    type: "pipeline",
    intro: [
      "Convert the image to grayscale to focus on shapes and brightness, not color.",
      "This is useful when color does not help the model and only adds noise.",
    ],
    help: {
      title: "What is Grayscale?",
      text:
        "Grayscale turns a color image into shades of gray by removing red, green, and blue information. Each pixel now stores only brightness (0 = black, 255 = white). This helps models focus on shapes, edges, and textures instead of color differences. " +
        "For example, if you are detecting tools or plastic bottles, their outlines matter more than their color. Removing color also reduces the input size, making training faster.",
    },
    requiredBlocks: ["m2.to_grayscale"],
    expectedOrder: ["m2.to_grayscale"],
    targetOps: [{ type: "to_grayscale" }],
  },

  // STAGE 2 – Brightness, Contrast, Blur & Sharpen
  {
    id: 2,
    title: "Stage 2: Brightness, Contrast, Blur & Sharpen",
    type: "pipeline",
    intro: [
      "Gently adjust brightness and contrast to make details clearer.",
      "Use a small sharpen value to make edges pop, or a tiny blur to smooth noise.",
    ],
    help: {
      title: "Brightness, Contrast, and Sharpness",
      text:
        "Brightness controls how light or dark the overall image looks by shifting pixel values up or down. Contrast changes how strong the difference is between light and dark areas, making edges stand out more or less. " +
        "Sharpening emphasizes edges and fine details, while blurring smooths noisy textures.\n\n" +
        "In preprocessing, small adjustments help the model handle different lighting conditions (indoor vs outdoor, shadows, etc.) without changing the meaning of the image. " +
        "The goal is to make structure easier to see, not to create a completely new image.",
    },
    // We build on Stage 1, then add brightness/contrast + blur/sharpen
    requiredBlocks: ["m2.to_grayscale", "m2.brightness_contrast", "m2.blur_sharpen"],
    expectedOrder: ["m2.to_grayscale", "m2.brightness_contrast", "m2.blur_sharpen"],
    targetOps: [
      { type: "to_grayscale" },
      { type: "brightness_contrast", b: 10, c: 10 },
      { type: "blur_sharpen", blur: 0, sharp: 1.0 },
    ],
  },

  // STAGE 3 – Resize & Pad
  {
    id: 3,
    title: "Stage 3: Resize & Pad",
    type: "pipeline",
    intro: [
      "Resize images so they share a consistent size while keeping aspect ratio.",
      "Then pad to a clean 150×150 square so every sample fits the same frame.",
    ],
    help: {
      title: "Resizing and Padding Together",
      text:
        "Datasets rarely come with perfectly aligned image sizes. A model, however, expects all inputs to have the same width and height. Resizing adjusts the image so that it fits within a target size while preserving its aspect ratio to avoid stretching or squishing objects.\n\n" +
        "Even after resizing with aspect ratio preserved, you may still have leftover margins. Padding adds pixels (often a constant color) around the image so it reaches an exact shape, such as 150×150. " +
        "Think of it like putting differently sized photos into identically sized frames, so they all line up nicely for your neural network.",
    },
    // Build on Stage 2, then add resize + pad
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

  // STAGE 4 – Normalize
  {
    id: 4,
    title: "Stage 4: Normalize",
    type: "pipeline",
    intro: [
      "Normalize pixel values into a small, consistent range such as 0–1.",
      "This helps training stay stable and prevents large raw values from causing trouble.",
    ],
    help: {
      title: "Why Normalize Pixel Values?",
      text:
        "Raw pixel values usually sit between 0 and 255. Feeding those directly into a neural network can make training unstable, because gradients can become too large or too small. " +
        "Normalization rescales all pixel values into a friendlier range like 0–1 or -1–1.\n\n" +
        "This makes images more comparable to each other and helps the optimizer move in smoother, more predictable steps. " +
        "It is similar to grading all exams on the same scale before averaging scores.",
    },
    // Build on Stage 3, then add normalization at the end
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
      { type: "resize", mode: "size", w: 150, h: 256, keep: "TRUE" },
      { type: "pad", w: 150, h: 150, mode: "constant" },
      { type: "normalize", mode: "zero_one" },
    ],
  },

  // STAGE 5 – Loop & Export (same logic as old Stage 7, just new id and order)
  {
    id: 5,
    title: "Stage 5: Loop & Export",
    type: "loop_export",
    intro: [
      "Put your whole preprocessing pipeline inside the loop block.",
      "Then export a new processed dataset that you can use in later modules.",
    ],
    help: {
      title: "Looping Through the Dataset and Exporting",
      text:
        "So far you have tested your pipeline on a single sample image. The loop block lets you apply that same sequence of steps to many or all images in the dataset automatically. " +
        "Inside the loop, each image is processed in turn using your pipeline.\n\n" +
        "After the loop, the export block saves these processed images as a new dataset. " +
        "That gives you a clean, standardized dataset ready for training in later modules.",
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
      title: "When to Use Edge Detection",
      text:
        "Edge detection highlights areas where brightness changes sharply. These are usually object boundaries or strong texture transitions. " +
        "Methods like Canny or Sobel look for these changes and produce an image that mostly shows edges.\n\n" +
        "This is helpful when object shape and structure are more important than color or shading, such as symbols or signs. " +
        "For natural images, it can throw away useful information, so it is more of a special tool than a default step.",
    },
    requiredBlocks: ["m2.edges"],
    expectedOrder: ["m2.edges"],
    targetOps: [{ type: "edges", method: "canny", threshold: 100, overlay: false }],
  },
];
