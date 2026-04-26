export type StageType =
  | "split"
  | "model_build"
  | "train"
  | "eval_predict";

export type StageConfig = {
  id: number | string;
  title: string;
  type: StageType;

  // Text shown in the right-side panel (like Module 2)
  intro: string[];
  help: {
    title: string;
    text: string;
  };

  /**
   * Block types that must appear at least once in the main chain for this stage
   * (or in the model / training chain, depending on StageRunner4 logic).
   *
   * These are the *concepts* this stage is teaching.
   */
  requiredBlocks: string[];

  /**
   * Optional recommended order for the required blocks.
   * StageRunner4 can treat this as a soft ordering constraint
   * (like Module 2’s expectedOrder).
   */
  expectedOrder?: string[];

  /**
   * Extra model-specific constraints that StageRunner4 can enforce.
   * For non-model stages these can be ignored.
   */
  minConvLayers?: number;
  minPoolLayers?: number;
  minDenseLayers?: number;

  /**
   * Whether this stage assumes a train/test split already exists,
   * or that a trained model already exists.
   */
  requiresSplit?: boolean;
  requiresTrainedModel?: boolean;
  requiresSavedModel?: boolean;
};

export const module4Stages: StageConfig[] = [
  // ────────────────────────────────────────────────
  // STAGE 1 – Split the dataset + build the model
  // ────────────────────────────────────────────────
  {
    id: 1,
    title: "Stage 1: Split Data & Build a CNN",
    type: "model_build",
    intro: [
      "Create a train/test split, then design a simple convolutional neural network (CNN) in one connected pipeline.",
      "You will choose a dataset, apply split ratio, then add model blocks (conv, pool, dense) and finish with model summary.",
    ],
    help: {
      title: "How should this first full pipeline look?",
      text: `
    This stage merges data preparation and model design into one clean chain.

    • Train split: the pictures the model actually practices on.
    • Test split: new pictures the model never sees during training, used at the very end to check how well it generalises.
    • Split ratio: controls how much goes to training vs testing (for example 80% train, 20% test).
    • Model blocks: conv and pool layers extract visual patterns, dense layers combine them into class decisions.

    Recommended order:
    use dataset -> set split ratio -> apply split -> start new model -> conv -> pool -> dense -> model summary.

    Once this full chain is correct, you can move on to training.
    `.trim(),
    },
    requiredBlocks: [
      "dataset.select",
      "m3.set_split_ratio",
      "m3.apply_split",
      "m4.model_init",
      "m4.layer_conv2d",
      "m4.layer_pool",
      "m4.layer_dense",
      "m4.model_summary",
    ],
    expectedOrder: [
      "dataset.select",
      "m3.set_split_ratio",
      "m3.apply_split",
      "m4.model_init",
      "m4.layer_conv2d",
      "m4.layer_pool",
      "m4.layer_dense",
      "m4.model_summary",
    ],
    minConvLayers: 1,
    minPoolLayers: 1,
    minDenseLayers: 1,
    requiresSplit: true,
  },

  // ────────────────────────────────────────────────
  // STAGE 2 – Train, evaluate, and predict (merged)
  // ────────────────────────────────────────────────
  {
    id: 2,
    title: "Stage 2: Train, Evaluate & Predict",
    type: "train",
    intro: [
      "Configure how the model trains (epochs, batch size) and start the training loop.",
      "Then evaluate on the TEST split and try a single-sample prediction.",
    ],
    help: {
      title: "How do training and evaluation fit together?",
      text: `
    Training is the model’s practice session. It sees many labelled images and slowly adjusts itself so it makes fewer mistakes.

    • Epochs: how many times the model loops over the entire training set. More epochs = more practice, but too many can lead to overfitting.

    After training, we evaluate on the TEST split and then try a single-sample prediction to see how the model behaves on an individual image.

    In this stage you keep your model structure the same, then add training setup → start training → evaluate on test → get sample image → predict current sample.
    `.trim(),
    },
    requiredBlocks: [
      "dataset.select",
      "m3.set_split_ratio",
      "m3.apply_split",
      "m4.model_init",
      "m4.layer_conv2d",
      "m4.layer_pool",
      "m4.layer_dense",
      "m4.model_summary",
      "m4.train_hparams",
      "m4.train_start",
      "m4.eval_test",
      "dataset.sample_image",
      "m4.predict_sample",
    ],
    expectedOrder: [
      "dataset.select",
      "m3.set_split_ratio",
      "m3.apply_split",
      "m4.model_init",
      "m4.layer_conv2d",
      "m4.layer_pool",
      "m4.layer_dense",
      "m4.model_summary",
      "m4.train_hparams",
      "m4.train_start",
      "m4.eval_test",
      "dataset.sample_image",
      "m4.predict_sample",
    ],
    minConvLayers: 1,
    minPoolLayers: 1,
    minDenseLayers: 1,
    requiresSplit: true,
    requiresTrainedModel: false, // this stage *creates* the trained model
  },
];
