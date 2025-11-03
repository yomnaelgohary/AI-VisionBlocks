export const toolboxJsonModule3 = {
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
      name: "Splitting & Bias",
      colour: "#f472b6", // pink
      contents: [
        { kind: "block", type: "m3.set_split_ratio" },
        { kind: "block", type: "m3.apply_split" },
        { kind: "block", type: "m3.check_bias_train" },
        { kind: "block", type: "m3.balance_train" }, // runs on Submit & Run
      ],
    },
  ],
};
