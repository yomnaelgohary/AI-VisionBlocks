import Link from "next/link";

export default function Module2Index() {
  const stages = ["1","2","3","4","5","6","7","bonus"];
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Module 2 | Staged Learning</h1>
      <p className="text-sm text-gray-600 mb-4">Choose a stage to begin.</p>
      <ul className="space-y-2">
        {stages.map((s) => (
          <li key={s}>
            <Link className="text-blue-600 underline" href={`/module2/${s}`}>
              Go to stage {s}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
