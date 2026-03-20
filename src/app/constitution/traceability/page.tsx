import {
  getTracedModules,
  getTracedModulesByLayer,
  getLayers,
  getMetrics,
} from "@/data/constitutional";
import { ConstitutionSubNav } from "@/components/constitution/ConstitutionSubNav";

function CoverageBar({ pct }: { pct: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--color-text-muted)]">
          Traceability Coverage
        </span>
        <span className="font-mono font-bold text-emerald-400">{pct}%</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-3)]">
        <div
          className="h-full rounded-full bg-emerald-500/60 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ModuleRow({
  path,
  spec,
}: {
  path: string;
  spec: string;
}) {
  return (
    <tr className="border-b border-[var(--color-border)] last:border-b-0 transition-colors hover:bg-[var(--color-surface-2)]">
      <td className="px-4 py-2.5">
        <code className="font-mono text-xs text-[var(--color-accent-bright)]">
          {path}
        </code>
      </td>
      <td className="px-4 py-2.5">
        <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-3)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--color-text-muted)]">
          {spec}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Traced
        </span>
      </td>
    </tr>
  );
}

export default function TraceabilityPage() {
  const modules = getTracedModules();
  const layers = getLayers();
  const metrics = getMetrics();

  return (
    <div className="space-y-10">
      {/* Header */}
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Traceability Map
        </h1>
        <p className="max-w-2xl text-[var(--color-text-secondary)]">
          {modules.length} engine modules traced to their governing
          specifications. Every module has a constitutional origin.
        </p>
        <ConstitutionSubNav active="/constitution/traceability" />
      </section>

      {/* Coverage bar */}
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <CoverageBar pct={metrics.traceabilityCoveragePct} />
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
          <span>
            <span className="font-medium text-[var(--color-text)]">
              {modules.length}
            </span>{" "}
            modules traced
          </span>
          <span className="text-[var(--color-border)]">|</span>
          <span>
            <span className="font-medium text-[var(--color-text)]">
              {new Set(modules.map((m) => m.spec)).size}
            </span>{" "}
            unique specs referenced
          </span>
          <span className="text-[var(--color-border)]">|</span>
          <span>
            <span className="font-medium text-[var(--color-text)]">
              {layers.length}
            </span>{" "}
            layers covered
          </span>
        </div>
      </section>

      {/* Tables grouped by layer */}
      <div className="space-y-10">
        {layers.map((layer) => {
          const layerModules = getTracedModulesByLayer(layer.id);
          if (layerModules.length === 0) return null;
          return (
            <section key={layer.id} className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-bold text-[var(--color-accent-bright)]">
                  {layer.id}
                </span>
                <h3 className="text-base font-semibold uppercase tracking-wide">
                  {layer.name}
                </h3>
                <span className="ml-auto text-xs text-[var(--color-text-muted)]">
                  {layerModules.length} module
                  {layerModules.length !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-3)]">
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                        Module Path
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                        Spec Reference
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {layerModules.map((mod) => (
                      <ModuleRow
                        key={mod.path}
                        path={mod.path}
                        spec={mod.spec}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
