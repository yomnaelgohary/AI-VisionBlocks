# third_party/model_diagram.py

from __future__ import annotations

from pathlib import Path
from typing import Any
import subprocess
import tempfile


def render_model_diagram(model: Any, out_path: Path) -> None:
    """
    Render a diagram of `model` as a PNG at `out_path`.

    This function is the *adapter* between your Keras model and plotNeuralNet.
    You can implement it however you like using the plotNeuralNet code that
    lives under third_party.

    The StageRunner expects that, after this function returns without raising,
    there is a valid PNG file at `out_path`.

    Below is *example-style* pseudo-code. Adapt it to your actual
    plotNeuralNet integration.
    """
    # ---- EXAMPLE SHAPE INTROSPECTION (optional) ----
    # You can inspect the model to build a plotNeuralNet config:
    # layers = []
    # for layer in model.layers:
    #     layers.append({
    #         "name": layer.name,
    #         "type": layer.__class__.__name__,
    #         "output_shape": getattr(layer, "output_shape", None),
    #     })
    #
    # Then call your plotNeuralNet script/builders with this information.

    # ---- STUB: call your own script here ----
    #
    # Replace this with your actual plotNeuralNet invocation, e.g.:
    #
    #   from third_party.plotneuralnet.my_wrapper import build_and_render
    #   build_and_render(model, out_path)
    #
    # or run a LaTeX/TikZ pipeline that finally writes a PNG at out_path.
    #
    # For now, we just raise so you remember to implement it.
    #
    raise NotImplementedError(
        "Implement render_model_diagram(model, out_path) using your plotNeuralNet setup."
    )
