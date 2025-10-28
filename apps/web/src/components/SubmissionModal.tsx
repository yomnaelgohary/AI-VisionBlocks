"use client";

export default function SubmissionModal({
  open,
  onClose,
  dark,
  title,
  lines,
  success,
}: {
  open: boolean;
  onClose: () => void;
  dark?: boolean;
  title: string;
  lines: string[];
  success: boolean;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={`relative w-full max-w-lg rounded-2xl border p-5 shadow-xl ${
          dark
            ? "border-neutral-800 bg-neutral-900 text-neutral-100"
            : "border-gray-200 bg-white text-gray-900"
        }`}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-sm ${
                success
                  ? dark
                    ? "bg-green-700 text-white"
                    : "bg-green-500 text-white"
                  : dark
                    ? "bg-amber-700 text-white"
                    : "bg-amber-400 text-black"
              }`}
            >
              {success ? "✓" : "!"}
            </span>
            {title}
          </h2>
          <button
            onClick={onClose}
            className={`px-2 py-1 rounded-md text-sm ${
              dark
                ? "bg-neutral-800 hover:bg-neutral-700"
                : "bg-gray-100 hover:bg-gray-200"
            }`}
          >
            Close
          </button>
        </div>

        <ul className="space-y-1 mt-2">
          {lines.map((t, i) => (
            <li key={i} className="text-sm">
              {t}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
