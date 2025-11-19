"use client";
import React from "react";

export default function TargetPanel({
  targetSrc,
  currentSrc,
  dark = false,
}: {
  targetSrc?: string;
  currentSrc?: string;
  dark?: boolean;
}) {
  const isDark = !!dark;
  const header = isDark ? "text-neutral-100" : "text-slate-900";
  const sub = isDark ? "text-neutral-400" : "text-slate-600";
  const card = isDark
    ? "border-neutral-800 bg-neutral-900/60"
    : "border-slate-200/80 bg-gradient-to-b from-slate-50/90 via-white/95 to-slate-50/85";

  return (
    <div
      className={`
        rounded-2xl border px-3 py-3 md:px-4 md:py-4 ${card}
        shadow-[0_14px_32px_rgba(15,23,42,0.16)]
      `}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className={`font-semibold text-sm ${header}`}>Target vs current</h3>
          <p className={`text-xs mt-0.5 ${sub}`}>
            Adjust your pipeline until both images match in structure.
          </p>
        </div>
        <span className="hidden sm:inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] bg-sky-50 text-sky-700 border border-sky-100">
          Visual goal
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <figure className="rounded-xl bg-white/80 border border-slate-200/80 p-2 shadow-sm">
          <div className="aspect-square w-full overflow-hidden rounded-lg bg-slate-100 flex items-center justify-center">
            {targetSrc ? (
              <img
                src={targetSrc}
                alt="target"
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-[11px] text-slate-400 px-2 text-center">
                Run your blocks to see the target.
              </span>
            )}
          </div>
          <figcaption className={`text-xs mt-1.5 ${sub}`}>Target</figcaption>
        </figure>

        <figure className="rounded-xl bg-white/80 border border-slate-200/80 p-2 shadow-sm">
          <div className="aspect-square w-full overflow-hidden rounded-lg bg-slate-100 flex items-center justify-center">
            {currentSrc ? (
              <img
                src={currentSrc}
                alt="current"
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-[11px] text-slate-400 px-2 text-center">
                Your current result will show up here.
              </span>
            )}
          </div>
          <figcaption className={`text-xs mt-1.5 ${sub}`}>Your current result</figcaption>
        </figure>
      </div>
    </div>
  );
}
