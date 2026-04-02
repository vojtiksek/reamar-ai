export function scoreLabel(score: number): { label: string; cls: string } {
  if (score >= 80) return { label: "Výborné", cls: "bg-emerald-100 text-emerald-800" };
  if (score >= 60) return { label: "Dobré",   cls: "bg-blue-100 text-blue-800" };
  if (score >= 40) return { label: "OK",      cls: "bg-amber-100 text-amber-800" };
  return                    { label: "Slabé",  cls: "bg-slate-100 text-slate-600" };
}

export function FitDot({ value, title }: { value: number; title: string }) {
  const color =
    value >= 70 ? "bg-emerald-400" : value >= 40 ? "bg-amber-400" : "bg-red-400";
  return (
    <span title={`${title}: ${Math.round(value)}`} className={`inline-block h-2 w-2 rounded-full ${color}`} />
  );
}
