import * as BlocklyNS from "blockly/core";
import * as BlocklyPython from "blockly/python";
import "blockly/blocks";

export const Blockly = BlocklyNS;
export const pythonGenerator = BlocklyPython.pythonGenerator as any;

const C_BLUE = 200;
const C_GREEN = 120;

// Small inline SVG “info” icon
const INFO_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="9" fill="#3b82f6"/>
      <rect x="9" y="7" width="2" height="2" fill="white"/>
      <rect x="9" y="10" width="2" height="6" fill="white"/>
    </svg>`
  );

function setStatement(block: any) {
  block.setPreviousStatement(true, null);
  block.setNextStatement(true, null);
  block.setDeletable(true);
}

function setStatementIO(block: any) {
  block.setPreviousStatement(true, null);
  block.setNextStatement(true, null);
  block.setDeletable(true);
}

/** Attach a clickable (i) icon and set tooltip; dispatches a window event the page listens for */
function appendInfo(
  block: any,
  text: string,
  firstInputName?: string,
  title?: string
) {
  block.setTooltip(text);

  const img = new (Blockly as any).FieldImage(
    INFO_ICON,
    16,
    16,
    "*",
    () => {
      window.dispatchEvent(
        new CustomEvent("vb:blockInfo", {
          detail: {
            title: title || "What does this block do?",
            text,
          },
        })
      );
    }
  );

  const first =
    (firstInputName && block.getInput(firstInputName)) ||
    block.inputList?.[0] ||
    null;
  if (first) {
    first.appendField(" ").appendField(img);
  } else {
    block.appendDummyInput().appendField(img);
  }
}

/* =========================================================================
   Module 1 Blocks
   ========================================================================= */

// ---------------- Datasets ----------------
Blockly.Blocks["dataset.select"] = {
  init: function () {
    this.appendDummyInput("ROW")
      .appendField("use dataset")
      .appendField(new (Blockly as any).FieldDropdown(() => DATASET_OPTIONS), "DATASET");
    setStatement(this);
    this.setColour(C_BLUE);
    appendInfo(
      this,
      "Pick which image set you want to work with. Think of it like choosing a folder full of pictures!",
      "ROW",
      "Use dataset"
    );
  },
};

let DATASET_OPTIONS: [string, string][] = [
  ["Recyclables (Mini)", "recyclables-mini"], // fallback until fetched
];
export function setDatasetOptions(pairs: { name: string; key: string }[]) {
  DATASET_OPTIONS = pairs.map((p) => [p.name, p.key]);
}

Blockly.Blocks["dataset.info"] = {
  init: function () {
    this.appendDummyInput("ROW").appendField("dataset info");
    setStatement(this);
    this.setColour(C_BLUE);
    appendInfo(
      this,
      "Shows the dataset’s name and which classes (labels) it contains. Great for a quick overview!",
      "ROW",
      "Dataset info"
    );
  },
};

Blockly.Blocks["dataset.class_counts"] = {
  init: function () {
    this.appendDummyInput("ROW").appendField("class counts");
    setStatement(this);
    this.setColour(C_BLUE);
    appendInfo(
      this,
      "Tells you how many images are in each class. Helpful to spot if one class has way more pictures than others.",
      "ROW",
      "Class counts"
    );
  },
};

Blockly.Blocks["dataset.class_distribution_preview"] = {
  init: function () {
    this.appendDummyInput("ROW").appendField("class distribution preview (percent)");
    setStatement(this);
    this.setColour(C_BLUE);
    appendInfo(
      this,
      "Shows the percentage for each class. If one class is too big, your robot might get biased!",
      "ROW",
      "Class distribution"
    );
  },
};

// ---------------- Images ----------------
Blockly.Blocks["dataset.sample_image"] = {
  init: function () {
    this.appendDummyInput("TITLE").appendField("get sample image");

    const modeField = new (Blockly as any).FieldDropdown(
      [
        ["random", "random"],
        ["by index", "index"],
      ],
      (newVal: string) => {
        const blk = modeField.getSourceBlock();
        const wrap = blk?.getInput("IDX_WRAP");
        if (wrap) {
          wrap.setVisible(newVal === "index");
          blk?.render(false);
        }
        return newVal;
      }
    );

    this.appendDummyInput("MODE_ROW")
      .appendField("mode")
      .appendField(modeField, "MODE");

    this.appendDummyInput("IDX_WRAP")
      .appendField("index")
      .appendField(new (Blockly as any).FieldNumber(0, 0, 999999, 1), "INDEX");

    this.getInput("IDX_WRAP")?.setVisible(false);

    setStatement(this);
    this.setColour(C_GREEN);
    appendInfo(
      this,
      "Grabs one picture to preview your steps. Random picks a surprise; by index lets you choose a specific one.",
      "TITLE",
      "Get sample image"
    );
  },
};

Blockly.Blocks["image.show"] = {
  init: function () {
    this.appendDummyInput("ROW")
      .appendField("show image")
      .appendField("title")
      .appendField(new (Blockly as any).FieldTextInput("Sample"), "TITLE");
    setStatement(this);
    this.setColour(C_GREEN);
    appendInfo(
      this,
      "Displays the current picture in the output panel with a title you choose.",
      "ROW",
      "Show image"
    );
  },
};

// (These remain defined for Module 1 completeness)
Blockly.Blocks["image.shape"] = {
  init: function () {
    this.appendDummyInput("ROW").appendField("show image shape");
    setStatement(this);
    this.setColour(C_GREEN);
    appendInfo(
      this,
      "Shows image size like height × width × channels (RGB has 3 channels).",
      "ROW",
      "Image shape"
    );
  },
};

Blockly.Blocks["image.channels_split"] = {
  init: function () {
    this.appendDummyInput("ROW").appendField("split RGB channels (preview)");
    setStatement(this);
    this.setColour(C_GREEN);
    appendInfo(
      this,
      "Looks at Red, Green, and Blue separately—like turning on one color at a time.",
      "ROW",
      "Split RGB channels"
    );
  },
};

Blockly.Blocks["image.to_grayscale_preview"] = {
  init: function () {
    this.appendDummyInput("ROW").appendField("grayscale preview");
    setStatement(this);
    this.setColour(C_GREEN);
    appendInfo(
      this,
      "Shows the image in shades of gray. Good for focusing on shapes without colors.",
      "ROW",
      "Grayscale preview"
    );
  },
};

/* =========================================================================
   Module 2 Blocks
   ========================================================================= */

const C_VIOLET = 260; // preprocessing

// Resize
Blockly.Blocks["m2.resize"] = {
  init: function () {
    const mode = new (Blockly as any).FieldDropdown(
      [
        ["to size", "size"],
        ["fit within", "fit"],
        ["scale (%)", "scale"],
      ],
      (val: string) => {
        const blk = mode.getSourceBlock();
        if (!blk) return val;
        blk.getInput("SIZE_WRAP")?.setVisible(val === "size");
        blk.getInput("FIT_WRAP")?.setVisible(val === "fit");
        blk.getInput("SCALE_WRAP")?.setVisible(val === "scale");
        blk.render(false);
        return val;
      }
    );

    this.appendDummyInput("TITLE").appendField("resize image");
    this.appendDummyInput("MODE_ROW").appendField("mode").appendField(mode, "MODE");

    this.appendDummyInput("SIZE_WRAP")
      .appendField("width")
      .appendField(new (Blockly as any).FieldNumber(256, 1, 4096, 1), "W")
      .appendField("height")
      .appendField(new (Blockly as any).FieldNumber(256, 1, 4096, 1), "H")
      .appendField("keep aspect")
      .appendField(new (Blockly as any).FieldCheckbox("TRUE"), "KEEP");

    this.appendDummyInput("FIT_WRAP")
      .appendField("max side")
      .appendField(new (Blockly as any).FieldNumber(256, 1, 4096, 1), "MAXSIDE");

    this.appendDummyInput("SCALE_WRAP")
      .appendField("percent")
      .appendField(new (Blockly as any).FieldNumber(100, 1, 1000, 1), "PCT");

    this.getInput("SIZE_WRAP")?.setVisible(true);
    this.getInput("FIT_WRAP")?.setVisible(false);
    this.getInput("SCALE_WRAP")?.setVisible(false);

    setStatement(this);
    this.setColour(C_VIOLET);
    appendInfo(
      this,
      "Changes image size. ‘Keep aspect’ avoids squishing the image, ‘fit within’ makes the long side your target, and ‘scale’ grows or shrinks by percent.",
      "TITLE",
      "Resize"
    );
  },
};

// Center crop
Blockly.Blocks["m2.crop_center"] = {
  init: function () {
    this.appendDummyInput("ROW")
      .appendField("center crop")
      .appendField("width")
      .appendField(new (Blockly as any).FieldNumber(224, 1, 4096, 1), "W")
      .appendField("height")
      .appendField(new (Blockly as any).FieldNumber(224, 1, 4096, 1), "H");
    setStatement(this);
    this.setColour(C_VIOLET);
    appendInfo(
      this,
      "Cuts out a rectangle from the middle, like zooming into the center.",
      "ROW",
      "Center crop"
    );
  },
};

// Pad
Blockly.Blocks["m2.pad"] = {
  init: function () {
    const mode = new (Blockly as any).FieldDropdown(
      [
        ["constant (color)", "constant"],
        ["edge", "edge"],
        ["reflect", "reflect"],
      ],
      (val: string) => {
        const blk = mode.getSourceBlock();
        const colorInput = blk?.getInput("COLOR_WRAP");
        if (colorInput) {
          colorInput.setVisible(val === "constant");
          blk?.render(false);
        }
        return val;
      }
    );

    this.appendDummyInput("TITLE").appendField("pad image to size");
    this.appendDummyInput("SIZE_ROW")
      .appendField("width")
      .appendField(new (Blockly as any).FieldNumber(256, 1, 4096, 1), "W")
      .appendField("height")
      .appendField(new (Blockly as any).FieldNumber(256, 1, 4096, 1), "H");
    this.appendDummyInput("MODE_ROW").appendField("mode").appendField(mode, "MODE");
    this.appendDummyInput("COLOR_WRAP")
      .appendField("color (R,G,B)")
      .appendField(new (Blockly as any).FieldNumber(0, 0, 255, 1), "R")
      .appendField(new (Blockly as any).FieldNumber(0, 0, 255, 1), "G")
      .appendField(new (Blockly as any).FieldNumber(0, 0, 255, 1), "B");
    this.getInput("COLOR_WRAP")?.setVisible(true);

    setStatement(this);
    this.setColour(C_VIOLET);
    appendInfo(
      this,
      "Adds borders so the picture becomes an exact size. Useful when an image has a different width and height.",
      "TITLE",
      "Pad image"
    );
  },
};

// Brightness / Contrast
Blockly.Blocks["m2.brightness_contrast"] = {
  init: function () {
    this.appendDummyInput("ROW")
      .appendField("brightness / contrast")
      .appendField("brightness")
      .appendField(new (Blockly as any).FieldNumber(0, -50, 50, 1), "B")
      .appendField("contrast")
      .appendField(new (Blockly as any).FieldNumber(0, -50, 50, 1), "C");
    setStatement(this);
    this.setColour(C_VIOLET);
    appendInfo(
      this,
      "Bright = lighter, contrast = stronger color differences. Useful if photos look too dark or flat.",
      "ROW",
      "Brightness & Contrast"
    );
  },
};

// Blur / Sharpen
Blockly.Blocks["m2.blur_sharpen"] = {
  init: function () {
    this.appendDummyInput("ROW")
      .appendField("blur / sharpen")
      .appendField("blur radius")
      .appendField(new (Blockly as any).FieldNumber(0, 0, 20, 0.5), "BLUR")
      .appendField("sharpen amount")
      .appendField(new (Blockly as any).FieldNumber(0, 0, 3, 0.1), "SHARP");
    setStatement(this);
    this.setColour(C_VIOLET);
    appendInfo(
      this,
      "Blur smooths details, and sharpen makes edges crisper. Try small changes first.",
      "ROW",
      "Blur & Sharpen"
    );
  },
};

// Edge detection
Blockly.Blocks["m2.edges"] = {
  init: function () {
    const method = new (Blockly as any).FieldDropdown([
      ["Canny", "canny"],
      ["Sobel", "sobel"],
      ["Laplacian", "laplacian"],
      ["Prewitt", "prewitt"],
    ]);
    this.appendDummyInput("TITLE")
      .appendField("detect edges")
      .appendField("method")
      .appendField(method, "METHOD");
    this.appendDummyInput("T_ROW")
      .appendField("threshold")
      .appendField(new (Blockly as any).FieldNumber(100, 0, 255, 1), "THRESH");
    this.appendDummyInput("O_ROW")
      .appendField("overlay")
      .appendField(new (Blockly as any).FieldCheckbox("FALSE"), "OVERLAY");
    setStatement(this);
    this.setColour(C_VIOLET);
    appendInfo(
      this,
      "Finds the outlines in a picture. Edges help the robot notice shapes and boundaries.",
      "TITLE",
      "Edge detection"
    );
  },
};

// To grayscale
Blockly.Blocks["m2.to_grayscale"] = {
  init: function () {
    this.appendDummyInput("ROW").appendField("convert to grayscale");
    setStatement(this);
    this.setColour(C_VIOLET);
    appendInfo(
      this,
      "Removes color so only light and dark remain. Great when color isn’t important.",
      "ROW",
      "Grayscale"
    );
  },
};

// Normalize (improved kid-friendly explanation)
Blockly.Blocks["m2.normalize"] = {
  init: function () {
    this.appendDummyInput("ROW")
      .appendField("normalize pixels")
      .appendField(
        new (Blockly as any).FieldDropdown([
          ["0–1", "zero_one"],
          ["-1–1", "minus_one_one"],
          ["z-score (per channel)", "zscore"],
        ]),
        "MODE"
      );
    setStatement(this);
    this.setColour(C_VIOLET);
    appendInfo(
      this,
      "This scales all the pixel numbers to a smaller, consistent range so the computer doesn’t get confused by big values.",
      "ROW",
      "Normalize pixels"
    );
  },
};

// Loop over dataset (no split)
Blockly.Blocks["m2.loop_dataset"] = {
  init: function () {
    const sub = new (Blockly as any).FieldDropdown(
      [
        ["all", "all"],
        ["first N", "firstN"],
        ["random N", "randomN"],
      ],
      (val: string) => {
        const blk = sub.getSourceBlock();
        const nWrap = blk?.getInput("N_WRAP");
        if (nWrap) {
          nWrap.setVisible(val !== "all");
          blk?.render(false);
        }
        return val;
      }
    );

    this.appendDummyInput("TITLE")
      .appendField("for each image in dataset")
      .appendField("subset")
      .appendField(sub, "SUBSET");
    this.appendDummyInput("N_WRAP")
      .appendField("N")
      .appendField(new (Blockly as any).FieldNumber(50, 1, 100000, 1), "N");
    this.getInput("N_WRAP")?.setVisible(false);
    this.appendDummyInput("S_ROW")
      .appendField("shuffle")
      .appendField(new (Blockly as any).FieldCheckbox("FALSE"), "SHUFFLE");
    this.appendDummyInput("K_ROW")
      .appendField("progress every")
      .appendField(new (Blockly as any).FieldNumber(10, 1, 1000, 1), "K")
      .appendField("images");

    this.appendStatementInput("DO").appendField("do");
    setStatementIO(this);
    this.setColour(C_VIOLET);
    appendInfo(
      this,
      "Runs the steps inside for many images. Use this when you’re done designing and want to process the whole set.",
      "TITLE",
      "Loop over dataset"
    );
  },
};

// Export processed dataset
Blockly.Blocks["m2.export_dataset"] = {
  init: function () {
    this.appendDummyInput("TITLE")
      .appendField("export processed dataset")
      .appendField("name")
      .appendField(new (Blockly as any).FieldTextInput("recyclables-processed"), "NAME");
    this.appendDummyInput("O_ROW")
      .appendField("overwrite if exists")
      .appendField(new (Blockly as any).FieldCheckbox("FALSE"), "OVERWRITE");

    setStatement(this);
    this.setColour(C_VIOLET);
    appendInfo(
      this,
      "Saves your cleaned images as a new dataset you can use later. Give it a name you’ll remember!",
      "TITLE",
      "Export dataset"
    );
  },
};

// ---------------- Module 3 Blocks ----------------
const C_PINK = 320; // Splitting & Bias

// Set split ratio (preview)
(Blockly as any).Blocks["m3.set_split_ratio"] = {
  init: function () {
    this.appendDummyInput("ROW")
      .appendField("set split ratio")
      .appendField("train %")
      .appendField(new (Blockly as any).FieldNumber(80, 1, 99, 1), "TRAIN");
    setStatement(this);
    this.setColour(C_PINK);
    appendInfo(
      this,
      "Choose how much of the data is for learning (train). The rest is for testing. This only previews the split; to apply it, use the Apply split block.",
      "ROW",
      "Set split ratio"
    );
  },
};

// Apply split (instant in-session)
(Blockly as any).Blocks["m3.apply_split"] = {
  init: function () {
    this.appendDummyInput("ROW").appendField("apply split");
    setStatement(this);
    this.setColour(C_PINK);
    appendInfo(
      this,
      "Splits the data to trainig and testing sets depending on the ratio used in Set split ratio block. Your original dataset is not changed.",
      "ROW",
      "Apply split"
    );
  },
};

// Check training set bias (instant)
(Blockly as any).Blocks["m3.check_bias_train"] = {
  init: function () {
    this.appendDummyInput("ROW")
      .appendField("check training set bias")
      .appendField("threshold %")
      .appendField(new (Blockly as any).FieldNumber(10, 1, 50, 1), "THRESH");
    setStatement(this);
    this.setColour(C_PINK);
    appendInfo(
      this,
      "Highlights classes in the training set that differ from the average by more than the threshold percent.",
      "ROW",
      "Check training bias"
    );
  },
};

// Balance training set (runs on Submit & Run)
(Blockly as any).Blocks["m3.balance_train"] = {
  init: function () {
    this.appendDummyInput("ROW")
      .appendField("balance training set")
      .appendField("mode")
      .appendField(
        new (Blockly as any).FieldDropdown([
          ["duplicate minority", "duplicate"],
          ["augment minority", "augment"],
          ["remove extras", "undersample"],
        ]),
        "MODE"
      )
      .appendField("target min %")
      .appendField(new (Blockly as any).FieldNumber(25, 5, 50, 1), "TARGET");
    setStatement(this);
    this.setColour(C_PINK);
    appendInfo(
      this,
      "make sure every type of example in your training data gets a fair shot. Choose how you want to balance things out: \n - Remove extras: We toss out some of the extra data to match the smaller groups. \n - Duplicate minority: We duplicate the rare data so we have more copies. \n - Augment minority: We create brand new, realistic examples of the rare data. \nHeads up: This is heavy-lifting for your computer! The magic happens after you hit \"Submit & Run.\"",
      "ROW",
      "Balance training set"
    );
  },
};


/* -------------------------------------------------------------------------
   Minimal generators so pythonGenerator doesn't error (unchanged behavior)
   ------------------------------------------------------------------------- */
pythonGenerator.forBlock["dataset.select"] = () => "# dataset.select\n";
pythonGenerator.forBlock["dataset.info"] = () => "# dataset.info\n";
pythonGenerator.forBlock["dataset.class_counts"] = () => "# dataset.class_counts\n";
pythonGenerator.forBlock["dataset.class_distribution_preview"] = () => "# dataset.class_distribution_preview\n";
pythonGenerator.forBlock["dataset.sample_image"] = () => "# dataset.sample_image\n";
pythonGenerator.forBlock["image.show"] = () => "# image.show\n";
pythonGenerator.forBlock["image.shape"] = () => "# image.shape\n";
pythonGenerator.forBlock["image.channels_split"] = () => "# image.channels_split\n";
pythonGenerator.forBlock["image.to_grayscale_preview"] = () => "# image.to_grayscale_preview\n";

pythonGenerator.forBlock["m2.resize"] = () => "# m2.resize\n";
pythonGenerator.forBlock["m2.crop_center"] = () => "# m2.crop_center\n";
pythonGenerator.forBlock["m2.pad"] = () => "# m2.pad\n";
pythonGenerator.forBlock["m2.brightness_contrast"] = () => "# m2.brightness_contrast\n";
pythonGenerator.forBlock["m2.blur_sharpen"] = () => "# m2.blur_sharpen\n";
pythonGenerator.forBlock["m2.edges"] = () => "# m2.edges\n";
pythonGenerator.forBlock["m2.to_grayscale"] = () => "# m2.to_grayscale\n";
pythonGenerator.forBlock["m2.normalize"] = () => "# m2.normalize\n";
pythonGenerator.forBlock["m2.loop_dataset"] = () => "# m2.loop_dataset\n";
pythonGenerator.forBlock["m2.export_dataset"] = () => "# m2.export_dataset\n";

// minimal python stubs
pythonGenerator.forBlock["m3.set_split_ratio"] = () => "# m3.set_split_ratio\n";
pythonGenerator.forBlock["m3.apply_split"] = () => "# m3.apply_split\n";
pythonGenerator.forBlock["m3.check_bias_train"] = () => "# m3.check_bias_train\n";
pythonGenerator.forBlock["m3.balance_train"] = () => "# m3.balance_train\n";
