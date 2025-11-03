import React from "react";

type Props = {
  dark?: boolean;
  progress: {
    datasetSelected: boolean;
    splitPreviewed: boolean;
    splitApplied: boolean;
    biasChecked: boolean;
    balanced: boolean; // set after Submit & Run succeeds
  };
};

function Row({
  ok,
  text,
  dark,
}: {
  ok: boolean;
  text: string;
  dark?: boolean;
}) {
  const okDot = ok ? "bg-emerald-500" : dark ? "bg-neutral-700" : "bg-gray-200";
  const textCls = dark ? "text-neutral-200" : "text-gray-900";
  const subCls = dark ? "text-neutral-400" : "text-gray-600";
  return (
    <div className="flex items-start gap-3">
      <div
        className={`mt-1 h-5 w-5 rounded-full flex items-center justify-center ${okDot}`}
      >
        {ok ? (
          <span className="text-white text-sm leading-none">✓</span>
        ) : (
          <span className={`${subCls} text-sm leading-none`}>•</span>
        )}
      </div>
      <div className={`text-sm ${textCls}`}>{text}</div>
    </div>
  );
}

export default function MissionChecklistM3({ dark, progress }: Props) {
  const box = dark
    ? "bg-neutral-900 border-neutral-800"
    : "bg-white border-gray-200";
  const title = dark ? "text-neutral-50" : "text-gray-900";
  const badge = dark ? "bg-neutral-800 text-neutral-300" : "bg-gray-100 text-gray-700";

  const doneCount =
    Number(progress.datasetSelected) +
    Number(progress.splitPreviewed) +
    Number(progress.splitApplied) +
    Number(progress.biasChecked) +
    Number(progress.balanced);

  return (
    <div className={`rounded-xl border p-4 ${box}`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`font-semibold ${title}`}>Mission Checklist</div>
        <div className={`px-2 py-0.5 text-xs rounded-md ${badge}`}>
          {doneCount}/5 complete
        </div>
      </div>

      <div className="space-y-3">
        <Row ok={progress.datasetSelected} text="Select a dataset" dark={dark} />
        <Row
          ok={progress.splitPreviewed}
          text="Set split ratio (preview counts)"
          dark={dark}
        />
        <Row
          ok={progress.splitApplied}
          text="Apply split (make it active)"
          dark={dark}
        />
        <Row
          ok={progress.biasChecked}
          text="Check training set bias"
          dark={dark}
        />
        <Row
          ok={progress.balanced}
          text="Balance training set (Submit & Run)"
          dark={dark}
        />
      </div>
    </div>
  );
}
