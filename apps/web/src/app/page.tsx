"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronRight, BookOpen, Layers, Split, Brain } from "lucide-react";

export default function HomePage() {
  const modules = [
    {
      id: "1",
      title: "Module 1: Learn to See",
      desc: "Meet Baymax and explore images, labels, and RGB channels.",
      href: "/module1",
      icon: <BookOpen className="w-5 h-5 text-sky-500" />,
      tag: "Start here",
    },
    {
      id: "2",
      title: "Module 2: Image Preprocessing",
      desc: "Resize, crop, pad, normalize, and prepare images for learning.",
      href: "/module2",
      icon: <Layers className="w-5 h-5 text-purple-500" />,
      tag: "Core skills",
    },
    {
      id: "3",
      title: "Module 3: Splitting & Bias",
      desc: "Create train/test splits and inspect dataset balance and bias.",
      href: "/module3",
      icon: <Split className="w-5 h-5 text-sky-500" />,
      tag: "Data science",
    },
    {
      id: "4",
      title: "Module 4: Model",
      desc: "Build a small CNN with blocks, train it, and evaluate predictions.",
      href: "/module4",
      icon: <Brain className="w-5 h-5 text-purple-500" />,
      tag: "Modeling",
    },
  ];

  return (
    <div className="relative min-h-screen w-full overflow-hidden animated-bg">
      {/* TOP NAV – aligned with Module 2 styling */}
      <header className="w-full backdrop-blur-xl bg-white/55 border-b border-white/60 fixed top-0 left-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-gray-800">
              VisionBlocks
            </span>
            <span className="text-xs text-gray-500">
              Block-based computer vision playground
            </span>
          </div>

          <nav className="flex items-center gap-4 text-sm font-medium text-gray-700">
            <Link
              href="/"
              className="px-3 py-1 rounded-full bg-sky-500 text-white shadow-sm hover:bg-sky-400 transition"
            >
              Home
            </Link>
            <Link href="/module1" className="hover:text-sky-500 transition">
              M1
            </Link>
            <Link href="/module2" className="hover:text-sky-500 transition">
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
      <main className="pt-32 pb-24 px-6 max-w-7xl mx-auto">
        {/* Intro pill */}
        <div className="mb-4">
          <span className="px-3 py-1 text-xs rounded-full bg-white/75 border border-white/80 text-gray-700 shadow-sm">
            ● Learn computer vision, one mission at a time
          </span>
        </div>

        {/* Hero */}
        <h1 className="text-5xl md:text-6xl font-extrabold leading-tight text-gray-800">
          Build vision pipelines visually,
          <br />
          <span className="bg-gradient-to-r from-sky-500 via-sky-400 to-purple-400 bg-clip-text text-transparent">
            and see what the model sees.
          </span>
        </h1>

        <p className="text-gray-600 mt-4 text-lg max-w-3xl">
          Explore datasets, preprocess images, split data, and train models, all
          using drag-and-drop blocks instead of code.
        </p>

        {/* MODULE CARDS – styled like Module 2’s stage tiles */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mt-16">
          {modules.map((mod) => (
            <motion.div
              key={mod.id}
              whileHover={{ y: -8 }}
              whileTap={{ scale: 0.98 }}
              className="relative group"
            >
              {/* Soft glow behind card */}
              <div className="absolute inset-0 -z-10 opacity-0 group-hover:opacity-80 transition-opacity duration-300">
                <div className="h-full w-full rounded-3xl blur-2xl bg-sky-300/50" />
              </div>

              <Link
                href={mod.href}
                className={`
                  module-card
                  block rounded-3xl border border-white/80
                  bg-gradient-to-b from-sky-200/70 via-purple-100/60 to-white/85
                  shadow-[0_18px_45px_rgba(15,23,42,0.18)]
                  px-5 py-6 h-full
                  transition-all duration-200
                  group-hover:shadow-[0_22px_55px_rgba(15,23,42,0.28)]
                  group-hover:border-sky-200
                `}
              >
                {/* Top: icon + title + tag */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-2xl bg-white/85 shadow-sm flex items-center justify-center">
                      {mod.icon}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">
                        {mod.title}
                      </h3>
                      <p className="text-[11px] text-gray-500">
                        {mod.tag}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Description */}
                <p className="text-sm text-gray-700 mt-1 min-h-[60px]">
                  {mod.desc}
                </p>

                {/* CTA row */}
                <div className="mt-4 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">
                    Click to jump into this mission.
                  </span>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-sky-600 group-hover:text-sky-700">
                    Start
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
              </Link>
            </motion.div>
          ))}
        </section>
      </main>

      {/* GLOBAL CSS */}
      <style jsx global>{`
        /* ----------------------------- */
        /* DYNAMIC BACKGROUND ANIMATION */
        /* ----------------------------- */

        .animated-bg {
          background: radial-gradient(circle at 20% 20%, #4ba3e480, transparent 65%),
            radial-gradient(circle at 80% 20%, #8b6ff680, transparent 65%),
            radial-gradient(circle at 50% 85%, #b7bccb, #d0d4df);
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

        /* ----------------------------- */
        /* MODULE CARD GLOSS OVERLAY     */
        /* ----------------------------- */

        .module-card {
          position: relative;
          overflow: hidden;
        }

        .module-card::before {
          content: "";
          position: absolute;
          inset: -20%;
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.28),
            rgba(255, 255, 255, 0.06)
          );
          opacity: 0;
          pointer-events: none;
          transition: opacity 160ms ease-out;
        }

        .module-card:hover::before {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}
