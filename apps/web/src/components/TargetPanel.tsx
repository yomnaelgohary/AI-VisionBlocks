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
  const header = dark ? "text-neutral-100" : "text-gray-900";
  const sub = dark ? "text-neutral-400" : "text-gray-600";
  const card = dark ? "border-neutral-800 bg-neutral-900/50" : "border-gray-200 bg-white";

  return (
    <div className={`rounded-xl border p-3 ${card}`}>
      <h3 className={`font-semibold ${header}`}>Target vs Current</h3>
      <p className={`text-sm mt-1 ${sub}`}>Make your output match the target.</p>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <figure>
          <img src={targetSrc || ""} alt="target" className="w-full rounded-md border border-black/10" />
          <figcaption className={`text-xs mt-1 ${sub}`}>Target</figcaption>
        </figure>
        <figure>
          <img src={currentSrc || ""} alt="current" className="w-full rounded-md border border-black/10" />
          <figcaption className={`text-xs mt-1 ${sub}`}>Your current result</figcaption>
        </figure>
      </div>
    </div>
  );
}
