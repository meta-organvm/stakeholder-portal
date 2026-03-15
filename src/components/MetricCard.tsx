import { Sparkline } from "./Sparkline";

export function MetricCard({
  label,
  value,
  delta,
  sparkline,
  unit,
}: {
  label: string;
  value: string | number;
  delta?: number;
  sparkline?: number[];
  unit?: string;
}) {
  const deltaColor =
    delta === undefined ? "" : delta > 0 ? "text-green-500" : delta < 0 ? "text-red-500" : "text-[var(--color-text-muted)]";
  const deltaText = delta === undefined ? null : delta > 0 ? `+${delta}` : `${delta}`;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-3xl font-bold tracking-tight">
            {value}
            {unit && <span className="ml-1 text-sm font-normal text-[var(--color-text-muted)]">{unit}</span>}
          </div>
          <div className="mt-1 text-sm text-[var(--color-text-muted)]">{label}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {deltaText !== null && <span className={`text-xs font-medium ${deltaColor}`}>{deltaText}</span>}
          {sparkline && sparkline.length >= 2 && <Sparkline values={sparkline} color="var(--color-text-muted)" />}
        </div>
      </div>
    </div>
  );
}
