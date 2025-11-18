"use client";

import Link from "next/link";

export default function DrawerNav({
  open,
  onClose,
  dark = true,
}: {
  open: boolean;
  onClose: () => void;
  dark?: boolean;
}) {
  const panelBg = dark
    ? "bg-neutral-900 border-neutral-800"
    : "bg-white border-slate-200";
  const textMain = dark ? "text-neutral-100" : "text-slate-900";
  const textSub = dark ? "text-neutral-400" : "text-slate-600";
  const hover = dark ? "hover:bg-neutral-800" : "hover:bg-slate-100";

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 transition ${
          open
            ? "bg-black/40 pointer-events-auto"
            : "bg-black/0 pointer-events-none"
        }`}
        aria-hidden
      />
      {/* Panel */}
      <aside
        className={`fixed top-0 left-0 h-full w-72 border-r ${panelBg} transform transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
      >
        <div className="p-4 border-b border-neutral-800/30 border-slate-200/70">
          <div className={`text-lg font-semibold ${textMain}`}>VisionBlocks</div>
          <div className={`text-xs ${textSub}`}>Pick a mission</div>
        </div>

        <nav className="p-2">
          <Link
            href="/"
            className={`block px-3 py-2 rounded-md ${hover} ${textMain}`}
            onClick={onClose}
          >
            Home
          </Link>

          <div
            className={`mt-3 mb-1 px-3 text-xs uppercase tracking-wide ${textSub}`}
          >
            Modules
          </div>

          <Link
            href="/module1"
            className={`block px-3 py-2 rounded-md ${hover} ${textMain}`}
            onClick={onClose}
          >
            Module 1 — Learn to See
          </Link>

          <Link
            href="/module2"
            className={`block px-3 py-2 rounded-md ${hover} ${textMain}`}
            onClick={onClose}
          >
            Module 2 — Image Preprocessing
          </Link>

          <Link
            href="/module3"
            className={`block px-3 py-2 rounded-md ${hover} ${textMain}`}
            onClick={onClose}
          >
            Module 3 — Splitting & Bias
          </Link>

          <Link
            href="/module4"
            className={`block px-3 py-2 rounded-md ${hover} ${textMain}`}
            onClick={onClose}
          >
            Module 4 — Model
          </Link>
        </nav>
      </aside>
    </>
  );
}
