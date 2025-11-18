"use client";
import React from "react";

export type Tri = "missing" | "wrong_place" | "ok";

export type StageChecklistItem = {
  key: string; // stable key (e.g., "m2.to_grayscale")
  label?: string; // if provided; otherwise show "???"
  state: Tri; // missing / wrong_place (–) / ok (✓)
};

export default function MissionChecklistStage({
  title = "Stage Checklist",
  items,
  dark,
}: {
  title?: string;
  items: StageChecklistItem[];
  dark?: boolean;
}) {
  const done = items.filter((i) => i.state === "ok").length;
  const total = items.length;

  return (
    <div
      className="rounded-3xl border border-white/80 bg-white/80 backdrop-blur-xl
                 shadow-[0_16px_30px_rgba(15,23,42,0.16)] px-4 py-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-900 text-sm">{title}</h3>
        <span
          className="inline-flex items-center gap-1 text-[11px] px-3 py-0.5 rounded-full
                     bg-gradient-to-r from-sky-400 via-sky-300 to-purple-300
                     text-slate-900 font-semibold shadow-sm"
        >
          {done}/{total} complete
        </span>
      </div>

      <ul className="space-y-2">
        {items.map((it) => {
          const state = it.state;
          const label = it.label ?? "???";

          let dotCls =
            "bg-slate-100 border-slate-200 text-slate-400"; // default (missing)
          let symbol = "•";
          let textCls = "text-slate-700";

          if (state === "ok") {
            dotCls =
              "bg-emerald-400 border-emerald-500 text-emerald-950 shadow-sm shadow-emerald-300/70";
            symbol = "✓";
            textCls = "text-slate-900";
          } else if (state === "wrong_place") {
            dotCls =
              "bg-amber-300 border-amber-400 text-amber-900 shadow-sm shadow-amber-300/70";
            symbol = "–";
            textCls = "text-slate-800";
          }

          return (
            <li
              key={it.key}
              className="flex items-start gap-2 rounded-xl px-2 py-1 hover:bg-slate-50/80 transition-colors"
            >
              <span
                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${dotCls}`}
              >
                {symbol}
              </span>
              <span className={`${textCls} text-[13px]`}>{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
