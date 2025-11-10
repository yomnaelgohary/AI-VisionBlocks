"use client";
import React from "react";

export type Tri = "missing" | "wrong_place" | "ok";

export type StageChecklistItem = {
  key: string;                 // stable key (e.g., "m2.to_grayscale")
  label?: string;              // if provided; otherwise show "???"
  state: Tri;                  // missing / wrong_place (–) / ok (✓)
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
  const done = items.filter(i => i.state === "ok").length;

  const pillBase = "text-xs px-2 py-0.5 rounded";
  const header = dark ? "text-neutral-100" : "text-gray-900";
  const card = dark ? "border-neutral-800 bg-neutral-900/50" : "border-gray-200 bg-white";

  return (
    <div className={`rounded-xl border px-3 py-3 ${card}`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className={`font-semibold ${header}`}>{title}</h3>
        <span className={`${pillBase} ${dark ? "bg-neutral-800 text-neutral-300" : "bg-gray-100 text-gray-700"}`}>
          {done}/{items.length} complete
        </span>
      </div>

      <ul className="space-y-2">
        {items.map((it) => {
          const state = it.state;
          const dotCls =
            state === "ok"
              ? dark ? "bg-green-600 border-green-700 text-white" : "bg-green-500 border-green-300 text-white"
              : state === "wrong_place"
              ? dark ? "bg-amber-600 border-amber-700 text-white" : "bg-amber-400 border-amber-300 text-black"
              : dark ? "bg-neutral-800 border-neutral-700 text-neutral-400" : "bg-white border-gray-300 text-gray-400";

          const symbol = state === "ok" ? "✓" : state === "wrong_place" ? "–" : "•";
          const label = it.label ?? "???";

          return (
            <li key={it.key} className="flex items-start gap-2">
              <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${dotCls}`}>
                {symbol}
              </span>
              <span className={dark ? "text-neutral-200" : "text-gray-800"}>{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
