"use client";

type Progress = {
  datasetSelected: boolean;
  sampleLoaded: boolean;
  resized: boolean;
  padded: boolean;
  clarity: boolean;
  exported: boolean;
};

export default function MissionChecklist({
  progress,
  dark,
  sizeTarget = { w: 150, h: 150 },
}: {
  progress: Progress;
  dark?: boolean;
  sizeTarget?: { w: number; h: number };
}) {
  const items: { key: keyof Progress; label: string }[] = [
    { key: "datasetSelected", label: "Select a dataset" },
    { key: "sampleLoaded", label: "Load a sample image" },
    { key: "resized", label: `Resize towards ${sizeTarget.w}×${sizeTarget.h} (keep aspect)` },
    { key: "padded", label: `Pad to exactly ${sizeTarget.w}×${sizeTarget.h}` },
    { key: "clarity", label: "Improve clarity (brightness/contrast or sharpen)" },
    { key: "exported", label: "Export processed dataset" },
  ];

  const completed = items.filter(i => progress[i.key]).length;
  const total = items.length;

  return (
    <div
      className={`rounded-xl border px-3 py-3 ${
        dark ? "border-neutral-800 bg-neutral-900/50 text-neutral-100" : "border-gray-200 bg-white"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">Mission Checklist</h3>
        <span
          className={`text-xs px-2 py-1 rounded ${
            completed === total
              ? dark ? "bg-green-900 text-green-100" : "bg-green-100 text-green-800"
              : dark ? "bg-neutral-800 text-neutral-300" : "bg-gray-100 text-gray-700"
          }`}
        >
          {completed}/{total} complete
        </span>
      </div>

      <ul className="space-y-2">
        {items.map(({ key, label }) => {
          const done = progress[key];
          return (
            <li key={key} className="flex items-start gap-2">
              <span
                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                  done
                    ? dark
                      ? "border-green-700 bg-green-600 text-white"
                      : "border-green-300 bg-green-500 text-white"
                    : dark
                      ? "border-neutral-700 bg-neutral-800 text-neutral-400"
                      : "border-gray-300 bg-white text-gray-400"
                }`}
                aria-hidden
              >
                {done ? "✓" : "•"}
              </span>
              <span className={done ? (dark ? "text-neutral-300" : "text-gray-700") : ""}>
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
