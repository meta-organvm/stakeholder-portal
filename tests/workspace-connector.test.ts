import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, it } from "vitest";
import { WorkspaceConnector } from "@/lib/connectors/workspace";

function readDocSection(connector: WorkspaceConnector, repoPath: string): string {
  return (
    connector as unknown as { readDocFile: (path: string) => string }
  ).readDocFile(repoPath);
}

describe("WorkspaceConnector doc parsing", () => {
  it("extracts full 'What This Is' section until next heading", () => {
    const dir = mkdtempSync(join(tmpdir(), "workspace-connector-"));
    try {
      writeFileSync(
        join(dir, "README.md"),
        [
          "# Sample",
          "",
          "## What This Is",
          "A section with buzzwords, analysis, and context.",
          "",
          "More details stay in this section.",
          "",
          "## Architecture",
          "Next section content.",
        ].join("\n")
      );

      const connector = new WorkspaceConnector();
      const extracted = readDocSection(connector, dir);
      expect(extracted).toContain("buzzwords, analysis, and context.");
      expect(extracted).toContain("More details stay in this section.");
      expect(extracted).not.toContain("Architecture");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
