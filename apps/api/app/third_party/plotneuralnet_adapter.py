# app/third_party/plotneuralnet_adapter.py

from __future__ import annotations

import logging
from pathlib import Path
from typing import Union, List
import os

from contextlib import contextmanager


logger = logging.getLogger("plotneuralnet_adapter")

def render_keras_model(model, out_png: Union[str, Path]) -> None:
    """
    Render a Keras model to a PNG file.

    This adapter is named *plotneuralnet* for backwards compatibility,
    but right now it uses keras.utils.plot_model under the hood because
    the upstream plotneuralnet repo does not provide a ready-made
    `render_keras_model` function.

    We still try to import the plotneuralnet package and log where it
    lives, so if we later decide to generate TikZ diagrams directly
    we already know the paths are correct.
    """
    out_path = Path(out_png)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # 1) Debug: make sure the plotneuralnet package is importable.
    try:
        import importlib

        pnn = importlib.import_module("app.third_party.plotneuralnet")
        logger.info(
            "[plotneuralnet_adapter] plotneuralnet package imported from %s",
            getattr(pnn, "__file__", "<??>"),
        )
    except Exception as e:
        logger.warning(
            "[plotneuralnet_adapter] Could not import app.third_party.plotneuralnet; "
            "this is OK for now because we only use keras.utils.plot_model. error=%s",
            e,
            exc_info=True,
        )

    # 2) Use keras.utils.plot_model to actually draw the diagram.
    try:
        from tensorflow.keras.utils import plot_model
    except Exception as e:
        logger.error(
            "[plotneuralnet_adapter] Failed to import tensorflow.keras.utils.plot_model: %s",
            e,
            exc_info=True,
        )
        raise

    logger.info(
        "[plotneuralnet_adapter] Calling keras.utils.plot_model(model=%s, to_file=%s)",
        getattr(model, "name", "<unnamed>"),
        out_path,
    )

    # NOTE: this requires pydot + Graphviz installed in your environment.
    plot_model(
        model,
        to_file=str(out_path),
        show_shapes=True,
        show_layer_names=True,
        rankdir="TB",
        dpi=140,
    )

    # 3) Log the result so we can see what actually happened.
    if out_path.exists():
        try:
            size = out_path.stat().st_size
        except OSError:
            size = "<?>"
        logger.info(
            "[plotneuralnet_adapter] plot_model wrote %s (exists=%s, size=%s bytes)",
            out_path,
            True,
            size,
        )
    else:
        logger.warning(
            "[plotneuralnet_adapter] Expected output file %s does not exist after plot_model",
            out_path,
        )

logger = logging.getLogger(__name__)

import base64
import subprocess
from typing import Optional

import tensorflow as tf
from tensorflow import keras


def _run_cmd(cmd, cwd: str | Path | None = None) -> None:
  """
  Run a shell command (like pdflatex) and print full stdout/stderr for debugging.
  Raises RuntimeError if the command fails.
  """
  print(f"[plotneuralnet] running command: {cmd} (cwd={cwd})")
  proc = subprocess.run(
    cmd,
    cwd=str(cwd) if cwd is not None else None,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
    shell=False,
    check=False,
  )

  print("----- pdflatex STDOUT -----")
  print(proc.stdout)
  print("----- pdflatex STDERR -----")
  print(proc.stderr)
  print("----------------------------")

  if proc.returncode != 0:
    raise RuntimeError(f"Command failed with returncode={proc.returncode}")


def _find_plotneuralnet_root() -> Optional[Path]:
  """
  Try to locate the installed plotneuralnet package directory.
  We assume you placed it under app.third_party.plotneuralnet.
  """
  try:
    import app.third_party.plotneuralnet as pnn  # type: ignore
  except Exception as e:
    print("[plotneuralnet_adapter] could not import app.third_party.plotneuralnet:", e)
    return None

  return Path(pnn.__file__).resolve().parent


def _build_tex_for_model(model: keras.Model, filename: str) -> str:
  """
  Return a minimal LaTeX document string that uses the 'layers' from plotneuralnet.
  NOTE: This assumes there is a ../layers/init.tex relative to the tex file.
  """

  # Very simple mapping: we just walk layers and emit boxes
  conv_layers = [l for l in model.layers if isinstance(l, keras.layers.Conv2D)]
  pool_layers = [l for l in model.layers if isinstance(l, keras.layers.MaxPooling2D)]
  dense_layers = [
    l for l in model.layers
    if isinstance(l, keras.layers.Dense) and l.name != "output"
  ]
  output_layer = next((l for l in model.layers if l.name == "output"), None)

  # Basic coordinates and offsets
  x = 0.0
  pieces = []

  # Input node (no image yet)
  pieces.append(
    r"""
\node[canvas is zy plane at x=0] (input) at (0,0,0) {\includegraphics[width=4.6875cm,height=4.6875cm]{}};
""".rstrip()
  )

  # Helper to append a Box block
  def add_box(name: str, caption: str, xlabel: str, zlabel: str,
              fill: str, height: float, width: float, depth: float, shift: float) -> None:
    nonlocal x
    x += shift
    pieces.append(
      rf"""
\pic[shift={{{({x:.1f},0,0)}}}] at (0,0,0)
    {{Box={{
        name={name},
        caption={caption},
        xlabel={{{{{{xlabel}}}}}},
        zlabel={zlabel},
        fill={fill},
        height={height},
        width={width},
        depth={depth}
        }}
    }};
""".rstrip()
    )

  # Conv layers
  for i, conv in enumerate(conv_layers):
    filters = getattr(conv, "filters", 32)
    add_box(
      name=f"conv{i+1}",
      caption=str(filters),
      xlabel=f"{filters}, ",
      zlabel=str(filters),
      fill=r"\ConvColor",
      height=6,
      width=1.5,
      depth=6,
      shift=0.5 if i == 0 else 1.0,
    )

  # Pool layers
  for i, pool in enumerate(pool_layers):
    add_box(
      name=f"pool{i+1}",
      caption="pool",
      xlabel="",
      zlabel="",
      fill=r"\PoolColor",
      height=5,
      width=1.0,
      depth=5,
      shift=1.0,
    )

  # Dense layers (hidden)
  for i, dense in enumerate(dense_layers):
    units = getattr(dense, "units", 128)
    add_box(
      name=f"dense{i+1}",
      caption=str(units),
      xlabel='" ","dummy"',
      zlabel=str(units),
      fill=r"\FcColor",
      height=3.0,
      width=1.5,
      depth=12,
      shift=1.5,
    )

  # Output layer
  if output_layer is not None:
    units = getattr(output_layer, "units", 1)
    add_box(
      name="output",
      caption=str(units),
      xlabel='" ","dummy"',
      zlabel=str(units),
      fill=r"\SoftmaxColor",
      height=3.0,
      width=1.5,
      depth=6,
      shift=1.5,
    )

  # Stitch everything into a full .tex document.
  # IMPORTANT: we keep \subimport{../layers/}{init} because the layers
  # folder is expected to live one level up from the tex directory.
  body = "\n\n".join(pieces)

  tex_source = rf"""
\documentclass[border=8pt, multi, tikz]{{standalone}}
\usepackage{{import}}
\subimport{{../layers/}}{{init}}
\usetikzlibrary{{positioning}}
\usetikzlibrary{{3d}} %for including external image

\def\ConvColor{{rgb:yellow,5;red,2.5;white,5}}
\def\ConvReluColor{{rgb:yellow,5;red,5;white,5}}
\def\PoolColor{{rgb:red,1;black,0.3}}
\def\UnpoolColor{{rgb:blue,2;green,1;black,0.3}}
\def\FcColor{{rgb:blue,5;red,2.5;white,5}}
\def\FcReluColor{{rgb:blue,5;red,5;white,4}}
\def\SoftmaxColor{{rgb:magenta,5;black,7}}
\def\SumColor{{rgb:blue,5;green,15}}

\newcommand{{\copymidarrow}}{{\tikz \draw[-Stealth,line width=0.8mm,draw={{rgb:blue,4;red,1;green,1;black,3}}] (-0.3,0) -- ++(0.3,0);}}

\begin{document}
\begin{tikzpicture}
\tikzstyle{{connection}}=[ultra thick,every node/.style={{sloped,allow upside down}},draw=\edgecolor,opacity=0.7]
\tikzstyle{{copyconnection}}=[ultra thick,every node/.style={{sloped,allow upside down}},draw={{rgb:blue,4;red,1;green,1;black,3}},opacity=0.7]

{body}

\end{tikzpicture}
\end{document}
""".lstrip()

  print(tex_source)  # still useful while we debug
  return tex_source


def render_model_with_plotneuralnet(model: keras.Model, filename: str) -> Optional[str]:
  """
  Build a plotneuralnet-style diagram for `model` and return it as
  a data URL (PNG). Returns None if something fails.
  """
  print("[plotneuralnet_adapter] starting render_model_with_plotneuralnet")

  root = _find_plotneuralnet_root()
  if root is None:
    print("[plotneuralnet_adapter] plotneuralnet root not found; aborting.")
    return None

  layers_dir = root / "layers"
  if not layers_dir.exists():
    print("[plotneuralnet_adapter] layers directory not found:", layers_dir)
    return None

  # IMPORTANT:
  # We write the .tex file into a subdirectory 'tex' under the plotneuralnet root,
  # so that '../layers/init.tex' is valid (tex -> .. -> layers).
  tex_dir = root / "tex"
  tex_dir.mkdir(exist_ok=True)

  tex_path = tex_dir / f"{filename}.tex"
  pdf_path = tex_dir / f"{filename}.pdf"
  png_path = tex_dir / f"{filename}.png"

  try:
    # 1) Write .tex
    tex_source = _build_tex_for_model(model, filename)
    tex_path.write_text(tex_source, encoding="utf-8")

    # 2) Run pdflatex in tex_dir so that ../layers/init.tex is resolvable
    cmd = ["pdflatex", "-interaction=nonstopmode", tex_path.name]
    _run_cmd(cmd, cwd=tex_dir)

    if not pdf_path.exists():
      print("[plotneuralnet_adapter] PDF not produced:", pdf_path)
      return None

    # 3) Convert PDF -> PNG
    # Try pdftoppm first (Poppler). Fallback to magick if needed.
    try:
      cmd2 = ["pdftoppm", "-singlefile", "-png", filename, filename]
      _run_cmd(cmd2, cwd=tex_dir)
      if not png_path.exists():
        print("[plotneuralnet_adapter] pdftoppm ran, but PNG not found:", png_path)
        return None
    except Exception as e:
      print("[plotneuralnet_adapter] pdftoppm failed, trying ImageMagick 'magick convert':", e)
      try:
        cmd3 = ["magick", str(pdf_path), str(png_path)]
        _run_cmd(cmd3, cwd=tex_dir)
        if not png_path.exists():
          print("[plotneuralnet_adapter] magick ran, but PNG not found:", png_path)
          return None
      except Exception as e2:
        print("[plotneuralnet_adapter] ImageMagick conversion also failed:", e2)
        return None

    # 4) Encode PNG as data URL
    data = png_path.read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    return "data:image/png;base64," + b64

  except Exception as e:
    print("[plotneuralnet_adapter] error while rendering plotneuralnet diagram:", e)
    return None
