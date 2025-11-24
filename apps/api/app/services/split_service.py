from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Optional, Any
import math
import random

from app.services.datasets import get_datasets_index, DatasetIndex
from app.core.config import settings

# Session-scoped active splits:
# _ACTIVE_SPLITS[dataset_key] = {
#   "train_idxs": List[int],
#   "test_idxs":  List[int],
#   "classes":    List[str],
#   "train_pct":  int
# }
_ACTIVE_SPLITS: Dict[str, Dict[str, Any]] = {}

DATASETS_DIR = settings.DATASETS_DIR  # not used directly here, kept for consistency


@dataclass
class SplitPreview:
    dataset_key: str
    train_pct: int
    classes: List[str]
    total_per_class: Dict[str, int]
    train_per_class: Dict[str, int]
    test_per_class: Dict[str, int]


def _class_rows(ds: DatasetIndex) -> Dict[str, List[int]]:
    buckets: Dict[str, List[int]] = {c: [] for c in ds.classes}
    for i, row in enumerate(ds.rows):
        c = row["class"]
        if c in buckets:
            buckets[c].append(i)
    return buckets


def _counts_from_idxs(ds: DatasetIndex, idxs: List[int]) -> Dict[str, int]:
    counts = {c: 0 for c in ds.classes}
    for i in idxs:
        c = ds.rows[i]["class"]
        if c in counts:
            counts[c] += 1
    return counts


# ---------------------------
# Split preview
# ---------------------------
def preview_split(dataset_key: str, train_pct: int) -> SplitPreview:
    idx = get_datasets_index()
    if dataset_key not in idx:
        raise KeyError(f"Unknown dataset: {dataset_key}")
    ds = idx[dataset_key]

    buckets = _class_rows(ds)
    classes = ds.classes
    total_per_class: Dict[str, int] = {c: len(buckets[c]) for c in classes}

    train_per_class: Dict[str, int] = {}
    test_per_class: Dict[str, int] = {}

    for c in classes:
        total = total_per_class[c]
        n_train = max(0, math.floor(total * (train_pct / 100.0)))
        n_test = max(0, total - n_train)
        train_per_class[c] = n_train
        test_per_class[c] = n_test

    return SplitPreview(
        dataset_key=dataset_key,
        train_pct=train_pct,
        classes=classes,
        total_per_class=total_per_class,
        train_per_class=train_per_class,
        test_per_class=test_per_class,
    )


# ---------------------------
# Split apply (in-session)
# ---------------------------
def apply_split(dataset_key: str, train_pct: int, shuffle: bool = True) -> Dict[str, Any]:
    idx = get_datasets_index()
    if dataset_key not in idx:
        raise KeyError(f"Unknown dataset: {dataset_key}")
    ds = idx[dataset_key]

    buckets = _class_rows(ds)
    train_idxs: List[int] = []
    test_idxs: List[int] = []

    for c, arr in buckets.items():
        arr = list(arr)
        if shuffle:
            random.shuffle(arr)
        n_train = max(0, math.floor(len(arr) * (train_pct / 100.0)))
        train_idxs.extend(arr[:n_train])
        test_idxs.extend(arr[n_train:])

    _ACTIVE_SPLITS[dataset_key] = {
        "train_idxs": train_idxs,
        "test_idxs": test_idxs,
        "classes": ds.classes,
        "train_pct": int(train_pct),
    }

    train_counts = _counts_from_idxs(ds, train_idxs)
    test_counts = _counts_from_idxs(ds, test_idxs)

    return {
        "dataset_key": dataset_key,
        "train_pct": int(train_pct),
        "classes": ds.classes,
        "train": {"size": len(train_idxs), "per_class": train_counts},
        "test": {"size": len(test_idxs), "per_class": test_counts},
        "note": "Active split applied in-session.",
    }


def split_state(dataset_key: str) -> Optional[Dict[str, Any]]:
    idx = get_datasets_index()
    if dataset_key not in idx:
        return None
    ds = idx[dataset_key]
    st = _ACTIVE_SPLITS.get(dataset_key)
    if not st:
        return None

    train_idxs = st["train_idxs"]
    test_idxs = st["test_idxs"]
    return {
        "train_pct": st.get("train_pct", None),
        "classes": st.get("classes", ds.classes),
        "train": {
            "size": len(train_idxs),
            "per_class": _counts_from_idxs(ds, train_idxs),
        },
        "test": {
            "size": len(test_idxs),
            "per_class": _counts_from_idxs(ds, test_idxs),
        },
    }


# expose the *indices* so training/eval can reuse the active split
def get_active_split_indices(dataset_key: str) -> Optional[Dict[str, List[int]]]:
    """
    Return the current in-session train/test indices for this dataset, or None if
    no split has been applied yet.
    """
    st = _ACTIVE_SPLITS.get(dataset_key)
    if not st:
        return None
    return {
        "train": list(st["train_idxs"]),
        "test": list(st["test_idxs"]),
    }


# ---------------------------
# Bias check (TRAIN only)
# ---------------------------
def check_bias_train(dataset_key: str, threshold_pct: int = 10) -> Dict[str, Any]:
    idx = get_datasets_index()
    if dataset_key not in idx:
        raise KeyError(f"Unknown dataset: {dataset_key}")
    ds = idx[dataset_key]

    st = _ACTIVE_SPLITS.get(dataset_key)
    if not st:
        raise RuntimeError("No active split—call /split/apply first.")

    train_idxs: List[int] = st["train_idxs"]
    counts = _counts_from_idxs(ds, train_idxs)
    total = sum(counts.values()) or 1
    classes = ds.classes

    # Compute percentages and deviations from mean
    pct = {c: (counts[c] / total) * 100.0 for c in classes}
    avg = 100.0 / max(1, len(classes))
    flagged: Dict[str, Dict[str, float]] = {}
    for c in classes:
        diff = pct[c] - avg
        if abs(diff) >= float(threshold_pct):
            flagged[c] = {"pct": pct[c], "diff": diff}

    return {
        "train_size": total,
        "per_class": counts,
        "pct": pct,
        "mean_pct": avg,
        "threshold_pct": threshold_pct,
        "flagged": flagged,  # classes that deviate too much
        "note": "Bias check considers TRAIN split only.",
    }


# ---------------------------
# Balance TRAIN in-session
# ---------------------------
def balance_train_inplace(
    dataset_key: str,
    mode: str,
    target_min_pct: int,
) -> Dict[str, Any]:
    """
    Mutate the active TRAIN indices in-session to achieve a minimum per-class share.
    - duplicate: oversample minority classes by duplicating indices
    - augment:   (in-session) same as duplicate here; downstream training can apply transforms
    - undersample: downsample majority classes by removing indices
    No files are written. TEST split remains unchanged.
    """
    idx = get_datasets_index()
    if dataset_key not in idx:
        raise KeyError(f"Unknown dataset: {dataset_key}")
    ds = idx[dataset_key]

    st = _ACTIVE_SPLITS.get(dataset_key)
    if not st:
        raise RuntimeError("No active split—call /split/apply first.")

    if mode not in ("duplicate", "augment", "undersample"):
        raise ValueError("Unknown mode. Use 'duplicate', 'augment', or 'undersample'.")

    train_idxs: List[int] = list(st["train_idxs"])  # work on a copy
    before_counts = _counts_from_idxs(ds, train_idxs)
    before_total = sum(before_counts.values()) or 1
    classes = ds.classes

    # target minimum count per class (based on CURRENT train size)
    min_count = max(1, math.floor((target_min_pct / 100.0) * before_total))

    # Build per-class buckets
    per_class: Dict[str, List[int]] = {c: [] for c in classes}
    for i in train_idxs:
        per_class[ds.rows[i]["class"]].append(i)

    after_train_idxs = list(train_idxs)

    if mode in ("duplicate", "augment"):
        # Oversample minority classes to reach min_count by duplicating indices
        for c in classes:
            cur = len(per_class[c])
            if cur >= min_count or cur == 0:
                continue
            need = min_count - cur
            # sample with replacement from the existing indices of that class
            for _ in range(need):
                after_train_idxs.append(random.choice(per_class[c]))

    elif mode == "undersample":
        # Downsample majority classes to min_count
        kept: List[int] = []
        for c in classes:
            arr = list(per_class[c])
            if len(arr) > min_count:
                random.shuffle(arr)
                arr = arr[:min_count]
            kept.extend(arr)
        after_train_idxs = kept

    # Commit new train indices to active split
    st["train_idxs"] = after_train_idxs

    after_counts = _counts_from_idxs(ds, after_train_idxs)
    after_total = sum(after_counts.values()) or 1

    before_pct = {c: (before_counts[c] / before_total) * 100.0 for c in classes}
    after_pct = {c: (after_counts[c] / after_total) * 100.0 for c in classes}

    return {
        "dataset_key": dataset_key,
        "mode": mode,
        "target_min_pct": target_min_pct,
        "before": {"counts": before_counts, "pct": before_pct, "total": before_total},
        "after": {"counts": after_counts, "pct": after_pct, "total": after_total},
        "note": "Balanced TRAIN in-memory for this session. No files were written.",
    }
