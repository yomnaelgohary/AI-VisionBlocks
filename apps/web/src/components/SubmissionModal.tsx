"use client";

export default function SubmissionModal({
  open,
  onClose,
  dark = false,
  title,
  lines,
  success,
}: {
  open: boolean;
  onClose: () => void;
  dark?: boolean;
  title?: string;
  lines?: string[];
  success?: boolean;
}) {
  if (!open) return null;

  const isSuccess = success === true;
  const isError = success === false && title === "Error";

  const overlayBg = dark ? "bg-black/60" : "bg-slate-900/45";

  const cardBg = dark
    ? "from-slate-900/95 via-slate-900/90 to-slate-950"
    : "from-white/98 via-white/96 to-[#E3E7F5]";
  const cardBorder = dark ? "border-slate-700/70" : "border-white/80";
  const textMain = dark ? "text-slate-50" : "text-slate-900";
  const textSub = dark ? "text-slate-300" : "text-slate-600";

  const badgeBase =
    "inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border shadow-sm";

  const badgeCls = isSuccess
    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
    : isError
    ? "bg-rose-50 border-rose-200 text-rose-700"
    : "bg-sky-50 border-sky-200 text-sky-700";

  const iconBg = isSuccess
    ? "bg-gradient-to-br from-emerald-400 to-emerald-500 text-white"
    : isError
    ? "bg-gradient-to-br from-rose-400 to-rose-500 text-white"
    : "bg-gradient-to-br from-sky-400 to-sky-500 text-white";

  const iconGlow = isSuccess
    ? "shadow-[0_0_18px_rgba(16,185,129,0.75)]"
    : isError
    ? "shadow-[0_0_18px_rgba(239,68,68,0.75)]"
    : "shadow-[0_0_18px_rgba(56,189,248,0.75)]";

  const primaryBtnBase =
    "px-4 py-1.5 rounded-full text-sm font-semibold transition inline-flex items-center justify-center";

  const primaryBtnCls = isSuccess
    ? "bg-emerald-500 hover:bg-emerald-400 text-white shadow-md hover:shadow-[0_0_15px_rgba(16,185,129,0.7)]"
    : isError
    ? "bg-rose-500 hover:bg-rose-400 text-white shadow-md hover:shadow-[0_0_15px_rgba(239,68,68,0.7)]"
    : "bg-sky-500 hover:bg-sky-400 text-white shadow-md hover:shadow-[0_0_15px_rgba(56,189,248,0.7)]";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 ${overlayBg} backdrop-blur-sm transition-opacity`}
        onClick={onClose}
      />

      {/* Card */}
      <div
        className={`
          relative z-50 max-w-md w-[90%]
          rounded-3xl border ${cardBorder}
          bg-gradient-to-b ${cardBg}
          shadow-[0_22px_60px_rgba(15,23,42,0.45)]
          px-5 pt-5 pb-4
          animate-[fadeInUp_0.2s_ease-out]
        `}
      >
        {/* Icon + title row */}
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div
            className={`
              mt-1 h-10 w-10 rounded-2xl flex items-center justify-center
              ${iconBg} ${iconGlow}
            `}
          >
            {isSuccess ? (
              <span className="text-lg">✓</span>
            ) : isError ? (
              <span className="text-lg">!</span>
            ) : (
              <span className="text-lg">★</span>
            )}
          </div>

          {/* Title / subtitle */}
          <div className="flex-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className={`text-base font-semibold ${textMain}`}>
                {title || (isSuccess ? "Nice!" : "Heads up")}
              </h2>
              <span className={`${badgeBase} ${badgeCls}`}>
                {isSuccess ? "Mission 1" : "Feedback"}
              </span>
            </div>

            {isSuccess ? (
              <p className={`mt-1 text-xs ${textSub}`}>
                You wired the whole “learn to see” chain dataset, stats, and image views,
                in one clean line. That’s exactly what Module 1 was aiming for.
              </p>
            ) : (
              <p className={`mt-1 text-xs ${textSub}`}>
                Read the notes below, nudge a few blocks around, and try again. You’re
                closer than it looks.
              </p>
            )}
          </div>
        </div>

        {/* Body lines */}
        {lines && lines.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {lines.map((ln, idx) => (
              <div
                key={idx}
                className={`text-sm ${
                  isSuccess ? "text-emerald-900" : textSub
                } flex items-start gap-2`}
              >
                <span className="mt-1 inline-block h-1 w-1 rounded-full bg-slate-400/70" />
                <span>{ln}</span>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-5 flex items-center justify-end gap-2">
          {!isSuccess && (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-full text-xs font-medium text-slate-600 hover:bg-slate-100/80 border border-slate-200/80 transition"
            >
              I’ll adjust it
            </button>
          )}
          <button type="button" onClick={onClose} className={primaryBtnBase + " " + primaryBtnCls}>
            {isSuccess ? "Nice, got it" : isError ? "Close" : "Try again"}
          </button>
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
