"use client";

type HintMood = "thinking" | "hint" | "warning" | "success" | "error" | "idle";

export default function PixelwiseCharacter({
  message = "",
  mood = "idle",
  loading = false,
}: {
  message?: string;
  mood?: HintMood;
  loading?: boolean;
}) {
  // Determine character expression and colors based on mood
  const getMoodStyle = () => {
    switch (mood) {
      case "thinking":
        return {
          eyeColor: "fill-amber-400",
          auraGlow: "shadow-[0_0_25px_rgba(251,191,36,0.6)]",
          bubbleBg: "bg-amber-50 border-amber-300",
          bubbleText: "text-amber-900",
        };
      case "hint":
        return {
          eyeColor: "fill-sky-400",
          auraGlow: "shadow-[0_0_20px_rgba(56,189,248,0.5)]",
          bubbleBg: "bg-sky-50 border-sky-300",
          bubbleText: "text-sky-900",
        };
      case "warning":
        return {
          eyeColor: "fill-orange-500",
          auraGlow: "shadow-[0_0_20px_rgba(249,115,22,0.5)]",
          bubbleBg: "bg-orange-50 border-orange-300",
          bubbleText: "text-orange-900",
        };
      case "success":
        return {
          eyeColor: "fill-emerald-400",
          auraGlow: "shadow-[0_0_30px_rgba(16,185,129,0.6)]",
          bubbleBg: "bg-emerald-50 border-emerald-300",
          bubbleText: "text-emerald-900",
        };
      case "error":
        return {
          eyeColor: "fill-rose-400",
          auraGlow: "shadow-[0_0_20px_rgba(244,63,94,0.5)]",
          bubbleBg: "bg-rose-50 border-rose-300",
          bubbleText: "text-rose-900",
        };
      default:
        return {
          eyeColor: "fill-indigo-400",
          auraGlow: "shadow-[0_0_15px_rgba(99,102,241,0.4)]",
          bubbleBg: "bg-white border-indigo-200",
          bubbleText: "text-slate-800",
        };
    }
  };

  const style = getMoodStyle();
  const isThinking = loading || mood === "thinking";

  return (
    <div className="rounded-3xl border-2 border-indigo-200 bg-gradient-to-br from-white via-indigo-50/70 to-purple-50/60 p-5 shadow-lg">
      {/* Character + Speech Bubble Container */}
      <div className="flex gap-4 items-start">
        {/* Pixelwise Character */}
        <div className="shrink-0">
          <div
            className={`relative w-24 h-24 rounded-2xl transition-all ${style.auraGlow} ${
              isThinking ? "animate-pulse" : ""
            }`}
            style={{
              background: `linear-gradient(135deg, #c7d2fe 0%, #e9d5ff 50%, #fce7f3 100%)`,
            }}
          >
            {/* Main body with flowing shapes */}
            <svg
              viewBox="0 0 100 100"
              className="w-full h-full"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Outer flowing aura */}
              <defs>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                </filter>
              </defs>

              {/* Core circular body */}
              <circle
                cx="50"
                cy="50"
                r="30"
                fill="url(#bodyGradient)"
                opacity="0.95"
              />
              <defs>
                <radialGradient id="bodyGradient">
                  <stop offset="0%" stopColor="#e0e7ff" />
                  <stop offset="100%" stopColor="#c4b5fd" />
                </radialGradient>
              </defs>

              {/* Floating data particles around body */}
              <circle cx="30" cy="25" r="3" fill="#818cf8" opacity="0.7" />
              <circle cx="70" cy="28" r="2.5" fill="#a78bfa" opacity="0.6" />
              <circle cx="75" cy="50" r="2" fill="#c4b5fd" opacity="0.5" />
              <circle cx="72" cy="72" r="3" fill="#818cf8" opacity="0.7" />
              <circle cx="28" cy="75" r="2.5" fill="#a78bfa" opacity="0.6" />
              <circle cx="20" cy="50" r="2" fill="#c4b5fd" opacity="0.5" />

              {/* Eyes with expression */}
              <circle
                cx="40"
                cy="45"
                r="5"
                fill="white"
                stroke="#e0e7ff"
                strokeWidth="0.5"
              />
              <circle
                cx="60"
                cy="45"
                r="5"
                fill="white"
                stroke="#e0e7ff"
                strokeWidth="0.5"
              />

              {/* Pupils (responsive to mood) */}
              <circle
                cx={isThinking ? "38" : "42"}
                cy={isThinking ? "43" : "46"}
                r="2.5"
                className={style.eyeColor}
              />
              <circle
                cx={isThinking ? "58" : "62"}
                cy={isThinking ? "43" : "46"}
                r="2.5"
                className={style.eyeColor}
              />

              {/* Shine effect in eyes */}
              <circle cx="42" cy="42" r="1" fill="white" opacity="0.8" />
              <circle cx="62" cy="42" r="1" fill="white" opacity="0.8" />

              {/* Mouth expression */}
              {mood === "success" && (
                <path
                  d="M 40 62 Q 50 68 60 62"
                  stroke="#10b981"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                />
              )}
              {mood === "warning" && (
                <line
                  x1="40"
                  y1="62"
                  x2="60"
                  y2="62"
                  stroke="#f97316"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              )}
              {(mood === "thinking" || mood === "idle") && (
                <path
                  d="M 40 62 Q 50 65 60 62"
                  stroke="#6366f1"
                  strokeWidth="1.5"
                  fill="none"
                  strokeLinecap="round"
                  opacity="0.7"
                />
              )}
              {mood === "hint" && (
                <path
                  d="M 40 62 Q 50 66 60 62"
                  stroke="#0ea5e9"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                />
              )}
              {mood === "error" && (
                <path
                  d="M 40 60 Q 50 62 60 60"
                  stroke="#ef4444"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                />
              )}

              {/* Thinking bubbles when loading */}
              {isThinking && (
                <>
                  <circle
                    cx="75"
                    cy="20"
                    r="3"
                    fill="#fbbf24"
                    opacity="0.6"
                    className="animate-[bounce_1.5s_ease-in-out_infinite]"
                  />
                  <circle
                    cx="82"
                    cy="28"
                    r="2"
                    fill="#fbbf24"
                    opacity="0.4"
                    className="animate-[bounce_1.5s_ease-in-out_infinite_0.2s]"
                  />
                </>
              )}
            </svg>
          </div>
        </div>

        {/* Speech Bubble + Info */}
        <div className="flex-1 min-w-0">
          {/* Speech Bubble */}
          <div
            className={`rounded-2xl border-2 px-4 py-3 mb-2 relative ${style.bubbleBg}`}
          >
            {/* Tail pointing to character */}
            <div
              className={`absolute -left-2 top-4 w-3 h-3 rounded-full ${style.bubbleBg.split(" ")[0]}`}
              style={{
                borderTop: `2px solid currentColor`,
                borderLeft: `2px solid currentColor`,
                borderColor: style.bubbleBg.includes("sky") ? "#0ea5e9" : style.bubbleBg.includes("emerald") ? "#10b981" : style.bubbleBg.includes("amber") ? "#f59e0b" : style.bubbleBg.includes("orange") ? "#f97316" : style.bubbleBg.includes("rose") ? "#ef4444" : "#6366f1",
              }}
            />

            {/* Message or Thinking indicator */}
            {isThinking ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-slate-500">Thinking</span>
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:120ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:240ms]" />
                </div>
              </div>
            ) : message ? (
              <p className={`text-sm leading-relaxed whitespace-pre-wrap ${style.bubbleText}`}>
                {message}
              </p>
            ) : (
              <p className="text-xs text-slate-500 italic">Ready to help!</p>
            )}
          </div>

          {/* Mood label + action */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
              {isThinking ? "Analyzing..." : mood === "idle" ? "Pixelwise" : mood}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700">
              AI Guide
            </span>
          </div>
        </div>
      </div>

      {/* Footer info */}
      <div className="mt-3 pt-3 border-t border-indigo-100 flex gap-2 text-[11px] text-slate-500">
        <span>📊 Vision Learning</span>
        <span>🧠 AI Powered</span>
        <span>✨ Smart Hints</span>
      </div>
    </div>
  );
}
