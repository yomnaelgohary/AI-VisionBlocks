export const toolboxJsonModule2 = {
  kind: "categoryToolbox",
  contents: [
    {
      kind: "category",
      name: "Datasets",
      colour: "#0ea5e9",
      contents: [
        { kind: "block", type: "dataset.select" },
        { kind: "block", type: "dataset.info" },
        { kind: "block", type: "dataset.class_counts" },
        { kind: "block", type: "dataset.class_distribution_preview" },
      ],
    },
    {
      kind: "category",
      name: "Images",
      colour: "#22c55e",
      contents: [
        { kind: "block", type: "dataset.sample_image" },
        { kind: "block", type: "image.channels_split" }, 
      ],
    },

    // -------- Module 2: Preprocessing --------
    {
      kind: "category",
      name: "Preprocessing",
      colour: "#a78bfa", // violet
      contents: [
        { kind: "block", type: "m2.resize" },
        { kind: "block", type: "m2.pad" },
        { kind: "block", type: "m2.brightness_contrast" },
        { kind: "block", type: "m2.blur_sharpen" },
        { kind: "block", type: "m2.edges" },        // edge detection
        { kind: "block", type: "m2.to_grayscale" }, // actual transform
        { kind: "block", type: "m2.normalize" },
        { kind: "block", type: "m2.loop_dataset" },
        { kind: "block", type: "m2.export_dataset" },
      ],
    },
  ],
};
