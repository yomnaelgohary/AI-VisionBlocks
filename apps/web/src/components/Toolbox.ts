export const toolboxJson = {
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
  ],
};
