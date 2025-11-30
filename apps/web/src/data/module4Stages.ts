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
      title: "Why split the dataset?",
      text:
        "If you train and test on the exact same images, your model can simply memorize them instead of learning general patterns. " +
        "By splitting into TRAIN and TEST, you teach the model on one subset and evaluate it on another it has never seen before. " +
        "This makes the accuracy more honest and tells you how the model might behave on new images.\n\n" +
        "In this stage, you will:\n" +
        "• Pick a dataset with the “use dataset” block.\n" +
        "• Inspect basic info like class counts and distribution.\n" +
        "• Use the split blocks to choose a train percentage and apply the split in-session.",
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
      text:
        "A convolutional neural network processes images in stages. Early convolution layers learn local patterns like edges or simple textures. " +
        "Pooling layers shrink the spatial dimensions while keeping important features. After several conv + pool steps, the data is flattened and passed into dense layers " +
        "that combine everything to make a final decision.\n\n" +
        "In this stage, you will:\n" +
        "• Reuse the train/test split from Stage 1 so the model knows where training data comes from.\n" +
        "• Start a new model with the model_init block.\n" +
        "• Add at least one conv layer, one pooling layer, and one dense layer, in a logical order under the model.\n" +
        "• Use the model_summary block to inspect how many parameters and layers your model has.\n\n" +
        "You don’t need to worry about flattening: the backend will automatically insert a flatten step when transitioning from convolutional outputs to dense layers.",
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
      text:
        "Training is the process of adjusting the model’s weights so its predictions match the true labels on the training data. " +
        "In each step, the model makes predictions, compares them to the correct labels, and uses the error signal (loss) to update itself via gradient descent.\n\n" +
        "Hyperparameters control how this process behaves:\n" +
        "• Epochs: how many passes we make over the training data.\n" +
        "• Batch size: how many samples are processed in one update step.\n" +
        "• Learning rate: how big each update step is.\n\n" +
        "In this stage, you will:\n" +
        "• Keep your split and model from the previous stages.\n" +
        "• Use the train_hparams block to set basic hyperparameters.\n" +
        "• Start training with the train_start block and inspect the metrics reported back.",
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
      title: "Why evaluation and single-sample predictions?",
      text:
        "Once a model has been trained, you need to know how well it performs on images it has never seen before. " +
        "Evaluation on the TEST split gives you metrics like accuracy that reflect real-world performance.\n\n" +
        "Single-sample predictions help you debug and build intuition. You can look at a specific image, see what class the model chooses, " +
        "and compare it with the ground truth.\n\n" +
        "In this stage, you will:\n" +
        "• Reuse the dataset and split from Stage 1 and the trained model from Stage 3.\n" +
        "• Use the eval_test block to run the model on the TEST split and inspect the metrics.\n" +
        "• Use the predict_sample block to run the model on a chosen image and see the predicted label.",
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
