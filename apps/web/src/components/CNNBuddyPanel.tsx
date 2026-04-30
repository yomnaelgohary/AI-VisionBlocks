"use client";

export default function CNNBuddyPanel({
  dark = false,
  busy = false,
}: {
  dark?: boolean;
  busy?: boolean;
}) {
  const titleCls = dark ? "text-neutral-100" : "text-slate-900";
  const subtitleCls = dark ? "text-neutral-400" : "text-slate-500";

  return (
    <div className="rounded-3xl border border-cyan-200 bg-gradient-to-b from-white via-cyan-50/80 to-sky-50/70 px-4 py-4 shadow-[0_18px_40px_rgba(14,165,233,0.12)]">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className={`text-sm font-semibold tracking-wide ${titleCls}`}>Kernel</h2>
          <p className={`text-[11px] leading-none mt-1 ${subtitleCls}`}>Your CNN buddy</p>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full border border-cyan-200 bg-cyan-100 text-cyan-700">
          CNN
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div
          className={`relative shrink-0 w-18 h-18 rounded-[28px] border border-cyan-200 bg-gradient-to-br from-cyan-100 via-white to-sky-100 shadow-lg overflow-hidden ${
            busy ? "animate-[pulse_1.4s_ease-in-out_infinite]" : ""
          }`}
        >
          <div className="absolute inset-x-4 top-2 h-2 rounded-full bg-cyan-300/70" />
          <div className="absolute left-[18px] top-0 h-5 w-1 rounded-full bg-cyan-300 rotate-[-18deg]" />
          <div className="absolute right-[18px] top-0 h-5 w-1 rounded-full bg-cyan-300 rotate-[18deg]" />

          <div className="absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-gradient-to-br from-sky-400 to-cyan-500 shadow-inner" />
          <div className="absolute left-1/2 top-[24px] h-7 w-7 -translate-x-1/2 rounded-2xl bg-white/95 shadow-sm" />
          <div className="absolute left-[24px] top-[30px] h-2.5 w-2.5 rounded-full bg-slate-800" />
          <div className="absolute right-[24px] top-[30px] h-2.5 w-2.5 rounded-full bg-slate-800" />
          <div className="absolute left-1/2 top-[41px] h-1.5 w-5 -translate-x-1/2 rounded-full bg-slate-800/80" />
          <div className="absolute left-1/2 top-[50px] h-2 w-10 -translate-x-1/2 rounded-b-2xl border-b-2 border-cyan-500/70" />

          <div className="absolute -left-2 bottom-4 h-4 w-4 rounded-full border border-cyan-300 bg-cyan-100 shadow-sm" />
          <div className="absolute -right-2 bottom-7 h-4 w-4 rounded-full border border-cyan-300 bg-cyan-100 shadow-sm" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="rounded-2xl border border-cyan-100 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm">
            I’m Kernel, the CNN sidekick. I help you spot patterns, filters, and features.
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
            <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5">Feature maps</span>
            <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5">Filters</span>
            <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5">Layers</span>
          </div>
        </div>
      </div>
    </div>
  );
}
