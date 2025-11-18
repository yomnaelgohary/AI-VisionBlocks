"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronRight, BookOpen, Rocket } from "lucide-react";

export default function Module2Index() {
  const stages = [
    { id: "1", title: "Stage 1: Grayscaling", short: "Turn color images into simpler grayscale versions." },
    { id: "2", title: "Stage 2: Resizing", short: "Make every image roughly the same size so models don’t freak out." },
    { id: "3", title: "Stage 3: Padding", short: "Add borders so images fit a target size without stretching." },
    { id: "4", title: "Stage 4: Brightness & Contrast", short: "Fix images that are too dark, too bright, or too flat." },
    { id: "5", title: "Stage 5: Blurring & Sharpening", short: "Smooth out noise or sharpen edges to highlight structure." },
    { id: "6", title: "Stage 6: Normalization", short: "Scale pixel values so the model learns faster and more stably." },
    { id: "7", title: "Stage 7: Looping & Exporting", short: "Apply your pipeline to the whole dataset and save a new one." },
    { id: "bonus", title: "Bonus: Edge Detection", short: "Use edge filters to see outlines and structure in images." },
  ];

  return (
    <div className="relative min-h-screen w-full overflow-hidden animated-bg">
      {/* TOP NAV – same style as home, with Module 2 highlight */}
      <header className="w-full backdrop-blur-xl bg-white/50 border-b border-white/50 fixed top-0 left-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-gray-800">VisionBlocks</span>
            <span className="text-xs text-gray-500">
              Module 2 · Image preprocessing missions
            </span>
          </div>

          <nav className="flex items-center gap-4 text-sm font-medium text-gray-700">
            <Link href="/" className="px-3 py-1 rounded-full hover:bg-white/70 hover:text-sky-600 transition">
              Home
            </Link>
            <Link href="/module1" className="hover:text-sky-500 transition">
              M1
            </Link>
            <Link
              href="/module2"
              className="px-3 py-1 rounded-full bg-sky-500 text-white shadow-sm hover:bg-sky-400 transition"
            >
              M2
            </Link>
            <Link href="/module3" className="hover:text-sky-500 transition">
              M3
            </Link>
            <Link href="/module4" className="hover:text-sky-500 transition">
              M4
            </Link>
          </nav>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="pt-28 pb-24 px-6 max-w-7xl mx-auto">
        {/* Intro pill */}
        <div className="mb-4">
          <span className="px-3 py-1 text-xs rounded-full bg-white/70 border border-white/80 text-gray-700 shadow-sm">
            ● Build a preprocessing pipeline, one block at a time
          </span>
        </div>

        {/* Title + subtitle */}
        <h1 className="text-4xl md:text-5xl font-extrabold leading-tight text-gray-800">
          Learn how models see,
          <br />
          <span className="bg-gradient-to-r from-sky-500 via-sky-400 to-purple-400 bg-clip-text text-transparent">
            by shaping every pixel first.
          </span>
        </h1>

        <p className="text-gray-600 mt-4 text-base md:text-lg max-w-3xl">
          In Module 2, you’ll practice each preprocessing idea in its own mini-mission. 
          By the end, you’ll be able to build a full pipeline that prepares a dataset 
          for training, and export your own processed dataset for later modules.
        </p>

        {/* Stage grid */}
        <section className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 mb-10">
          {stages.map((stage, index) => {
            const isBonus = stage.id === "bonus";
            const icon = isBonus ? (
              <Rocket className="w-5 h-5 text-purple-500" />
            ) : (
              <BookOpen className="w-5 h-5 text-sky-500" />
            );

            const gradientBg = isBonus
              ? "from-purple-200/70 via-sky-100/60 to-white/80"
              : "from-sky-200/70 via-purple-100/60 to-white/80";

            return (
              <motion.div
                key={stage.id}
                whileHover={{ y: -8 }}
                whileTap={{ scale: 0.98 }}
                className="relative group"
              >
                {/* Soft glow behind card */}
                <div className="absolute inset-0 -z-10 opacity-0 group-hover:opacity-80 transition-opacity duration-300">
                  <div
                    className={`
                      h-full w-full rounded-3xl blur-2xl
                      ${isBonus ? "bg-purple-300/50" : "bg-sky-300/50"}
                    `}
                  />
                </div>

                <Link
                  href={`/module2/${stage.id}`}
                  className={`
                    block rounded-3xl border border-white/80 bg-gradient-to-b ${gradientBg}
                    shadow-[0_18px_45px_rgba(15,23,42,0.16)]
                    px-5 py-5 h-full
                    transition-all duration-200
                    group-hover:shadow-[0_22px_55px_rgba(15,23,42,0.24)]
                    group-hover:border-sky-200
                  `}
                >
                  {/* Top row: icon + label */}
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-2xl bg-white/80 shadow-sm flex items-center justify-center">
                        {icon}
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-gray-900">
                          {stage.title}
                        </h2>
                        <p className="text-[11px] text-gray-500">
                          {isBonus ? "Challenge mission" : `Core stage ${index + 1}`}
                        </p>
                      </div>
                    </div>

                    {isBonus && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">
                        Bonus
                      </span>
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-sm text-gray-700 mt-1 min-h-[60px]">
                    {stage.short}
                  </p>

                  {/* CTA row */}
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-xs text-gray-500">
                        {isBonus
                          ? "Try after Stage 7"
                          : "Recommended order: do them in sequence"}
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-sky-600 group-hover:text-sky-700">
                      Start {isBonus ? "bonus stage" : `stage ${stage.id}`}
                      <ChevronRight className="w-4 h-4" />
                    </span>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </section>

        {/* Small footer hint */}
        <p className="text-xs text-gray-500 mt-4">
          Tip: You can always come back here to replay any stage or jump straight to the bonus
          once you’re comfortable with the main pipeline.
        </p>
      </main>

      {/* Global background animation (shared with home style) */}
      <style jsx global>{`
        .animated-bg {
          background: radial-gradient(circle at 20% 20%, #4BA3E480, transparent 65%),
                      radial-gradient(circle at 80% 20%, #8B6FF680, transparent 65%),
                      radial-gradient(circle at 50% 85%, #BDC2D0, #D0D4DF);
          background-size: 200% 200%;
          animation: hueShift 18s ease-in-out infinite alternate;
        }

        @keyframes hueShift {
          0% {
            background-position: 0% 30%;
          }
          50% {
            background-position: 50% 70%;
          }
          100% {
            background-position: 100% 40%;
          }
        }
      `}</style>
    </div>
  );
}
