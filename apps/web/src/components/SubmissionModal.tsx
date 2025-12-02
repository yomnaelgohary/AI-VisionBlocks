"use client";

type SubmissionModalProps = {
  open: boolean;
  onClose: () => void;
  dark?: boolean;
  title?: string;
  lines?: string[];
  success?: boolean;
};

export default function SubmissionModal({
  open,
  onClose,
  dark = false,
  title,
  lines,
  success,
}: SubmissionModalProps) {
  if (!open) return null;

  const isSuccess = success === true;
  // Treat anything with "error" in the title as a hard error, otherwise it's just feedback
  const isError = success === false && (title?.toLowerCase().includes("error") ?? false);

  const isDark = !!dark;

  // ----- Theming (unique palette for submission vs info) -----
  const overlayBg = isDark ? "bg-black/70" : "bg-slate-900/45";

  const haloGradient = isSuccess
    ? "from-emerald-400/70 via-emerald-500/60 to-teal-400/70"
    : isError
    ? "from-rose-400/70 via-orange-400/60 to-red-500/70"
    : "from-sky-400/75 via-indigo-400/65 to-cyan-400/75";

  const cardSurface = isDark
    ? "bg-slate-950/95"
    : "bg-gradient-to-b from-white/98 via-white/97 to-[#E5ECFF]";

  const cardBorder = isDark ? "border-slate-700/70" : "border-white/80";
  const textMain = isDark ? "text-slate-50" : "text-slate-900";
  const textSub = isDark ? "text-slate-300" : "text-slate-600";

  const badgeBase =
    "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border shadow-sm";

  const badgeCls = isSuccess
    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
    : isError
    ? "bg-rose-50 border-rose-200 text-rose-700"
    : "bg-sky-50 border-sky-200 text-sky-700";

  const iconBg = isSuccess
    ? "bg-emerald-500"
    : isError
    ? "bg-rose-500"
    : "bg-sky-500";

  const iconRing = isSuccess
    ? "shadow-[0_0_24px_rgba(16,185,129,0.85)]"
    : isError
    ? "shadow-[0_0_24px_rgba(239,68,68,0.85)]"
    : "shadow-[0_0_24px_rgba(56,189,248,0.85)]";

  const primaryBtnBase =
    "px-4 py-1.5 rounded-full text-sm font-semibold transition inline-flex items-center justify-center";

  const primaryBtnCls = isSuccess
    ? "bg-emerald-500 hover:bg-emerald-400 text-white shadow-md hover:shadow-[0_0_18px_rgba(16,185,129,0.8)]"
    : isError
    ? "bg-rose-500 hover:bg-rose-400 text-white shadow-md hover:shadow-[0_0_18px_rgba(239,68,68,0.8)]"
    : "bg-sky-500 hover:bg-sky-400 text-white shadow-md hover:shadow-[0_0_18px_rgba(56,189,248,0.8)]";

  const pillLabel = isSuccess ? "Stage complete" : isError ? "Run error" : "Stage feedback";

  const defaultTitle = isSuccess
    ? "You finished the stage!"
    : isError
    ? "Something went wrong while running"
    : "Keep tuning this stage";

  const bodyLead = isSuccess
    ? ""
    : isError
    ? "The backend hit an error. Check the notes below, fix anything obvious, and run the stage again."
    : "These notes tell you what still needs adjusting. Nudge a few blocks around and try another run.";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 ${overlayBg} backdrop-blur-md transition-opacity`}
        onClick={onClose}
      />

      {/* Card shell with glowing halo */}
      <div className="relative z-50 w-[92%] max-w-md mx-auto">
        {/* Halo / shine */}
        <div
          className={`
            pointer-events-none absolute inset-0 -inset-1
            rounded-[28px]
            bg-gradient-to-br ${haloGradient}
            opacity-70 blur-xl
          `}
          aria-hidden="true"
        />

        {/* Main card */}
        <div
          className={`
            relative rounded-3xl border ${cardBorder}
            ${cardSurface}
            shadow-[0_22px_60px_rgba(15,23,42,0.5)]
            px-5 pt-5 pb-4
            overflow-hidden
            animate-[fadeInUp_0.22s_ease-out]
          `}
        >
          {/* Subtle grid / shine overlay */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.08] bg-[radial-gradient(circle_at_top,_#ffffff_0,_transparent_55%)]"
            aria-hidden="true"
          />

          {/* Content */}
          <div className="relative">
            {/* Icon + title */}
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div
                className={`
                  mt-1 h-10 w-10 rounded-2xl flex items-center justify-center
                  ${iconBg} ${iconRing}
                  text-white text-lg
                `}
              >
                {isSuccess ? "✓" : isError ? "!" : "★"}
              </div>

              {/* Title & badge */}
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h2 className={`text-base font-semibold ${textMain}`}>
                    {title || defaultTitle}
                  </h2>
                  <span className={`${badgeBase} ${badgeCls}`}>{pillLabel}</span>
                </div>

                {bodyLead && (
                  <p className={`mt-1 text-xs leading-relaxed ${textSub}`}>{bodyLead}</p>
                )}
              </div>

              {/* Close pill (top-right) */}
              <button
                onClick={onClose}
                aria-label="Close submission details"
                className={`
                  ml-1 rounded-full px-2 py-0.5 text-[11px] font-medium
                  border border-slate-200/60
                  bg-white/80 text-slate-600
                  hover:bg-white
                  shadow-sm
                  transition
                `}
              >
                Close
              </button>
            </div>

            {/* Lines body */}
            {lines && lines.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {lines.map((ln, idx) => (
                  <div
                    key={idx}
                    className={`text-sm flex items-start gap-2 ${
                      isSuccess ? "text-emerald-900" : textSub
                    }`}
                  >
                    <span
                      className={`
                        mt-1 inline-block h-1.5 w-1.5 rounded-full
                        ${
                          isSuccess
                            ? "bg-emerald-400/80"
                            : isError
                            ? "bg-rose-400/80"
                            : "bg-sky-400/80"
                        }
                      `}
                    />
                    <span>{ln}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Footer */}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className={
                  isSuccess
                    ? primaryBtnBase + " " + primaryBtnCls
                    : primaryBtnBase + " " + primaryBtnCls
                }
              >
                {isSuccess ? "Nice, got it" : "I'll adjust it"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
