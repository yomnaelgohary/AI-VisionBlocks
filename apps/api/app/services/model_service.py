from __future__ import annotations

import re
import base64
import io
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import logging

import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers

from app.core.config import settings
from app.services.datasets import get_datasets_index, DatasetIndex
from app.services.split_service import get_active_split_indices


# Where to keep saved models + diagrams.
BASE_DIR = Path(settings.DATASETS_DIR).parent
MODELS_DIR = getattr(settings, "MODELS_DIR", BASE_DIR / "created_models")
MODEL_VIZ_DIR = getattr(settings, "MODEL_VIZ_DIR", BASE_DIR / "model_diagrams")

MODELS_DIR.mkdir(parents=True, exist_ok=True)
MODEL_VIZ_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger(__name__)


@dataclass
class LayerSpec:
    type: str
    params: Dict[str, Any]


@dataclass
class ModelSpec:
    name: str
    layers: List[LayerSpec]


# Session-scoped active models, keyed by dataset_key
_ACTIVE_MODELS: Dict[str, keras.Model] = {}
_ACTIVE_SPECS: Dict[str, Dict[str, Any]] = {}
_CURRENT_DATASET_KEY: Optional[str] = None  # used by /evaluate/test


# -------------------------
# Helpers
# -------------------------
def _slugify(name: str) -> str:
    safe = "".join(c if c.isalnum() or c in "-._" else "_" for c in name.strip())
    return safe or "model"


def _infer_input_shape(ds: DatasetIndex) -> Tuple[int, int, int]:
    """
    TEMPORARY: force a 150x150x3 input size.

    Module 2's preprocessing pipeline resizes + pads images to 150x150,
    so we can safely standardize the model input to this shape for now.

    Later, we can either:
      - read a stored image_shape from the processed dataset, or
      - expose an input-size setting in the frontend blocks.
    """
    return 150, 150, 3



def _capture_model_summary(model: keras.Model) -> List[str]:
    buf = io.StringIO()
    model.summary(print_fn=lambda s: buf.write(s + "\n"))
    return buf.getvalue().splitlines()


def _slugify_filename(name: str) -> str:
    # keep it filesystem-safe
    name = re.sub(r"[^a-zA-Z0-9_.-]+", "_", name)
    return name.strip("._") or "model"

# Directory where we store generated diagrams
_MODEL_DIAGRAM_DIR = Path("created_models") / "diagrams"
_MODEL_DIAGRAM_DIR.mkdir(parents=True, exist_ok=True)

def _generate_model_diagram(model, filename: str) -> str | None:
  """
  Try to generate a PNG diagram and return it as a data URL string.

  Order:
  1) plotneuralnet (LaTeX / pdflatex-based)
  2) keras.utils.plot_model as a fallback

  On failure, returns None. Debug info is printed to stdout.
  """
  print("[_generate_model_diagram] start; filename=", filename)

  # Choose an output directory for diagrams (you can change this if you already
  # have MODEL_VIZ_DIR defined somewhere else)
  try:
    base_dir = Path(__file__).resolve().parent
  except NameError:
    base_dir = Path(".")

  out_dir = base_dir / "model_viz"
  out_dir.mkdir(parents=True, exist_ok=True)

  safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in filename)
  out_png = out_dir / f"{safe_name}.png"

  # ------------------------------------------------------------------
  # 1) Try plotneuralnet adapter
  # ------------------------------------------------------------------
  try:
    print("[_generate_model_diagram] trying plotneuralnet adapter…")
    from app.third_party.plotneuralnet_adapter import (
      render_model_with_plotneuralnet,
    )

    png_path_str = render_model_with_plotneuralnet(model, out_png)
    png_path = Path(png_path_str)
    if not png_path.exists():
      print(
        "[_generate_model_diagram] plotneuralnet adapter did not create PNG at",
        png_path,
      )
      raise FileNotFoundError(f"plotneuralnet PNG not found at {png_path}")

    out_png = png_path
    print("[_generate_model_diagram] plotneuralnet adapter succeeded:", out_png)
  except Exception as e:
    print(
      "[_generate_model_diagram] plotneuralnet_adapter failed, "
      "will try direct keras.utils.plot_model. error=",
      repr(e),
    )

    # ----------------------------------------------------------------
    # 2) Fallback: keras.utils.plot_model
    # ----------------------------------------------------------------
    try:
      from tensorflow.keras.utils import plot_model  # type: ignore
    except Exception as e2:
      print(
        "[_generate_model_diagram] keras.utils.plot_model not importable; "
        "giving up on diagram. error=",
        repr(e2),
      )
      return None

    try:
      print("[_generate_model_diagram] calling keras.utils.plot_model…")
      plot_model(
        model,
        to_file=str(out_png),
        show_shapes=True,
        show_layer_names=True,
        dpi=120,
      )
      if not out_png.exists():
        print(
          "[_generate_model_diagram] keras.utils.plot_model did not create a file at",
          out_png,
        )
        return None
      print("[_generate_model_diagram] keras.utils.plot_model succeeded:", out_png)
    except Exception as e3:
      print(
        "[_generate_model_diagram] keras.utils.plot_model failed; "
        "no diagram will be returned. error=",
        repr(e3),
      )
      return None

  # ------------------------------------------------------------------
  # 3) Base64-encode and return data URL
  # ------------------------------------------------------------------
  try:
    with open(out_png, "rb") as f:
      b64 = base64.b64encode(f.read()).decode("ascii")
    data_url = f"data:image/png;base64,{b64}"
    print("[_generate_model_diagram] returning data URL of length", len(data_url))
    return data_url
  except Exception as e:
    print("[_generate_model_diagram] failed to read/encode PNG. error=", repr(e))
    return None


def _get_class_mapping(ds: DatasetIndex) -> Dict[str, int]:
    return {c: i for i, c in enumerate(ds.classes)}


# -------------------------
# Public model API
# -------------------------
def build_model_for_dataset(dataset_key: str, spec_dict: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build and compile a Sequential CNN based on the given spec, attach an
    automatic Flatten before the first dense layer, and store it as the
    active model for this dataset.
    """
    idx = get_datasets_index()
    if dataset_key not in idx:
        raise KeyError(f"Unknown dataset: {dataset_key}")
    ds = idx[dataset_key]

    spec = ModelSpec(
        name=spec_dict.get("name", "my-model"),
        layers=[
            LayerSpec(type=l["type"], params=l.get("params") or {})
            for l in spec_dict.get("layers", [])
        ],
    )

    # IMPORTANT: fixed size (matches preprocessed images)
    input_h, input_w, input_c = _infer_input_shape(ds)
    num_classes = len(ds.classes) or 1

    model = keras.Sequential(name=spec.name)
    model.add(layers.Input(shape=(input_h, input_w, input_c), name="input"))

    flatten_inserted = False
    saw_dense = False  # reserved if you want to enforce at least one dense

    for layer_spec in spec.layers:
        ltype = layer_spec.type
        params = layer_spec.params or {}

        if ltype == "conv2d":
            filters = int(params.get("filters", 32))
            kernel = int(params.get("kernel", 3))
            stride = int(params.get("stride", 1))
            padding = params.get("padding", "same")
            activation = params.get("activation", "relu")
            model.add(
                layers.Conv2D(
                    filters=filters,
                    kernel_size=kernel,
                    strides=stride,
                    padding=padding,
                    activation=activation,
                )
            )

        elif ltype == "pool":
            kind = params.get("kind", "max")
            size = int(params.get("size", 2))
            if kind == "avg":
                model.add(layers.AveragePooling2D(pool_size=size))
            else:
                model.add(layers.MaxPooling2D(pool_size=size))

        elif ltype == "dense":
            units = int(params.get("units", 128))
            # FIRST time we see a dense, force a Flatten first
            if not flatten_inserted:
                model.add(layers.Flatten(name="flatten"))
                flatten_inserted = True
            model.add(layers.Dense(units, activation=params.get("activation", "relu")))
            saw_dense = True

        else:
            # Unknown type = ignore silently (frontend shouldn't send it)
            continue

    # If the user never added any dense layer, we still need a Flatten before the output
    if not flatten_inserted:
        model.add(layers.Flatten(name="flatten"))

    # Output layer for classification
    model.add(
        layers.Dense(
            num_classes,
            activation="softmax",
            name="output",
        )
    )

    model.compile(
        optimizer="adam",
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )

    # THIS WAS THE MISSING PART AFTER THE LAST CHANGE
    # Keep in session
    _ACTIVE_MODELS[dataset_key] = model
    _ACTIVE_SPECS[dataset_key] = spec_dict
    global _CURRENT_DATASET_KEY
    _CURRENT_DATASET_KEY = dataset_key

    # Optional: summary for the frontend (no diagram for now)
    summary_lines = _capture_model_summary(model)
    diagram_data_url = _generate_model_diagram(model, filename=f"{dataset_key}_{spec.name}")

    return {
        "ok": True,
        "name": spec.name,
        "input_shape": [input_h, input_w, input_c],
        "num_classes": num_classes,
        "summary_lines": summary_lines,
        "diagram_data_url": diagram_data_url,
    }



def get_active_model(dataset_key: str) -> keras.Model:
    model = _ACTIVE_MODELS.get(dataset_key)
    if model is None:
        raise RuntimeError("No active model for this dataset. Call /model/build first.")
    return model


def get_current_dataset_key() -> Optional[str]:
    return _CURRENT_DATASET_KEY


def save_active_model(dataset_key: str, model_name: str) -> Dict[str, Any]:
    model = get_active_model(dataset_key)
    safe_name = _slugify(model_name)
    model_path = MODELS_DIR / f"{safe_name}.keras"
    spec_path = MODELS_DIR / f"{safe_name}.json"

    model.save(model_path)

    import json

    spec = _ACTIVE_SPECS.get(dataset_key)
    if spec:
        spec_path.write_text(json.dumps(spec, indent=2))

    return {
        "ok": True,
        "name": model_name,
        "filename": model_path.name,
        "note": "Model saved and will overwrite any existing file with the same name.",
    }


def load_model_for_dataset(dataset_key: str, model_name: str) -> Dict[str, Any]:
    safe_name = _slugify(model_name)
    model_path = MODELS_DIR / f"{safe_name}.keras"
    if not model_path.exists():
        raise FileNotFoundError(f"No saved model named '{model_name}'.")

    model = keras.models.load_model(model_path)
    _ACTIVE_MODELS[dataset_key] = model
    global _CURRENT_DATASET_KEY
    _CURRENT_DATASET_KEY = dataset_key

    summary_lines = _capture_model_summary(model)

    # Diagram generation temporarily disabled here as well
    diagram_data_url: Optional[str] = None

    return {
        "ok": True,
        "name": model_name,
        "filename": model_path.name,
        "summary_lines": summary_lines,
        "diagram_data_url": diagram_data_url,
    }


# -------------------------
# Training / evaluation / prediction helpers
# -------------------------
def _build_tf_dataset_for_indices(
    ds: DatasetIndex,
    idxs: List[int],
    model: keras.Model,
    batch_size: int,
    shuffle: bool,
) -> tf.data.Dataset:
    """
    Map dataset indices to (image, label) pairs and wrap them into a tf.data.Dataset
    that matches the model's input size.
    """
    class_to_idx = _get_class_mapping(ds)
    dataset_dir = Path(settings.DATASETS_DIR) / ds.key

    paths: List[str] = []
    labels: List[int] = []
    for i in idxs:
        row = ds.rows[i]
        rel = row.get("path") or row.get("image_path")
        if not rel:
            continue
        paths.append(str(dataset_dir / rel))
        labels.append(class_to_idx[row["class"]])

    input_shape = model.input_shape  # e.g. (None, H, W, C)
    _, h, w, c = input_shape

    def _load_fn(path, label):
        img_raw = tf.io.read_file(path)
        img = tf.image.decode_image(img_raw, channels=c)
        img.set_shape([None, None, c])
        img = tf.image.convert_image_dtype(img, tf.float32)
        img = tf.image.resize(img, [h, w])
        return img, label

    ds_tf = tf.data.Dataset.from_tensor_slices((paths, labels))
    ds_tf = ds_tf.map(_load_fn, num_parallel_calls=tf.data.AUTOTUNE)
    if shuffle:
        ds_tf = ds_tf.shuffle(buffer_size=len(paths))
    ds_tf = ds_tf.batch(batch_size).prefetch(tf.data.AUTOTUNE)
    return ds_tf


def train_active_model(dataset_key: str, epochs: int, batch_size: int) -> Dict[str, Any]:
    """
    Train the *active* model on the active TRAIN split.

    IMPORTANT: This is now where we compile the model. We always call
    model.compile(...) here before fitting, so /model/build can stay light.
    """
    idx = get_datasets_index()
    if dataset_key not in idx:
        raise KeyError(f"Unknown dataset: {dataset_key}")
    ds = idx[dataset_key]

    model = get_active_model(dataset_key)
    split = get_active_split_indices(dataset_key)
    if not split or not split["train"]:
        raise RuntimeError("No active split for this dataset. Use the split blocks to apply a split first.")

    train_idxs = split["train"]
    train_ds = _build_tf_dataset_for_indices(ds, train_idxs, model, batch_size=batch_size, shuffle=True)

    # Compile here (even if already compiled previously, it's safe to recompile)
    model.compile(
        optimizer="adam",
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )

    history = model.fit(train_ds, epochs=epochs, verbose=0)

    acc_hist = history.history.get("accuracy") or history.history.get("acc") or []
    loss_hist = history.history.get("loss") or []
    epoch_summaries = []
    for i, (acc, loss) in enumerate(zip(acc_hist, loss_hist), start=1):
        epoch_summaries.append(
            {
                "epoch": i,
                "train_acc": float(acc),
                "train_loss": float(loss),
            }
        )

    # Update "current" dataset
    global _CURRENT_DATASET_KEY
    _CURRENT_DATASET_KEY = dataset_key

    return {
        "ok": True,
        "epochs": epoch_summaries,
    }


def evaluate_active_model_on_test() -> Dict[str, Any]:
    dataset_key = _CURRENT_DATASET_KEY
    if not dataset_key:
        raise RuntimeError("No active dataset/model. Build and/or train a model first.")

    idx = get_datasets_index()
    if dataset_key not in idx:
        raise KeyError(f"Unknown dataset: {dataset_key}")
    ds = idx[dataset_key]

    model = get_active_model(dataset_key)
    split = get_active_split_indices(dataset_key)
    if not split or not split["test"]:
        raise RuntimeError("No active test split for this dataset. Use the split blocks to apply a split first.")

    test_idxs = split["test"]
    test_ds = _build_tf_dataset_for_indices(ds, test_idxs, model, batch_size=32, shuffle=False)

    # Collect predictions + labels to compute per-class metrics + confusion matrix
    import numpy as np
    from math import isfinite

    y_true: List[int] = []
    y_pred: List[int] = []

    for batch_x, batch_y in test_ds:
        probs = model.predict(batch_x, verbose=0)
        preds = probs.argmax(axis=1)
        y_true.extend(batch_y.numpy().tolist())
        y_pred.extend(preds.tolist())

    y_true_arr = np.array(y_true, dtype=int)
    y_pred_arr = np.array(y_pred, dtype=int)

    if y_true_arr.size == 0:
        raise RuntimeError("Test split is empty. Adjust your split ratio or dataset.")

    num_classes = len(ds.classes)
    conf = np.zeros((num_classes, num_classes), dtype=int)
    for t, p in zip(y_true_arr, y_pred_arr):
        if 0 <= t < num_classes and 0 <= p < num_classes:
            conf[t, p] += 1

    correct = (y_true_arr == y_pred_arr).sum()
    accuracy = float(correct) / float(len(y_true_arr))

    per_class: List[Dict[str, Any]] = []
    for i, name in enumerate(ds.classes):
        total_i = conf[i].sum()
        acc_i = float(conf[i, i]) / float(total_i) if total_i > 0 else 0.0
        per_class.append({"name": name, "acc": acc_i})

    # Optional confusion matrix image
    confusion_data_url: Optional[str] = None
    try:
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots()
        im = ax.imshow(conf, interpolation="nearest")
        ax.set_title("Confusion Matrix")
        ax.set_xticks(range(num_classes))
        ax.set_yticks(range(num_classes))
        ax.set_xticklabels(ds.classes, rotation=45, ha="right")
        ax.set_yticklabels(ds.classes)
        fig.colorbar(im, ax=ax)
        plt.tight_layout()

        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight")
        plt.close(fig)
        buf.seek(0)
        b64 = base64.b64encode(buf.read()).decode("ascii")
        confusion_data_url = f"data:image/png;base64,{b64}"
    except Exception:
        confusion_data_url = None

    return {
        "ok": True,
        "accuracy": accuracy,
        "per_class": per_class,
        "confusion_data_url": confusion_data_url,
    }


def predict_on_sample(dataset_key: str, image_path: str) -> Dict[str, Any]:
    idx = get_datasets_index()
    if dataset_key not in idx:
        raise KeyError(f"Unknown dataset: {dataset_key}")
    ds = idx[dataset_key]

    model = get_active_model(dataset_key)
    dataset_dir = Path(settings.DATASETS_DIR) / ds.key
    full_path = dataset_dir / image_path

    if not full_path.exists():
        raise FileNotFoundError(f"Image not found: {full_path}")

    from PIL import Image
    import numpy as np

    input_shape = model.input_shape
    _, h, w, c = input_shape

    with Image.open(full_path) as im:
        im = im.convert("RGB")
        im = im.resize((w, h))
        arr = np.array(im, dtype="float32") / 255.0

    arr = arr.reshape((1, h, w, c))
    probs = model.predict(arr, verbose=0)[0]
    best_idx = int(probs.argmax())
    conf = float(probs[best_idx])

    class_name = ds.classes[best_idx] if 0 <= best_idx < len(ds.classes) else str(best_idx)

    return {
        "ok": True,
        "class": class_name,
        "confidence": conf,
    }
