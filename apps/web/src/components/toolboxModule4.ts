export const toolboxJsonModule4 = {
  kind: "categoryToolbox",
  contents: [
    // ---------------- Datasets ----------------
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

    // ---------------- Images ----------------
    {
      kind: "category",
      name: "Images",
      colour: "#22c55e",
      contents: [
        { kind: "block", type: "dataset.sample_image" },
        { kind: "block", type: "image.show" },
      ],
    },

    // ---------------- Splitting & Bias (from Module 3) ----------------
    {
      kind: "category",
      name: "Splitting & Bias",
      colour: "#ec4899",
      contents: [
        { kind: "block", type: "m3.set_split_ratio" },
        { kind: "block", type: "m3.apply_split" },
        { kind: "block", type: "m3.check_bias_train" },
        { kind: "block", type: "m3.balance_train" },
      ],
    },

    // ---------------- Model ----------------
    {
      kind: "category",
      name: "Model",
      colour: "#8b5cf6",
      contents: [
        { kind: "block", type: "m4.model_init" },
        { kind: "block", type: "m4.layer_conv2d" },
        { kind: "block", type: "m4.layer_pool" },
        { kind: "block", type: "m4.layer_dense" },
        { kind: "block", type: "m4.model_summary" },
        { kind: "block", type: "m4.model_save" },
        { kind: "block", type: "m4.model_load" },
      ],
    },

    // ---------------- Training ----------------
    {
      kind: "category",
      name: "Training",
      colour: "#06b6d4",
      contents: [
        { kind: "block", type: "m4.train_hparams" },
        { kind: "block", type: "m4.train_start" },
      ],
    },

    // ---------------- Evaluation ----------------
    {
      kind: "category",
      name: "Evaluation",
      colour: "#f59e0b",
      contents: [
        { kind: "block", type: "m4.eval_test" },
        { kind: "block", type: "m4.predict_sample" },
      ],
    },
  ],
};
