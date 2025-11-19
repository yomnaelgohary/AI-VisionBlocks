"use client";

type InfoModalProps = {
  open: boolean;
  title?: string;
  text?: string;
  onClose: () => void;
  dark?: boolean;
};

export default function InfoModal({ open, title, text, onClose, dark }: InfoModalProps) {
  if (!open) return null;

  const isDark = !!dark;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      aria-modal="true"
      role="dialog"
    >
      {/* backdrop */}
      <div
        className={`absolute inset-0 ${
          isDark ? "bg-black/70" : "bg-slate-900/40"
        } backdrop-blur-sm`}
        onClick={onClose}
      />

      {/* card */}
      <div
        className={`
          relative mx-4 w-full max-w-lg rounded-3xl p-5 md:p-6
          shadow-[0_22px_60px_rgba(15,23,42,0.45)]
          border
          ${
            isDark
              ? "bg-neutral-900/95 border-neutral-700 text-neutral-100"
              : "bg-slate-50/95 border-white/80 backdrop-blur-xl text-slate-900"
          }
        `}
      >
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-lg font-semibold">
            {title || "What does this block do?"}
          </h3>
          <button
            onClick={onClose}
            className={`
              rounded-full px-3 py-1 text-xs font-medium
              ${
                isDark
                  ? "bg-neutral-800 text-neutral-100 hover:bg-neutral-700"
                  : "bg-white/90 text-slate-700 border border-slate-200 hover:bg-slate-100"
              }
              transition
            `}
            aria-label="Close"
          >
            Close
          </button>
        </div>

        <p
          className={`
            mt-3 text-sm leading-relaxed
            ${isDark ? "text-neutral-200" : "text-slate-700"}
          `}
        >
          {text}
        </p>
      </div>
    </div>
  );
}
