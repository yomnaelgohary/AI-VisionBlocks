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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      aria-modal="true"
      role="dialog"
    >
      {/* backdrop */}
      <div
        className={`absolute inset-0 ${dark ? "bg-black/70" : "bg-black/60"}`}
        onClick={onClose}
      />
      {/* card */}
      <div
        className={`relative mx-4 w-full max-w-lg rounded-2xl p-5 shadow-2xl ${
          dark ? "bg-neutral-900 text-neutral-100" : "bg-white text-gray-900"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-lg font-semibold">{title || "What does this block do?"}</h3>
          <button
            onClick={onClose}
            className={`rounded-md px-2 py-1 text-sm ${
              dark
                ? "bg-neutral-800 hover:bg-neutral-700"
                : "bg-gray-100 hover:bg-gray-200"
            }`}
            aria-label="Close"
          >
            Close
          </button>
        </div>
        <p className="mt-3 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}
