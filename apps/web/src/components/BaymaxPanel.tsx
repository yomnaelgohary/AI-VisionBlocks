"use client";

type BaymaxMood = "neutral" | "hint" | "warning" | "success" | "error";

export default function BaymaxPanel({
  line,
  dark = false,
  mood = "neutral",
  typing = false,
}: {
  line: string;
  dark?: boolean;
  mood?: BaymaxMood;
  typing?: boolean;
}) {
  const titleCls = dark ? "text-neutral-100" : "text-slate-900";

  let bubbleBase =
    "rounded-2xl px-4 py-3 border text-sm leading-relaxed shadow-md text-center transition-all";
  let bubbleTheme = "";
  let bubbleAnim = "";

  if (dark) {
    switch (mood) {
      case "success":
        bubbleTheme = "bg-emerald-900/40 border-emerald-500 text-emerald-200";
        bubbleAnim = "baymax-glow";
        break;
      case "warning":
        bubbleTheme = "bg-amber-900/40 border-amber-500 text-amber-200";
        bubbleAnim = "baymax-shake";
        break;
      case "error":
        bubbleTheme = "bg-rose-900/40 border-rose-500 text-rose-200";
        bubbleAnim = "baymax-shake";
        break;
      case "hint":
        bubbleTheme = "bg-sky-900/40 border-sky-500 text-sky-200";
        break;
      default:
        bubbleTheme = "bg-slate-900/60 border-slate-600 text-slate-100";
        break;
    }
  } else {
    switch (mood) {
      case "success":
        bubbleTheme = "bg-emerald-50 border-emerald-300 text-emerald-800";
        bubbleAnim = "baymax-glow";
        break;
      case "warning":
        bubbleTheme = "bg-amber-50 border-amber-300 text-amber-900";
        bubbleAnim = "baymax-shake";
        break;
      case "error":
        bubbleTheme = "bg-rose-50 border-rose-300 text-rose-900";
        bubbleAnim = "baymax-shake";
        break;
      case "hint":
        bubbleTheme = "bg-sky-50 border-sky-200 text-sky-900";
        break;
      default:
        bubbleTheme = "bg-white/85 border-slate-200 text-slate-900";
        break;
    }
  }

  const hintCls = dark ? "text-neutral-400" : "text-slate-500";

  return (
    <div className="flex flex-col gap-3">
      {/* Heading */}
      <h2 className={`text-sm font-semibold tracking-wide ${titleCls}`}>Baymax</h2>

      {/* Avatar + speech inline in panel */}
      <div className="flex items-center gap-3">
        {/* Baymax avatar */}
        <div className="shrink-0 flex items-center justify-center">
          <img
            src="/baymax.png"
            alt="Baymax"
            className="w-20 h-20 object-contain select-none drop-shadow-xl"
            draggable={false}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src =
                "data:image/svg+xml;utf8," +
                encodeURIComponent(
                  `<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'>
                     <rect width='100%' height='100%' fill='#E5E7EB'/>
                     <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle'
                           font-size='11' fill='#6B7280'>Add /public/baymax.png</text>
                   </svg>`
                );
            }}
          />
        </div>

        {/* Speech bubble */}
        <div className="flex-1 flex flex-col gap-1">
          <div className={`${bubbleBase} ${bubbleTheme} ${bubbleAnim}`}>
            <span>{line}</span>
            {typing && (
              <div className="mt-2 flex items-center justify-center gap-1 text-xs opacity-80">
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:120ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:240ms]" />
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes baymaxGlow {
          0% {
            box-shadow: 0 0 0 0 rgba(45, 212, 191, 0.0);
          }
          50% {
            box-shadow: 0 0 18px 0 rgba(45, 212, 191, 0.8);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(45, 212, 191, 0.0);
          }
        }
        @keyframes baymaxShake {
          0%,
          100% {
            transform: translateX(0);
          }
          20% {
            transform: translateX(-1.5px);
          }
          40% {
            transform: translateX(1.5px);
          }
          60% {
            transform: translateX(-1px);
          }
          80% {
            transform: translateX(1px);
          }
        }
        .baymax-glow {
          animation: baymaxGlow 2s ease-in-out infinite;
        }
        .baymax-shake {
          animation: baymaxShake 0.3s ease-in-out 0s 1;
        }
      `}</style>
    </div>
  );
}
