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
  // STAGE 1 – Split the dataset
  // ────────────────────────────────────────────────
  {
    id: 1,
    title: "Stage 1: Train / Test Split",
    type: "split",
    intro: [
      "Create a train/test split so the model can learn from one part of the data and be checked on another.",
      "You’ll choose a dataset, inspect its classes, then decide what percentage goes into training vs testing.",
    ],
    help: {
      title: "Why do we split the data?",
      text: `
    When we train a model, we don’t want to test it on the exact same pictures it practiced on. That would only tell us how well it memorised, not how well it understands.

    • Train split: the pictures the model actually practices on.
    • Test split: new pictures the model never sees during training, used at the very end to check how well it generalises.
    • Split ratio: controls how much goes to training vs testing (for example 80% train, 20% test).

    In this stage you connect the “use dataset”, “set split ratio”, and “apply split” blocks so every later stage knows which images are for training and which are for testing.
    `.trim(),
    },
    requiredBlocks: ["dataset.select", "m3.set_split_ratio", "m3.apply_split"],
    expectedOrder: ["dataset.select", "m3.set_split_ratio", "m3.apply_split"],
    requiresSplit: false,
  },

  // ────────────────────────────────────────────────
  // STAGE 2 – Build the model
  // ────────────────────────────────────────────────
  {
    id: 2,
    title: "Stage 2: Build a CNN model",
    type: "model_build",
    intro: [
      "Design a simple convolutional neural network (CNN) using blocks: start a new model, add conv and pooling layers, then finish with dense layers.",
      "Your model will read the preprocessed images and output one score per class.",
    ],
    help: {
      title: "How is the model structured?",
      text: `
    A convolutional neural network (CNN) is like a small factory that turns an image into a decision, one step at a time.

    • Convolution layers: look at small patches of the image and learn simple patterns, like edges, corners, or small shapes. Later conv layers can combine those into more complex patterns.
    • Pooling layers: gently shrink the image so the model keeps the important patterns but ignores tiny details and noise. This also makes the model faster and less likely to overfit.
    • Dense layers: sit at the end. They take all the features found so far and mix them to make a final decision about the class of the picture.

    A very common CNN shape is: one or more pairs of “conv → pool” layers, then one or more dense layers at the end. For example: 
    conv → pool → conv → pool → dense → dense.

    In this stage you will: reuse the split from Stage 1, start a new model with the model_init block, add at least one conv + pool pair, then one or more dense layers, and finally the model_summary block to see the structure you built.
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
  // STAGE 3 – Train the model
  // ────────────────────────────────────────────────
  {
    id: 3,
    title: "Stage 3: Train the model",
    type: "train",
    intro: [
      "Configure how the model trains (epochs, batch size, learning rate) and start the training loop.",
      "You’ll see how loss and accuracy change over time as the model learns from the TRAIN split.",
    ],
    help: {
      title: "What happens during training?",
      text: `
    Training is the model’s practice session. It sees many labelled images and slowly adjusts itself so it makes fewer mistakes.

    • Epochs: how many times the model loops over the entire training set. More epochs = more practice, but too many can lead to overfitting.

    In this stage you keep your model structure the same, then use the training setup and start training blocks. The model will look at the TRAIN split only, and you’ll see accuracy and loss change as it learns.
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
    ],
    minConvLayers: 1,
    minPoolLayers: 1,
    minDenseLayers: 1,
    requiresSplit: true,
    requiresTrainedModel: false, // this stage *creates* the trained model
  },

  // ────────────────────────────────────────────────
  // STAGE 4 – Evaluate & predict
  // ────────────────────────────────────────────────
  {
    id: 4,
    title: "Stage 4: Evaluate & Predict",
    type: "eval_predict",
    intro: [
      "Use the TEST split to measure how well your trained model generalizes.",
      "Then pick individual images and ask the model to predict their class.",
    ],
    help: {
      title: "How do we evaluate the model?",
      text: `
    Once the model has finished training, we test it on images it has never seen before. This shows how well it might perform in the real world.

    • Evaluate on test set: runs the model on the TEST split and reports overall accuracy and accuracy per class.
    • Single-sample prediction: lets you pick one image and see exactly what the model guesses and how confident it is.

    In this stage you connect evaluate → get sample image → predict current sample at the end of your pipeline, so you can both see the big picture (test accuracy) and zoom in on individual predictions.
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
      "m4.predict_sample",
    ],
    minConvLayers: 1,
    minPoolLayers: 1,
    minDenseLayers: 1,
    requiresSplit: true,
    requiresTrainedModel: true,
  },
];
