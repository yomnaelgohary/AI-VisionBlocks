"use client";
import { useEffect, useRef } from "react";

export type LogKind =
  | "info"
  | "preview"
  | "warn"
  | "error"
  | "image"
  | "card"
  | "chart"
  | "images";

export type LogItem =
  | { kind: Exclude<LogKind, "image" | "card" | "chart" | "images">; text: string }
  | { kind: "image"; src: string; caption?: string }
  | { kind: "images"; items: { src: string; caption?: string }[] }
  | { kind: "card"; title: string; lines: string[] }
  | { kind: "chart"; title: string; data: { label: string; percent: number }[] };

export default function OutputPanel({
  logs,
  onClear,
  dark = false,
}: {
  logs: LogItem[];
  onClear: () => void;
  dark?: boolean;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  const textMuted = dark ? "text-neutral-400" : "text-slate-500";
  const textBase = dark ? "text-neutral-100" : "text-slate-900";

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between pb-2">
        <h2 className={`text-sm font-semibold tracking-wide ${textBase}`}>Output</h2>
        <button
          onClick={onClear}
          className="text-xs px-3 py-1 rounded-full border border-slate-300 bg-white/70 text-slate-700 hover:border-sky-400 hover:text-sky-600 hover:shadow-[0_0_0_1px_rgba(56,189,248,0.45)] transition"
        >
          Clear
        </button>
      </div>

      <div
        className={`
          flex-1 min-h-0 rounded-2xl border border-white/70 
          bg-white/85 backdrop-blur-sm
          shadow-[0_18px_45px_rgba(15,23,42,0.18)]
          p-3 overflow-auto
        `}
      >
        {logs.length === 0 ? (
          <p className={`${textMuted} text-sm`}>
            Run your blocks to see dataset info, images, and charts here.
          </p>
        ) : (
          logs.map((item, i) => {
            if (item.kind === "image") {
              return (
                <figure key={i} className="mb-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-2 shadow-sm">
                    <img
                      src={item.src}
                      alt={item.caption || "preview"}
                      className="max-w-full rounded-lg"
                    />
                  </div>
                  {item.caption ? (
                    <figcaption className={`mt-1 text-xs ${textMuted}`}>
                      {item.caption}
                    </figcaption>
                  ) : null}
                </figure>
              );
            }

            if (item.kind === "images") {
              return (
                <div key={i} className="mb-4 grid grid-cols-3 gap-2">
                  {item.items.map((p, idx) => (
                    <figure key={idx}>
                      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-1.5 shadow-sm">
                        <img
                          src={p.src}
                          alt={p.caption || "preview"}
                          className="w-full rounded-md"
                        />
                      </div>
                      {p.caption ? (
                        <figcaption className={`mt-1 text-[11px] ${textMuted}`}>
                          {p.caption}
                        </figcaption>
                      ) : null}
                    </figure>
                  ))}
                </div>
              );
            }

            if (item.kind === "card") {
              return (
                <div
                  key={i}
                  className="
                    mb-3 rounded-xl border border-slate-200/80 
                    bg-gradient-to-r from-slate-50 via-sky-50/40 to-slate-50
                    p-3 shadow-sm
                  "
                >
                  <div className={`text-sm font-semibold ${textBase}`}>{item.title}</div>
                  <ul className="mt-1 text-sm space-y-0.5">
                    {item.lines.map((ln, idx) => (
                      <li
                        key={idx}
                        className={dark ? "text-neutral-200" : "text-slate-800"}
                      >
                        {ln}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            }

            if (item.kind === "chart") {
              return (
                <div
                  key={i}
                  className="
                    mb-3 rounded-xl border border-slate-200/80 
                    bg-gradient-to-b from-slate-50 via-white to-slate-50
                    p-3 shadow-sm
                  "
                >
                  <div className={`text-sm font-semibold ${textBase}`}>{item.title}</div>
                  <div className="mt-2 space-y-2">
                    {item.data.map((d, idx) => (
                      <div key={idx}>
                        <div className="flex justify-between text-xs">
                          <span
                            className={
                              dark ? "text-neutral-200" : "text-slate-800 font-medium"
                            }
                          >
                            {d.label}
                          </span>
                          <span className={textMuted}>{d.percent.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-200/70 overflow-hidden">
                          <div
                            className="h-2 rounded-full bg-gradient-to-r from-sky-400 via-sky-500 to-purple-400"
                            style={{
                              width: `${Math.max(0, Math.min(100, d.percent))}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            const cls =
              item.kind === "error"
                ? dark
                  ? "text-red-400"
                  : "text-rose-600"
                : item.kind === "warn"
                ? dark
                  ? "text-amber-300"
                  : "text-amber-600"
                : item.kind === "preview"
                ? dark
                  ? "text-sky-300"
                  : "text-sky-700"
                : dark
                ? "text-neutral-100"
                : "text-slate-800";

            return (
              <div key={i} className="mb-2 text-sm">
                <span className={cls}>{(item as any).text}</span>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
