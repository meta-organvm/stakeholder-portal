/**
 * Local Workspace Connector
 *
 * Reads local filesystem: seed.yaml, CLAUDE.md, README.md, git history.
 * Supports incremental delta detection via file modification times.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { createEnvelope } from "../ontology";
import type {
  ConnectorAdapter,
  ConnectorConfig,
  ConnectorState,
  IngestRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Workspace connector
// ---------------------------------------------------------------------------

export class WorkspaceConnector implements ConnectorAdapter {
  readonly id = "workspace";
  readonly name = "Local Workspace";

  private config: ConnectorConfig | null = null;
  private state: ConnectorState = {
    status: "idle",
    last_run: null,
    records_ingested: 0,
    errors: 0,
    last_error: null,
  };

  private get workspaceDir(): string {
    return (this.config?.settings.workspace_dir as string)
      ?? process.env.ORGANVM_WORKSPACE_DIR
      ?? join(process.env.HOME || "/", "Workspace");
  }

  private get organDirs(): string[] {
    return (this.config?.settings.organ_dirs as string[]) ?? [
      "organvm-i-theoria",
      "organvm-ii-poiesis",
      "organvm-iii-ergon",
      "organvm-iv-taxis",
      "organvm-v-logos",
      "organvm-vi-koinonia",
      "organvm-vii-kerygma",
      "meta-organvm",
      "4444J99",
    ];
  }

  configure(config: ConnectorConfig): void {
    this.config = config;
  }

  getState(): ConnectorState {
    return { ...this.state };
  }

  async sync(options?: { incremental?: boolean; since?: string }): Promise<IngestRecord[]> {
    this.state.status = "running";
    const records: IngestRecord[] = [];
    const sinceDate = options?.since ? new Date(options.since) : null;

    try {
      for (const organDir of this.organDirs) {
        const organPath = join(this.workspaceDir, organDir);
        if (!existsSync(organPath)) continue;

        const entries = this.safeReaddir(organPath);
        for (const entry of entries) {
          const repoPath = join(organPath, entry);
          if (!this.isGitRepo(repoPath)) continue;

          // Check modification time for incremental sync
          if (sinceDate) {
            const mtime = this.getLatestModTime(repoPath);
            if (mtime && mtime < sinceDate) continue;
          }

          const repoRecords = this.readRepoData(entry, organDir, repoPath);
          records.push(...repoRecords);
        }
      }

      this.state.status = "completed";
      this.state.last_run = new Date().toISOString();
      this.state.records_ingested += records.length;
    } catch (error) {
      this.state.status = "error";
      this.state.errors += 1;
      this.state.last_error = error instanceof Error ? error.message : String(error);
    }

    return records;
  }

  // -------------------------------------------------------------------------
  // Repo data reading
  // -------------------------------------------------------------------------

  private readRepoData(
    repoName: string,
    organDir: string,
    repoPath: string
  ): IngestRecord[] {
    const records: IngestRecord[] = [];
    const now = new Date().toISOString();

    // Read seed.yaml
    const seed = this.readSeedYaml(repoPath);

    // Read CLAUDE.md or README.md for description
    const description = this.readDocFile(repoPath);

    // Get git stats
    const gitStats = this.getGitStats(repoPath);

    // Main repo record
    records.push({
      dedup_key: `workspace:repo:${organDir}/${repoName}`,
      entity_class: "repo",
      name: repoName,
      display_name: this.humanizeName(repoName),
      description: description.slice(0, 1000),
      attributes: {
        organ_dir: organDir,
        local_path: repoPath,
        ...seed,
        ...gitStats,
      },
      envelope: createEnvelope({
        source_id: `workspace:${organDir}`,
        source_type: "workspace",
        channel: "crawl",
        confidence: 1.0,
        valid_from: now,
      }),
      aliases: [repoName, this.humanizeName(repoName)],
      relationships: seed.produces
        ? (seed.produces as string[]).map((p: string) => ({
            type: "produces" as const,
            target_hint: `artifact:${p}`,
            strength: 0.9,
            evidence: `seed.yaml produces: ${p}`,
          }))
        : [],
    });

    // Document artifacts
    for (const docFile of ["CLAUDE.md", "README.md", "seed.yaml"]) {
      const docPath = join(repoPath, docFile);
      if (existsSync(docPath)) {
        const content = this.safeReadFile(docPath).slice(0, 2000);
        records.push({
          dedup_key: `workspace:doc:${organDir}/${repoName}/${docFile}`,
          entity_class: "artifact",
          name: `${repoName}-${docFile.replace(".", "-")}`,
          display_name: `${repoName}/${docFile}`,
          description: `${docFile} for ${repoName}`,
          attributes: {
            artifact_type: "doc",
            path: docPath,
            format: docFile.endsWith(".yaml") ? "yaml" : "markdown",
            content_preview: content,
          },
          envelope: createEnvelope({
            source_id: `workspace:${organDir}/${repoName}`,
            source_type: "workspace",
            channel: "crawl",
            confidence: 1.0,
          }),
          relationships: [
            {
              type: "belongs_to",
              target_hint: `repo:${repoName}`,
              strength: 1.0,
              evidence: `File ${docFile} in repo ${repoName}`,
            },
          ],
        });
      }
    }

    return records;
  }

  // -------------------------------------------------------------------------
  // File helpers
  // -------------------------------------------------------------------------

  private readSeedYaml(repoPath: string): Record<string, unknown> {
    const seedPath = join(repoPath, "seed.yaml");
    if (!existsSync(seedPath)) return {};

    try {
      const content = readFileSync(seedPath, "utf-8");
      // Simple YAML key-value extraction (no dependency on yaml parser)
      const result: Record<string, unknown> = {};
      const lines = content.split("\n");
      let currentKey = "";
      const arrayValues: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        if (trimmed.startsWith("- ") && currentKey) {
          arrayValues.push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ""));
          result[currentKey] = [...arrayValues];
          continue;
        }

        const match = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
        if (match) {
          currentKey = match[1];
          arrayValues.length = 0;
          const val = match[2].trim().replace(/^["']|["']$/g, "");
          if (val) result[currentKey] = val;
        }
      }

      return result;
    } catch {
      return {};
    }
  }

  private readDocFile(repoPath: string): string {
    for (const name of ["CLAUDE.md", "README.md"]) {
      const p = join(repoPath, name);
      if (existsSync(p)) {
        const content = this.safeReadFile(p);
        // Extract "What This Is" section or first paragraph
        const whatMatch = content.match(
          /##\s*What This Is\s*\n+([\s\S]*?)(?=\n##|\n---|$)/i
        );
        if (whatMatch) return whatMatch[1].trim();

        // Fallback: first non-heading, non-empty paragraph
        const lines = content.split("\n").filter(
          (l) => l.trim() && !l.startsWith("#") && !l.startsWith("---")
        );
        return lines.slice(0, 5).join(" ").trim();
      }
    }
    return "";
  }

  private getGitStats(repoPath: string): Record<string, unknown> {
    try {
      const totalCommits = execSync("git rev-list --count HEAD 2>/dev/null", {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      const lastCommitDate = execSync(
        "git log -1 --format=%cI 2>/dev/null",
        { cwd: repoPath, encoding: "utf-8", timeout: 5000 }
      ).trim();

      return {
        total_commits: parseInt(totalCommits, 10) || 0,
        last_commit: lastCommitDate || null,
      };
    } catch {
      return {};
    }
  }

  private isGitRepo(path: string): boolean {
    try {
      const stat = statSync(path);
      if (!stat.isDirectory()) return false;
      return existsSync(join(path, ".git"));
    } catch {
      return false;
    }
  }

  private getLatestModTime(repoPath: string): Date | null {
    try {
      const gitDir = join(repoPath, ".git");
      if (existsSync(gitDir)) {
        return statSync(gitDir).mtime;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private humanizeName(name: string): string {
    return name
      .replace(/--/g, ": ")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private safeReaddir(path: string): string[] {
    try {
      return readdirSync(path).filter((e) => !e.startsWith("."));
    } catch {
      return [];
    }
  }

  private safeReadFile(path: string): string {
    try {
      return readFileSync(path, "utf-8");
    } catch {
      return "";
    }
  }
}
