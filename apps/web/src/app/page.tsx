"use client";

import { useState } from "react";
import Link from "next/link";
import DrawerNav from "@/components/DrawerNav";

export default function HomePage() {
  const [dark, setDark] = useState(true);
  const [open, setOpen] = useState(false);

  const appBg = dark ? "bg-neutral-950" : "bg-white";
  const barBg = dark ? "bg-neutral-900 border-neutral-800" : "bg-white border-gray-200";
  const barText = dark ? "text-neutral-100" : "text-gray-900";
  const cardBg = dark ? "bg-neutral-900 border-neutral-800" : "bg-white border-gray-200";
  const subText = dark ? "text-neutral-400" : "text-gray-600";

  return (
    <div className={`h-screen w-screen ${appBg} grid grid-rows-[48px_1fr]`}>
      {/* Top bar */}
      <div className={`flex items-center justify-between px-3 border-b ${barBg}`}>
        <div className={`font-semibold ${barText}`}>VisionBlocks</div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setDark(!dark)}
            className={`px-3 py-1.5 rounded-md border ${
              dark
                ? "border-neutral-700 text-neutral-200 hover:bg-neutral-800"
                : "border-gray-300 text-gray-800 hover:bg-gray-50"
            }`}
            title="Toggle dark mode"
          >
            {dark ? "Light" : "Dark"}
          </button>
          <button
            onClick={() => setOpen(true)}
            className={`px-3 py-1.5 rounded-md border ${
              dark
                ? "border-neutral-700 text-neutral-200 hover:bg-neutral-800"
                : "border-gray-300 text-gray-800 hover:bg-gray-50"
            }`}
            title="Open menu"
          >
            Menu
          </button>
        </div>
      </div>

      {/* Content */}
      <main className="p-6">
        <h1 className={`text-2xl font-bold ${barText}`}>Welcome to VisionBlocks</h1>
        <p className={`mt-2 ${subText}`}>Pick any module to begin.</p>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Link href="/module1" className={`rounded-xl border ${cardBg} p-4 hover:opacity-95`}>
            <div className={`${barText} text-lg font-semibold`}>Module 1: Learn to See</div>
            <p className={`${subText} mt-1 text-sm`}>
              Meet Baymax and explore images, labels, and channels.
            </p>
          </Link>

          <Link href="/module2" className={`rounded-xl border ${cardBg} p-4 hover:opacity-95`}>
            <div className={`${barText} text-lg font-semibold`}>Module 2: Image Preprocessing</div>
            <p className={`${subText} mt-1 text-sm`}>
              Resize, normalize, and prepare images for learning.
            </p>
          </Link>

          <Link href="/module3" className={`rounded-xl border ${cardBg} p-4 hover:opacity-95`}>
            <div className={`${barText} text-lg font-semibold`}>Module 3: Splitting & Bias</div>
            <p className={`${subText} mt-1 text-sm`}>
              Create a train/test split, check training-set bias, and balance classes.
            </p>
          </Link>
        </div>
      </main>

      <DrawerNav open={open} onClose={() => setOpen(false)} dark={dark} />
    </div>
  );
}
