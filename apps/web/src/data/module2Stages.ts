// src/data/module2Stages.ts
// If you already have this file, replace it fully with this version.

export type Tri = "ok" | "wrong_place" | "missing";

export type OpSpec =
  | { type: "to_grayscale" }
  | { type: "resize"; mode?: "size" | "fit"; w?: number; h?: number; maxside?: number; keep?: "TRUE" | "FALSE" }
  | { type: "pad"; w: number; h: number; mode?: "constant" | "edge" | "reflect" }
  | { type: "brightness_contrast"; b?: number; c?: number }
  | { type: "blur_sharpen"; blur?: number; sharp?: number }
  | { type: "normalize"; mode?: "zero_one" | "minus_one_one" | "zscore" }
  | { type: "edges"; method?: "canny" | "sobel" | "laplacian" | "prewitt"; threshold?: number; overlay?: boolean };

export type StageConfig =
  | {
      id: number | string;
      title: string;
      type: "pipeline";
      intro: string[];
      help: { title: string; text: string };
      requiredBlocks: string[];        // block types, e.g. "m2.to_grayscale"
      expectedOrder?: string[];        // same as above
      targetOps?: OpSpec[];            // how to generate the target from the sample
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

// ---------- Stages ----------

export const module2Stages: StageConfig[] = [
  {
    id: 1,
    title: "Stage 1: Grayscale",
    type: "pipeline",
    intro: [
      "Convert the image to grayscale to focus on shapes and brightness, not color.",
      "This is useful when color doesn’t help the model and only adds noise."
    ],
    help: {
      title: "What is Grayscale?",
      text:
        "Grayscale turns a color image into shades of gray by removing red, green, and blue information. Each pixel now stores only brightness (0 = black, 255 = white). This helps models focus on shapes, edges, and textures instead of color differences. For example, if you’re detecting tools or plastic bottles, their outlines matter more than their color. Removing color also reduces the input size , making training faster."
    },
    requiredBlocks: ["m2.to_grayscale"],
    expectedOrder: ["m2.to_grayscale"],
    targetOps: [{ type: "to_grayscale" }]
  },

  {
    id: 2,
    title: "Stage 2: Resize",
    type: "pipeline",
    intro: [
      "Resize the grayscale image while keeping the aspect ratio so one side reaches 150."
    ],
    help: {
      title: "Why Resize?",
      text:
        "Images in datasets come in many sizes, one might be 640×480, another 300×200. A neural network expects all images to have the same dimensions so that every input tensor is aligned. Resizing makes every image fit into a fixed shape, like 150 × 150 pixels.\n\nWe also preserve the aspect ratio (that’s the ratio between width and height) so objects don’t look stretched or squished. For example, an object that’s 2× wider than it is tall should stay that way after resizing, and keeping the aspect ratio does exactly that. Keeping proportions consistent helps the model learn patterns that reflect real shapes rather than distortions."
    },
    requiredBlocks: ["m2.to_grayscale", "m2.resize"],
    expectedOrder: ["m2.to_grayscale", "m2.resize"],
    targetOps: [
      { type: "to_grayscale" },
      // Target is 'resize towards 150' (we validate parameters separately)
      { type: "resize", mode: "size", w: 150, h: 256, keep: "TRUE" }
    ]
  },

  {
    id: 3,
    title: "Stage 3: Pad",
    type: "pipeline",
    intro: ["Pad the image to exactly 150×150 (letterboxing)."],
    help: {
      title: "Padding to Exact Size",
      text:
        "After resizing with aspect ratio preserved, some images may still not fill the entire square frame. Padding adds empty borders (often black pixels) around the image to reach the final exact size.\n\nThis step is important because the next stages and the model itself expect a fixed image shape. Without padding, images would have uneven edges and the model couldn’t stack them properly into a batch. Think of it like putting photos of different sizes into equally sized frames so they all line up neatly for training. Padding also prevents the model from treating stretched or cropped objects as new shapes."
    },
    requiredBlocks: ["m2.to_grayscale", "m2.resize", "m2.pad"],
    expectedOrder: ["m2.to_grayscale", "m2.resize", "m2.pad"],
    targetOps: [
      { type: "to_grayscale" },
      { type: "resize", mode: "size", w: 150, h: 256, keep: "TRUE" }, // parameter rules enforced in UI
      { type: "pad", w: 150, h: 150, mode: "constant" }
    ]
  },

  {
    id: 4,
    title: "Stage 4: Brightness & Contrast",
    type: "pipeline",
    intro: [
      "Make gentle brightness/contrast changes to improve visibility.",
      "Stay within small values so you don’t distort the data."
    ],
    help: {
      title: "Brightness and Contrast Adjustments",
      text:
        "Brightness controls how light or dark the overall image looks, so adding brightness increases all pixel values slightly. Contrast adjusts the difference between light and dark regions, so higher contrast makes edges sharper, lower contrast makes everything look flatter.\n\nSmall adjustments help the model handle lighting differences between photos (like indoor vs. outdoor shots). For example, increasing contrast slightly can make outlines easier for the model to detect, while lowering brightness prevents glare from dominating. The goal is to make each image clearer without changing its actual content."
    },
    requiredBlocks: ["m2.to_grayscale", "m2.resize", "m2.pad", "m2.brightness_contrast"],
    expectedOrder: ["m2.to_grayscale", "m2.resize", "m2.pad", "m2.brightness_contrast"],
    targetOps: [
      { type: "to_grayscale" },
      { type: "resize", mode: "size", w: 150, h: 256, keep: "TRUE" },
      { type: "pad", w: 150, h: 150, mode: "constant" },
      { type: "brightness_contrast", b: 10, c: 10 }
    ]
  },

  {
    id: 5,
    title: "Stage 5: Blur & Sharpen",
    type: "pipeline",
    intro: [
      "Reduce noise with blur or make edges crisper with a small sharpen value.",
      "Use tiny values; overdoing it will harm the model."
    ],
    help: {
      title: "Blurring and Sharpening",
      text:
        "Blurring smooths the image by averaging nearby pixels, which reduces random noise or camera grain. Sharpening does the opposite, so it emphasizes edges and fine details so borders stand out.\n\nThese are small, controlled filters applied before the model sees the image. A light blur (like bur with value 1) can help the model ignore small irrelevant textures, while gentle sharpening (around 1–2 strength) makes outlines more defined. Both help the model focus on stable features instead of pixel-level randomness."
    },
    requiredBlocks: [
      "m2.to_grayscale",
      "m2.resize",
      "m2.pad",
      "m2.brightness_contrast",
      "m2.blur_sharpen"
    ],
    expectedOrder: [
      "m2.to_grayscale",
      "m2.resize",
      "m2.pad",
      "m2.brightness_contrast",
      "m2.blur_sharpen"
    ],
    targetOps: [
      { type: "to_grayscale" },
      { type: "resize", mode: "size", w: 150, h: 256, keep: "TRUE" },
      { type: "pad", w: 150, h: 150, mode: "constant" },
      { type: "brightness_contrast", b: 10, c: 10 },
      { type: "blur_sharpen", blur: 0, sharp: 1.0 }
    ]
  },

  {
    id: 6,
    title: "Stage 6: Normalize",
    type: "pipeline",
    intro: [
      "Normalize pixel values so numbers are in a small, consistent range (e.g., 0–1).",
      "This helps training stay stable and fair across images."
    ],
    help: {
      title: "Why Normalize Pixel Values?",
      text:
        "Each pixel starts with values from 0 to 255. That’s fine for images, but large numbers make neural networks unstable, so gradients can explode or vanish during training. Normalization rescales all pixels to a smaller, consistent range such as 0 to 1 or −1 to 1.\n\nThis makes every input image comparable in intensity, helping the model learn faster and more evenly. Think of it like putting all exam scores on a 0–100 scale before averaging them. Normalization ensures fairness and mathematical stability."
    },
    requiredBlocks: [
      "m2.to_grayscale",
      "m2.resize",
      "m2.pad",
      "m2.brightness_contrast",
      "m2.blur_sharpen",
      "m2.normalize"
    ],
    expectedOrder: [
      "m2.to_grayscale",
      "m2.resize",
      "m2.pad",
      "m2.brightness_contrast",
      "m2.blur_sharpen",
      "m2.normalize"
    ],
    targetOps: [
      { type: "to_grayscale" },
      { type: "resize", mode: "size", w: 150, h: 256, keep: "TRUE" },
      { type: "pad", w: 150, h: 150, mode: "constant" },
      { type: "brightness_contrast", b: 10, c: 10 },
      { type: "blur_sharpen", blur: 0, sharp: 1.0 },
      { type: "normalize", mode: "zero_one" }
    ]
  },

  {
    id: 7,
    title: "Stage 7: Loop & Export",
    type: "loop_export",
    intro: [
      "Put the whole preprocessing pipeline inside the loop block,",
      "then export a new dataset that you can use in later modules."
    ],
    help: {
      title: "Looping Through the Dataset and Exporting",
      text:
        "Up to now, we’ve been testing your preprocessing pipeline on a single sample image. The Loop block lets you apply that same sequence of steps to every image in the dataset automatically. Inside the loop, each image is taken, processed, and passed forward.\n\nAfter the loop finishes, the Export block saves the processed images as a new dataset. This gives you a clean, standardized version of your original data ready for training. This ensures that the model will learn from consistent, high-quality inputs."
    },
    requiredBlocksWithinLoop: [
      "m2.to_grayscale",
      "m2.resize",
      "m2.pad",
      "m2.brightness_contrast",
      "m2.blur_sharpen",
      "m2.normalize"
    ],
    expectedOrderWithinLoop: [
      "m2.to_grayscale",
      "m2.resize",
      "m2.pad",
      "m2.brightness_contrast",
      "m2.blur_sharpen",
      "m2.normalize"
    ],
    requireExportAfterLoop: true
  },

  // Bonus: Edges
  {
    id: "bonus",
    title: "Bonus: Edge Detection",
    type: "pipeline",
    intro: [
      "Try an edge detector (like Canny) to highlight outlines.",
      "Useful for shape-heavy tasks; not a standard step for every dataset."
    ],
    help: {
      title: "When to Use Edge Detection",
      text:
        "Edge detection highlights areas where the brightness changes sharply, these are the boundaries or outlines of objects. Methods like Canny or Sobel work by finding those changes and producing an image that only shows edges.\n\nThis is useful when you care about shapes and structure more than color or texture (for example, detecting symbols or traffic signs). But it removes most shading and fine detail, so it’s not ideal for natural images, so it should not be not for every task, just the tasks where you need to identify a specific object in the image"
    },
    requiredBlocks: ["m2.edges"],
    expectedOrder: ["m2.edges"],
    targetOps: [{ type: "edges", method: "canny", threshold: 100, overlay: false }]
  }
];
