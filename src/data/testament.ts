/**
 * Testament data — the system's generative self-portrait catalog.
 *
 * Static data for the testament gallery page. Updated when
 * `organvm testament render --write` runs.
 */

export interface TestamentArtifact {
  id: string;
  title: string;
  modality: string;
  format: string;
  organ: string | null;
  description: string;
  filename: string;
  timestamp: string;
}

/** System-level artifacts — the primary self-portrait. */
export const SYSTEM_ARTIFACTS: TestamentArtifact[] = [
  {
    id: "constellation",
    title: "System Constellation",
    modality: "visual",
    format: "svg",
    organ: null,
    description:
      "117 repositories across 8 organs as a stellar constellation — each node sized by repo count, colored by the taste.yaml palette.",
    filename: "system-constellation.svg",
    timestamp: "2026-03-20",
  },
  {
    id: "omega",
    title: "Omega Scorecard Mandala",
    modality: "visual",
    format: "svg",
    organ: null,
    description:
      "17-criterion maturity scorecard as a radial mandala — met criteria filled with accent, unmet shown as muted outlines.",
    filename: "omega-mandala.svg",
    timestamp: "2026-03-20",
  },
  {
    id: "dependency",
    title: "Dependency Flow",
    modality: "schematic",
    format: "svg",
    organ: null,
    description:
      "Unidirectional organ dependency architecture — Production Core (I→II→III), Control Plane (IV), Interface Layer (V-VII), Meta (zero-order substrate).",
    filename: "dependency-flow.svg",
    timestamp: "2026-03-20",
  },
  {
    id: "density",
    title: "Organ Density Portrait",
    modality: "statistical",
    format: "svg",
    organ: null,
    description:
      "Per-organ AMMOI density as horizontal bars — the system's structural health at a glance.",
    filename: "organ-density.svg",
    timestamp: "2026-03-20",
  },
  {
    id: "status",
    title: "Status Distribution",
    modality: "statistical",
    format: "svg",
    organ: null,
    description:
      "Promotion status distribution as a donut chart — GRADUATED, CANDIDATE, PUBLIC_PROCESS, LOCAL, ARCHIVED.",
    filename: "status-distribution.svg",
    timestamp: "2026-03-20",
  },
  {
    id: "heatmap",
    title: "Repository Heatmap",
    modality: "statistical",
    format: "svg",
    organ: null,
    description:
      "All 117 repos as colored squares grouped by organ — color indicates promotion status.",
    filename: "repo-heatmap.svg",
    timestamp: "2026-03-20",
  },
];

/** Per-organ identity cards. */
export const ORGAN_CARDS: TestamentArtifact[] = [
  { id: "card-meta", title: "Organ META — Meta", modality: "visual", format: "svg", organ: "META", description: "Identity card for the constitutional substrate", filename: "organ-meta-card.svg", timestamp: "2026-03-20" },
  { id: "card-i", title: "Organ I — Theoria", modality: "visual", format: "svg", organ: "I", description: "Identity card for foundational theory", filename: "organ-i-card.svg", timestamp: "2026-03-20" },
  { id: "card-ii", title: "Organ II — Poiesis", modality: "visual", format: "svg", organ: "II", description: "Identity card for generative art", filename: "organ-ii-card.svg", timestamp: "2026-03-20" },
  { id: "card-iii", title: "Organ III — Ergon", modality: "visual", format: "svg", organ: "III", description: "Identity card for commerce", filename: "organ-iii-card.svg", timestamp: "2026-03-20" },
  { id: "card-iv", title: "Organ IV — Taxis", modality: "visual", format: "svg", organ: "IV", description: "Identity card for orchestration", filename: "organ-iv-card.svg", timestamp: "2026-03-20" },
  { id: "card-v", title: "Organ V — Logos", modality: "visual", format: "svg", organ: "V", description: "Identity card for discourse", filename: "organ-v-card.svg", timestamp: "2026-03-20" },
  { id: "card-vi", title: "Organ VI — Koinonia", modality: "visual", format: "svg", organ: "VI", description: "Identity card for community", filename: "organ-vi-card.svg", timestamp: "2026-03-20" },
  { id: "card-vii", title: "Organ VII — Kerygma", modality: "visual", format: "svg", organ: "VII", description: "Identity card for distribution", filename: "organ-vii-card.svg", timestamp: "2026-03-20" },
];

/** All modalities the system renders in. */
export const MODALITIES = [
  { key: "visual", label: "Visual", icon: "◉" },
  { key: "statistical", label: "Statistical", icon: "◨" },
  { key: "schematic", label: "Schematic", icon: "◫" },
  { key: "mathematical", label: "Mathematical", icon: "∑" },
  { key: "theoretical", label: "Theoretical", icon: "◈" },
  { key: "academic", label: "Academic", icon: "◍" },
  { key: "social", label: "Social", icon: "◎" },
  { key: "philosophical", label: "Philosophical", icon: "◆" },
  { key: "sonic", label: "Sonic", icon: "◌" },
  { key: "archival", label: "Archival", icon: "◇" },
] as const;

export function getTestamentStats() {
  const all = [...SYSTEM_ARTIFACTS, ...ORGAN_CARDS];
  const byModality = all.reduce(
    (acc, a) => {
      acc[a.modality] = (acc[a.modality] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return {
    totalArtifacts: all.length,
    systemArtifacts: SYSTEM_ARTIFACTS.length,
    organCards: ORGAN_CARDS.length,
    modalities: Object.keys(byModality).length,
    byModality,
  };
}
