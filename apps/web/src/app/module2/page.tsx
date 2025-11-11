"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight, BookOpen, Rocket } from "lucide-react";

export default function Module2Index() {
  const [dark, setDark] = useState(true);

  const stages = [
    { id: "1", title: "Stage 1: Grayscaling" },
    { id: "2", title: "Stage 2: Resizing" },
    { id: "3", title: "Stage 3: Padding" },
    { id: "4", title: "Stage 4: Brightness & Contrast" },
    { id: "5", title: "Stage 5: Blurring & Sharpening" },
    { id: "6", title: "Stage 6: Normalization" },
    { id: "7", title: "Stage 7: Looping & Exporting" },
    { id: "bonus", title: "Bonus: Edge Detection" },
  ];

  const appBg = dark ? "bg-neutral-950 text-neutral-100" : "bg-white text-gray-900";
  const cardBg = dark ? "bg-neutral-900 border-neutral-800" : "bg-white border-gray-200";
  const subText = dark ? "text-neutral-400" : "text-gray-600";

  return (
    <div className={`min-h-screen ${appBg} transition-colors`}>
      {/* Header */}
      <div className="px-8 py-10 border-b border-neutral-800 text-center">
        <h1 className="text-4xl font-bold mb-3">Module 2: Preprocessing Like a Pro</h1>
        <p className={`${subText} max-w-2xl mx-auto text-base`}>
          Learn how images are prepared before training a model, step by step.
          Each stage introduces a key building block in machine learning vision pipelines.
        </p>

        <button
          onClick={() => setDark((d) => !d)}
          className={`mt-5 px-4 py-1.5 rounded-md border text-sm ${
            dark
              ? "border-neutral-700 text-neutral-200 hover:bg-neutral-800"
              : "border-gray-300 text-gray-800 hover:bg-gray-50"
          }`}
        >
          Toggle {dark ? "Light" : "Dark"} Mode
        </button>
      </div>

      {/* Stage grid */}
      <div className="px-8 py-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
        {stages.map((s, i) => (
          <motion.div
            key={s.id}
            whileHover={{ scale: 1.02 }}
            className={`rounded-2xl border p-5 flex flex-col justify-between shadow-sm ${cardBg}`}
          >
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    dark ? "bg-neutral-800" : "bg-gray-100"
                  }`}
                >
                  {i === stages.length - 1 ? (
                    <Rocket className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <BookOpen className="w-5 h-5 text-blue-400" />
                  )}
                </div>
                <h2 className="font-semibold text-lg">{s.title}</h2>
              </div>
              <p className={`${subText} text-sm mb-4`}>
                {i === stages.length - 1
                  ? "Put everything you learned into practice. Build your own preprocessing pipeline!"
                  : "Learn and practice a new preprocessing skill before moving on to the next."}
              </p>
            </div>

            <Link
              href={`/module2/${s.id}`}
              className={`flex items-center justify-center gap-2 mt-2 py-2 rounded-md font-medium transition ${
                dark
                  ? "bg-blue-600 hover:bg-blue-500 text-white"
                  : "bg-blue-500 hover:bg-blue-600 text-white"
              }`}
            >
              Start {s.id === "bonus" ? "Bonus Stage" : `Stage ${s.id}`}
              <ChevronRight className="w-4 h-4" />
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
