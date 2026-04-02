import clsx from "clsx";

const cn = (...classes: Parameters<typeof clsx>) => clsx(...classes);

export function PrefToggle({
  value,
  onChange,
  preferLabel = "Preferuji",
  mustLabel,
  hard = false,
}: {
  value: string;
  onChange: (v: string) => void;
  preferLabel?: string;
  mustLabel?: string;
  hard?: boolean;
}) {
  const defaultMustLabel = hard ? "Vyžaduji" : "Musí být";
  const ml = mustLabel ?? defaultMustLabel;
  const opts = [
    { v: "ignore", label: "Neřeším",   activeClass: "bg-white text-slate-700 shadow-sm" },
    { v: "prefer", label: preferLabel, activeClass: "bg-violet-100 text-violet-900 shadow-sm" },
    { v: "must",   label: ml, activeClass: hard ? "bg-rose-600 text-white shadow-sm" : "bg-slate-900 text-white shadow-sm" },
  ];
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-100/60 p-0.5">
      {opts.map(({ v, label, activeClass }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "rounded-md px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors",
            value === v ? activeClass : "text-slate-400 hover:text-slate-600"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
