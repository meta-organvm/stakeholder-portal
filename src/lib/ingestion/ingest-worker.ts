import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import * as yaml from "yaml";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { loadEnvConfig } from "@next/env";
import { embedChunks, getRepoCursor, setRepoCursor } from "./embed";
import { extractSymbols } from "./symbol-extractor";
import { repoFileTrees, codeSymbols } from "../db/schema";
import {
  sanitizeRepoSectionsForPublicManifest,
  shouldIncludeRepoInPublicManifest,
} from "../public-exposure-policy";

loadEnvConfig(process.cwd());

// ---------------------------------------------------------------------------
// Config & DB Setup
// ---------------------------------------------------------------------------

const WORKSPACE = process.env.ORGANVM_WORKSPACE_DIR || path.join(process.env.HOME || "", "Workspace");
const CORPUS_DIR = path.join(WORKSPACE, "meta-organvm", "organvm-corpvs-testamentvm");
const REGISTRY_PATH = path.join(CORPUS_DIR, "registry-v2.json");
const METRICS_PATH = path.join(CORPUS_DIR, "system-metrics.json");
const MANIFEST_OUTPUT = path.join(process.cwd(), "src", "data", "manifest.json");

const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/stakeholder_portal";
const HAS_DATABASE_URL = Boolean(process.env.DATABASE_URL);
const CLI_SKIP_VECTOR = process.argv.includes("--skip-vector");

if (!HAS_DATABASE_URL && !CLI_SKIP_VECTOR) {
  console.error("FATAL: DATABASE_URL is not set.");
  process.exit(1);
}
if (!HAS_DATABASE_URL && CLI_SKIP_VECTOR) {
  console.warn(
    "WARNING: DATABASE_URL is not set. Running in manifest-only mode because --skip-vector was provided.",
  );
}
if (!process.env.EMBEDDING_API_KEY) {
  console.warn("WARNING: EMBEDDING_API_KEY is not set. Ingestion may fail if the provider requires auth.");
}

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool);

// ---------------------------------------------------------------------------
// Constants & Maps
// ---------------------------------------------------------------------------

const ORGAN_DIR_MAP: Record<string, string> = {
  "ORGAN-I": "organvm-i-theoria",
  "ORGAN-II": "organvm-ii-poiesis",
  "ORGAN-III": "organvm-iii-ergon",
  "ORGAN-IV": "organvm-iv-taxis",
  "ORGAN-V": "organvm-v-logos",
  "ORGAN-VI": "organvm-vi-koinonia",
  "ORGAN-VII": "organvm-vii-kerygma",
  "META-ORGANVM": "meta-organvm",
};

const ORGAN_GREEK: Record<string, string> = {
  "ORGAN-I": "Theoria",
  "ORGAN-II": "Poiesis",
  "ORGAN-III": "Ergon",
  "ORGAN-IV": "Taxis",
  "ORGAN-V": "Logos",
  "ORGAN-VI": "Koinonia",
  "ORGAN-VII": "Kerygma",
  "META-ORGANVM": "Meta",
};

const ORGAN_DOMAIN: Record<string, string> = {
  "ORGAN-I": "Foundational theory, recursive engines, symbolic computing",
  "ORGAN-II": "Generative art, performance systems, creative coding",
  "ORGAN-III": "Commercial products, SaaS tools, developer utilities",
  "ORGAN-IV": "Orchestration, governance, AI agents, skills",
  "ORGAN-V": "Public discourse, essays, editorial, analytics",
  "ORGAN-VI": "Community, reading groups, salons, learning",
  "ORGAN-VII": "POSSE distribution, social automation, announcements",
  "META-ORGANVM": "Cross-organ engine, schemas, dashboard, governance corpus",
};

const DEPLOY_URL_PATTERN = /https?:\/\/[\w.-]+\.(?:netlify\.app|onrender\.com|pages\.dev|github\.io|vercel\.app)[\w/.-]*/g;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanizeName(repoName: string): string {
  if (repoName.includes("--")) {
    const parts = repoName.split("--", 2);
    const left = parts[0].replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    const right = parts[1].replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());
    return `${left}: ${right}`;
  }
  return repoName.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

function normalizeTechStack(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map(i => String(i).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw.split(/[,;|/]/).map(p => p.trim()).filter(Boolean);
  }
  return [];
}

interface GitStatistics {
  total_commits?: number;
  first_commit?: string;
  last_commit?: string;
  weekly_velocity?: number;
}

interface RepoSection {
  [key: string]: string;
}

interface RegistryEntry {
  name: string;
  display_name?: string;
  slug?: string;
  organ?: string;
  org?: string;
  public?: boolean;
  tier?: string;
  status?: string;
  promotion_status?: string;
  description?: string;
  tech_stack?: string[] | string;
  ci_workflow?: string | null;
  dependencies?: string[];
  produces?: string[];
  consumes?: string[];
  deployment_urls?: string[];
  deployment_url?: string;
  github_url?: string;
  git_stats?: GitStatistics;
  sections?: RepoSection;
  ai_context?: string;
  revenue_model?: string | null;
  revenue_status?: string | null;
  platinum_status?: boolean;
  implementation_status?: string;
}

interface OrganInfo {
  name?: string;
  description?: string;
  repositories?: RegistryEntry[];
  launch_status?: string;
}

interface RegistryData {
  launch_date?: string;
  organs?: Record<string, OrganInfo>;
}

interface SeedMetadata {
  description?: string;
  tags?: string[] | string;
}

interface SeedEdge {
  artifact?: string;
  type?: string;
  description?: string;
}

interface SeedData {
  metadata?: SeedMetadata;
  produces?: (string | SeedEdge)[];
  consumes?: (string | SeedEdge)[];
}

interface ManifestOrgan {
  key: string;
  name: string;
  greek: string;
  domain: string;
  org: string;
  description: string;
  repo_count: number;
  status: string;
  aesthetic: Record<string, string>;
}

interface ManifestRepo {
  name: string;
  display_name: string;
  slug: string;
  organ: string;
  org: string;
  tier: string;
  status: string;
  promotion_status: string;
  description: string;
  tech_stack: string[];
  ci_workflow: string | null;
  dependencies: string[];
  produces: string[];
  consumes: string[];
  deployment_urls: string[];
  github_url: string;
  git_stats: GitStatistics;
  sections: Record<string, string>;
  ai_context: string;
  revenue_model: string | null;
  revenue_status: string | null;
  platinum_status: boolean;
}

function extractFirstParagraph(text: string): string {
  const lines: string[] = [];
  let inPara = false;
  let inCode = false;
  for (const line of text.split("\n")) {
    const stripped = line.trim();
    if (stripped.startsWith("```")) {
      inCode = !inCode;
      if (inPara) break;
      continue;
    }
    if (inCode) continue;
    if (!stripped) {
      if (inPara) break;
      continue;
    }
    if (/^(!\[|\||---|===|- \[x\]|- \[ \])/.test(stripped)) {
      if (inPara) break;
      continue;
    }
    inPara = true;
    lines.push(stripped);
  }
  return lines.join(" ");
}

function parseMarkdownSections(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const text = fs.readFileSync(filePath, "utf-8");
    const sections: Record<string, string> = {};
    let currentKey: string | null = null;
    let currentLines: string[] = [];

    for (const line of text.split("\n")) {
      const match = line.match(/^(#{2,3})\s+(.+)$/);
      if (match) {
        if (currentKey !== null) {
          sections[currentKey] = currentLines.join("\n").trim();
        }
        currentKey = match[2].trim().toLowerCase();
        currentLines = [];
      } else if (currentKey !== null) {
        currentLines.push(line);
      }
    }
    if (currentKey !== null) {
      sections[currentKey] = currentLines.join("\n").trim();
    }
    return sections;
  } catch {
    return {};
  }
}

function extractDeploymentUrls(claudePath: string, registryUrl?: string | null): string[] {
  const urls = new Set<string>();
  if (registryUrl) urls.add(registryUrl);
  if (fs.existsSync(claudePath)) {
    try {
      const text = fs.readFileSync(claudePath, "utf-8");
      const matches = text.match(DEPLOY_URL_PATTERN);
      if (matches) {
        for (const url of matches) {
          urls.add(url.replace(/\/$/, ""));
        }
      }
    } catch {}
  }
  return Array.from(urls).sort();
}

function readSeed(repoPath: string): SeedData {
  const seedPath = path.join(repoPath, "seed.yaml");
  if (!fs.existsSync(seedPath)) return {};
  try {
    return (yaml.parse(fs.readFileSync(seedPath, "utf-8")) as SeedData) || {};
  } catch {
    return {};
  }
}

function readOrganAesthetic(organDir: string): Record<string, string> {
  const aestheticPath = path.join(organDir, ".github", "organ-aesthetic.yaml");
  if (!fs.existsSync(aestheticPath)) return {};
  try {
    const data = yaml.parse(fs.readFileSync(aestheticPath, "utf-8")) || {};
    const modifiers = data.modifiers || {};
    return {
      palette: modifiers.palette_shift || "",
      typography: modifiers.typography_emphasis || "",
      tone: modifiers.tone_shift || "",
      visual: modifiers.visual_shift || "",
    };
  } catch {
    return {};
  }
}

function gitStats(repoPath: string): GitStatistics {
  const gitDir = path.join(repoPath, ".git");
  if (!fs.existsSync(gitDir)) return {};

  const run = (args: string[]) => {
    try {
      return execSync(args.join(" "), { cwd: repoPath, stdio: "pipe", timeout: 10000 }).toString().trim();
    } catch {
      return "";
    }
  };

  const stats: GitStatistics = {};
  const countStr = run(["git", "rev-list", "--count", "HEAD"]);
  if (/^\d+$/.test(countStr)) stats.total_commits = parseInt(countStr, 10);

  const first = run(["git", "log", "--format=%aI", "--reverse"]);
  if (first) stats.first_commit = first.split("\n")[0].substring(0, 10);

  const last = run(["git", "log", "--format=%aI", "-1"]);
  if (last) stats.last_commit = last.substring(0, 10);

  const recent = run(["git", "log", "--oneline", "--since='4 weeks ago'"]);
  if (recent) {
    const lines = recent.split("\n").filter(Boolean).length;
    stats.weekly_velocity = parseFloat((lines / 4).toFixed(1));
  } else {
    stats.weekly_velocity = 0;
  }

  return stats;
}

function buildAiContext(
  repoName: string,
  description: string,
  techStack: string[],
  sections: Record<string, string>,
  deploymentUrls: string[],
  organKey: string
): string {
  const parts: string[] = [];
  const display = humanizeName(repoName);
  parts.push(`${display} (${repoName}) — ${organKey}.`);

  if (description) parts.push(description.substring(0, 300));
  if (techStack.length) parts.push(`Tech stack: ${techStack.slice(0, 10).join(", ")}.`);

  for (const key of ["what this is", "architecture", "features"]) {
    const text = sections[key];
    if (text) {
      const para = extractFirstParagraph(text);
      if (para) parts.push(para.substring(0, 200));
    }
  }

  if (deploymentUrls.length) parts.push(`Deployed at: ${deploymentUrls.slice(0, 3).join(", ")}.`);

  const combined = parts.join(" ");
  const words = combined.split(/\s+/);
  return words.length > 500 ? words.slice(0, 500).join(" ") + "..." : combined;
}

// Embedding logic is now in ./embed.ts (shared with incremental pipeline)

function getHeadSha(repoPath: string): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: repoPath, stdio: "pipe", timeout: 5000 }).toString().trim();
  } catch {
    return null;
  }
}

function getChangedFiles(repoPath: string, sinceSha: string): Set<string> {
  try {
    const output = execSync(`git diff --name-only ${sinceSha}..HEAD`, {
      cwd: repoPath,
      stdio: "pipe",
      timeout: 10000,
    }).toString().trim();
    return new Set(output.split("\n").filter(Boolean));
  } catch {
    // If diff fails (e.g. SHA no longer exists), treat all files as changed
    return new Set(["*"]);
  }
}

const EMBEDDABLE_EXTENSIONS = new Set([
  ".md", ".yaml", ".yml", ".ts", ".tsx", ".js", ".jsx",
  ".py", ".json", ".toml", ".sh", ".css", ".scss",
  ".html", ".sql", ".graphql", ".rs", ".go",
]);

const EMBEDDABLE_NAMED_FILES = new Set([
  "Dockerfile", "Makefile", "Procfile", "Justfile",
]);

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".output", "__pycache__",
  ".venv", "venv", ".tox", "coverage", ".next",
]);

const MAX_FILE_SIZE_BYTES = 100 * 1024; // 100KB

function walkRepoForEmbeddings(dir: string): string[] {
  let results: string[] = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.resolve(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat && stat.isDirectory()) {
        // Skip dot dirs except .github
        if (file.startsWith(".") && file !== ".github") continue;
        if (SKIP_DIRS.has(file)) continue;
        results = results.concat(walkRepoForEmbeddings(fullPath));
      } else {
        if (stat.size > MAX_FILE_SIZE_BYTES) continue;

        const ext = path.extname(file).toLowerCase();
        const isValid =
          EMBEDDABLE_EXTENSIONS.has(ext) ||
          EMBEDDABLE_NAMED_FILES.has(file);

        if (isValid) {
          // Binary check: read first 512 bytes for null byte
          try {
            const buf = Buffer.alloc(Math.min(512, stat.size));
            const fd = fs.openSync(fullPath, "r");
            fs.readSync(fd, buf, 0, buf.length, 0);
            fs.closeSync(fd);
            if (!buf.includes(0)) {
              results.push(fullPath);
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    }
  } catch {
    // Ignore
  }
  return results;
}

// ---------------------------------------------------------------------------
// File Tree Indexing (Phase 1A)
// ---------------------------------------------------------------------------

async function indexFileTree(
  repoName: string,
  organ: string,
  repoPath: string,
  commitSha: string | null
): Promise<number> {
  const gitDir = path.join(repoPath, ".git");
  if (!fs.existsSync(gitDir)) return 0;

  try {
    const result = execSync("git ls-files -z", {
      cwd: repoPath,
      stdio: "pipe",
      timeout: 15000,
      maxBuffer: 5 * 1024 * 1024,
    }).toString();

    const files = result.split("\0").filter(Boolean);
    if (files.length === 0) return 0;

    // Delete existing entries for this repo
    await db.execute(sql`DELETE FROM repo_file_trees WHERE repo = ${repoName}`);

    // Collect directory entries
    const dirs = new Set<string>();
    const rows: Array<{
      id: string;
      repo: string;
      organ: string;
      path: string;
      fileType: "file" | "directory";
      extension: string | null;
      sizeBytes: number | null;
      lastModified: Date | null;
      commitSha: string | null;
    }> = [];

    for (const f of files) {
      const ext = path.extname(f).toLowerCase() || null;
      let sizeBytes: number | null = null;
      let lastModified: Date | null = null;

      const fullPath = path.join(repoPath, f);
      try {
        const stat = fs.statSync(fullPath);
        sizeBytes = stat.size;
        lastModified = stat.mtime;
      } catch {
        // File may not exist (e.g. submodule pointer)
      }

      rows.push({
        id: `${repoName}:${f}`,
        repo: repoName,
        organ,
        path: f,
        fileType: "file",
        extension: ext,
        sizeBytes,
        lastModified,
        commitSha,
      });

      // Derive directory entries
      const parts = f.split("/");
      for (let i = 1; i < parts.length; i++) {
        const dirPath = parts.slice(0, i).join("/") + "/";
        if (!dirs.has(dirPath)) {
          dirs.add(dirPath);
          rows.push({
            id: `${repoName}:${dirPath}`,
            repo: repoName,
            organ,
            path: dirPath,
            fileType: "directory",
            extension: null,
            sizeBytes: null,
            lastModified: null,
            commitSha,
          });
        }
      }
    }

    // Batch insert in groups of 100
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      await db.insert(repoFileTrees).values(batch).onConflictDoUpdate({
        target: repoFileTrees.id,
        set: {
          sizeBytes: sql`EXCLUDED.size_bytes`,
          lastModified: sql`EXCLUDED.last_modified`,
          commitSha: sql`EXCLUDED.commit_sha`,
          ingestedAt: new Date(),
        },
      });
    }

    return rows.length;
  } catch (err) {
    console.warn(`[FileTree] Failed to index ${repoName}:`, (err as Error).message);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Symbol Extraction + DB Write (Phase 2B)
// ---------------------------------------------------------------------------

async function indexSymbols(
  repoName: string,
  organ: string,
  repoPath: string,
  commitSha: string | null
): Promise<number> {
  // Delete existing symbols for this repo
  await db.execute(sql`DELETE FROM code_symbols WHERE repo = ${repoName}`);

  const codeExts = new Set([".ts", ".tsx", ".js", ".jsx", ".py"]);
  const files = walkRepoForEmbeddings(repoPath).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return codeExts.has(ext);
  });

  const MAX_SYMBOLS_PER_REPO = 2000;
  let totalSymbols = 0;

  for (const f of files) {
    if (totalSymbols >= MAX_SYMBOLS_PER_REPO) {
      console.log(`[Symbols] Cap reached (${MAX_SYMBOLS_PER_REPO}) for ${repoName}, skipping remaining files`);
      break;
    }
    const relativePath = path.relative(repoPath, f);
    let content: string;
    try {
      content = fs.readFileSync(f, "utf-8");
    } catch {
      continue;
    }

    const symbols = extractSymbols(content, relativePath);
    if (symbols.length === 0) continue;

    // Dedup by ID within the file
    const seenIds = new Set<string>();
    const rows = symbols
      .map((sym) => ({
        id: `${repoName}:${relativePath}:${sym.symbolType}:${sym.name}:${sym.lineStart}`,
        repo: repoName,
        organ,
        path: relativePath,
        symbolType: sym.symbolType as "function" | "class" | "interface" | "type" | "const",
        name: sym.name,
        signature: sym.signature,
        lineStart: sym.lineStart,
        lineEnd: sym.lineEnd,
        docComment: sym.docComment,
        parentSymbol: sym.parentSymbol,
        visibility: sym.visibility,
        commitSha,
      }))
      .filter((r) => {
        if (seenIds.has(r.id)) return false;
        seenIds.add(r.id);
        return true;
      });

    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      try {
        await db.insert(codeSymbols).values(batch).onConflictDoUpdate({
          target: codeSymbols.id,
          set: {
            signature: sql`EXCLUDED.signature`,
            lineStart: sql`EXCLUDED.line_start`,
            lineEnd: sql`EXCLUDED.line_end`,
            docComment: sql`EXCLUDED.doc_comment`,
            commitSha: sql`EXCLUDED.commit_sha`,
            ingestedAt: new Date(),
          },
        });
      } catch (err) {
        console.warn(`[Symbols] Batch insert failed for ${relativePath}:`, (err as Error).message?.slice(0, 200));
      }
    }

    totalSymbols += rows.length;
  }

  return totalSymbols;
}

// ---------------------------------------------------------------------------
// Worker Main Function
// ---------------------------------------------------------------------------

export async function runIngestionWorker(allowStaleManifest = false, skipVector = false) {
  console.log("Starting unified TS ingestion pipeline...");

  if (!fs.existsSync(REGISTRY_PATH)) {
    if (allowStaleManifest && fs.existsSync(MANIFEST_OUTPUT)) {
      console.warn(`WARNING: Registry not found at ${REGISTRY_PATH}; keeping existing manifest at ${MANIFEST_OUTPUT}`);
      return;
    }
    throw new Error(`Registry not found at ${REGISTRY_PATH}.`);
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8")) as RegistryData;
  let metrics: { computed?: Record<string, unknown> } = {};
  if (fs.existsSync(METRICS_PATH)) {
    metrics = JSON.parse(fs.readFileSync(METRICS_PATH, "utf-8"));
  }

  const computed = metrics.computed || {};

  // Build manifest data structures
  const systemData = {
    name: "ORGANVM",
    tagline: "Eight-organ creative-institutional system",
    total_repos: 0,
    total_organs: (computed.total_organs as number) || 8,
    launch_date: registry.launch_date || "2026-02-11",
    sprints_completed: (computed.sprints_completed as number) || 0,
    sprint_names: (computed.sprint_names as string[]) || [],
    ci_workflows: 0,
    dependency_edges: 0,
    published_essays: (computed.published_essays as number) || 0,
    active_repos: 0,
    archived_repos: 0,
  };

  const organsData: ManifestOrgan[] = [];
  const reposData: ManifestRepo[] = [];
  const depEdges: { from: string; to: string }[] = [];

  let manifestTotalProcessed = 0;
  const manifestReposWithPaths: { repoInfo: ManifestRepo; repoPath: string; organKey: string }[] = [];

  for (const [organKey, organInfo] of Object.entries(registry.organs || {})) {
    const organDirName = ORGAN_DIR_MAP[organKey] || "";
    const organDir = organDirName ? path.join(WORKSPACE, organDirName) : null;

    let aesthetic = {};
    if (organDir && fs.existsSync(organDir)) {
      aesthetic = readOrganAesthetic(organDir);
    }

    const visibleRepositories = (organInfo.repositories || []).filter((repoEntry) =>
      shouldIncludeRepoInPublicManifest(repoEntry),
    );

    organsData.push({
      key: organKey,
      name: organInfo.name || "",
      greek: ORGAN_GREEK[organKey] || "",
      domain: ORGAN_DOMAIN[organKey] || "",
      org: organDirName,
      description: organInfo.description || "",
      repo_count: visibleRepositories.length,
      status: organInfo.launch_status || "OPERATIONAL",
      aesthetic,
    });

    for (const repoEntry of visibleRepositories) {
      const name = repoEntry.name || "";
      if (!name) continue;

      const org = repoEntry.org || organDirName;
      const slug = name;

      let repoPath: string | null = null;
      if (organDir && fs.existsSync(organDir)) {
        const candidate = path.join(organDir, name);
        if (fs.existsSync(candidate)) {
          repoPath = candidate;
        }
      }

      const seed: SeedData = repoPath ? readSeed(repoPath) : {};
      const seedMeta = seed.metadata || {};

      let claudeSections: Record<string, string> = {};
      let readmeSections: Record<string, string> = {};

      if (repoPath) {
        claudeSections = parseMarkdownSections(path.join(repoPath, "CLAUDE.md"));
        readmeSections = parseMarkdownSections(path.join(repoPath, "README.md"));
      }

      const allSections = { ...readmeSections, ...claudeSections };

      let description = repoEntry.description || "";
      if (!description && seedMeta.description) description = seedMeta.description;
      if (!description && allSections["what this is"]) description = extractFirstParagraph(allSections["what this is"]);

      let techStack = normalizeTechStack(repoEntry.tech_stack);
      if (!techStack.length) techStack = normalizeTechStack(seedMeta.tags);

      const sections: Record<string, string> = {};
      const secKeys = ["what this is", "architecture", "features", "build & dev commands", "conventions", "environment", "key design constraints", "remaining limitations", "key files", "data integrity rules", "schemas"];
      for (const k of secKeys) {
        if (allSections[k]) sections[k] = allSections[k].substring(0, 2500);
      }

      const deps = repoEntry.dependencies || [];
      for (const dep of deps) {
        depEdges.push({ from: `${org}/${name}`, to: dep });
      }

      const produces: string[] = [];
      const consumes: string[] = [];
      const seedProduces = seed.produces || [];
      const seedConsumes = seed.consumes || [];

      for (const edge of seedProduces) {
        if (typeof edge === "object" && edge !== null) {
          const e = edge as SeedEdge;
          const art = e.artifact || e.type || "";
          produces.push(e.description ? `${art}: ${e.description}` : art);
        } else {
          produces.push(String(edge));
        }
      }
      for (const edge of seedConsumes) {
        if (typeof edge === "object" && edge !== null) {
          const e = edge as SeedEdge;
          const art = e.artifact || e.type || "";
          consumes.push(e.description ? `${art}: ${e.description}` : art);
        } else {
          consumes.push(String(edge));
        }
      }

      const registryUrl = repoEntry.deployment_url || null;
      let deploymentUrls: string[] = [];
      if (repoPath) {
        deploymentUrls = extractDeploymentUrls(path.join(repoPath, "CLAUDE.md"), registryUrl);
      } else if (registryUrl) {
        deploymentUrls = [registryUrl];
      }

      const gs = repoPath ? gitStats(repoPath) : {};
      const aiContext = buildAiContext(name, description, techStack, allSections, deploymentUrls, organKey);

      const repoPayload: ManifestRepo = {
        name,
        display_name: humanizeName(name),
        slug,
        organ: organKey,
        org,
        tier: repoEntry.tier || "standard",
        status: repoEntry.implementation_status || "ACTIVE",
        promotion_status: repoEntry.promotion_status || "LOCAL",
        description,
        tech_stack: techStack,
        ci_workflow: repoEntry.ci_workflow ?? null,
        dependencies: deps,
        produces,
        consumes,
        deployment_urls: deploymentUrls,
        github_url: org ? `https://github.com/${org}/${name}` : "",
        git_stats: gs,
        sections: sanitizeRepoSectionsForPublicManifest(sections),
        ai_context: aiContext,
        revenue_model: repoEntry.revenue_model ?? null,
        revenue_status: repoEntry.revenue_status ?? null,
        platinum_status: repoEntry.platinum_status || false,
      };

      reposData.push(repoPayload);
      if (repoPath) {
        manifestReposWithPaths.push({ repoInfo: repoPayload, repoPath, organKey });
      }

      manifestTotalProcessed++;
    }
  }

  systemData.total_repos = reposData.length;
  systemData.ci_workflows = reposData.filter((repo) => repo.ci_workflow).length;
  systemData.dependency_edges = depEdges.length;
  systemData.active_repos = reposData.filter((repo) => repo.status !== "ARCHIVED").length;
  systemData.archived_repos = reposData.filter((repo) => repo.status === "ARCHIVED").length;

  const depGraph = {
    nodes: reposData.map(r => ({ id: `${r.org}/${r.name}`, organ: r.organ, tier: r.tier })),
    edges: depEdges,
  };

  const deployments = [];
  for (const r of reposData) {
    for (const url of r.deployment_urls || []) {
      deployments.push({ repo: r.name, organ: r.organ, url });
    }
  }

  const manifest = {
    generated: new Date().toISOString(),
    system: systemData,
    organs: organsData,
    repos: reposData,
    dependency_graph: depGraph,
    deployments,
  };

  // Ensure output dir exists
  fs.mkdirSync(path.dirname(MANIFEST_OUTPUT), { recursive: true });
  fs.writeFileSync(MANIFEST_OUTPUT, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Generated manifest: ${manifestTotalProcessed} repos, ${depEdges.length} dep edges -> ${MANIFEST_OUTPUT}`);

  if (!HAS_DATABASE_URL && skipVector) {
    console.log("Skipping DB-backed indexing because DATABASE_URL is not set and --skip-vector was provided.");
    await pool.end();
    return;
  }

  // ----------------------------------------------------------------------------
  // Structural Indexing (file trees + symbols — no embedding API needed)
  // ----------------------------------------------------------------------------

  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  let totalFileTreeRows = 0;
  let totalSymbols = 0;

  for (const { repoInfo, repoPath, organKey } of manifestReposWithPaths) {
    const headSha = getHeadSha(repoPath);

    // Phase 1A: Index file tree
    try {
      console.log(`[FileTree] Indexing ${repoInfo.name}`);
      const treeRows = await indexFileTree(repoInfo.name, organKey, repoPath, headSha);
      totalFileTreeRows += treeRows;
    } catch (err) {
      console.warn(`[FileTree] Failed for ${repoInfo.name}:`, (err as Error).message?.slice(0, 200));
    }

    // Phase 2B: Extract and index symbols
    try {
      console.log(`[Symbols] Extracting from ${repoInfo.name}`);
      const symCount = await indexSymbols(repoInfo.name, organKey, repoPath, headSha);
      totalSymbols += symCount;
    } catch (err) {
      console.warn(`[Symbols] Failed for ${repoInfo.name}:`, (err as Error).message?.slice(0, 200));
    }
  }

  console.log(`\nStructural indexing complete!`);
  console.log(`  File tree: ${totalFileTreeRows} rows`);
  console.log(`  Symbols: ${totalSymbols} extracted`);

  // ----------------------------------------------------------------------------
  // Vector Embeddings (requires embedding API)
  // ----------------------------------------------------------------------------

  if (skipVector) {
    console.log("Skipping vector embedding as requested.");
    await pool.end();
    return;
  }

  const incremental = process.argv.includes("--incremental");
  let totalChunksInserted = 0;
  let totalErrors = 0;
  let consecutiveApiErrors = 0;

  // Path-based content_class classifier
  function classifyContentClass(repoName: string, relativePath: string): string | undefined {
    const lower = relativePath.toLowerCase();
    const baseName = path.basename(lower);

    // Vision documents
    if (baseName === "vision.md") return "vision";
    if (lower.includes("lessons/")) return "vision";

    // SOP and governance content
    if (lower.includes("standards/") || lower.includes("sops/") || lower.includes("templates/")) return "sop";
    if (lower.includes("governance") || baseName === "governance-rules.json") return "sop";

    // praxis-perpetua and collective-persona-operations special handling
    if (repoName === "praxis-perpetua") {
      if (lower.includes("research/")) return "research";
      if (lower.includes("standards/") || lower.includes("templates/")) return "sop";
    }
    if (repoName === "collective-persona-operations") {
      if (baseName === "claude.md" || baseName === "agents.md" || baseName === "gemini.md") return "sop";
      if (lower.includes("docs/pitch/")) return "sop";
    }

    // README and context files
    if (baseName === "readme.md" || baseName === "claude.md") return "readme";

    return undefined;
  }

  for (const { repoInfo, repoPath, organKey } of manifestReposWithPaths) {
    // Abort early if embedding API is down (e.g. credits exhausted)
    if (consecutiveApiErrors >= 20) {
      console.warn(`[Ingest] Aborting embedding: ${consecutiveApiErrors} consecutive API failures. Credits may be exhausted.`);
      break;
    }

    // For incremental mode, only process files changed since last cursor
    let changedFiles: Set<string> | null = null;
    if (incremental) {
      const cursor = await getRepoCursor(repoInfo.name);
      const headSha = getHeadSha(repoPath);
      if (cursor && headSha && cursor === headSha) {
        console.log(`[Ingest] Skipping ${repoInfo.name} (no changes since ${cursor.slice(0, 8)})`);
        continue;
      }
      if (cursor && headSha) {
        changedFiles = getChangedFiles(repoPath, cursor);
        console.log(`[Ingest] Incremental: ${repoInfo.name} — ${changedFiles.size} changed files since ${cursor.slice(0, 8)}`);
      }
    }

    const headSha = getHeadSha(repoPath);

    console.log(`[Ingest] Chunking and embedding ${repoInfo.name} at ${repoPath}`);
    const files = walkRepoForEmbeddings(repoPath);

    for (const f of files) {
      if (consecutiveApiErrors >= 20) break;

      const relativePath = path.relative(repoPath, f);

      // In incremental mode, skip files not in the changed set (wildcard "*" means all changed)
      if (changedFiles && !changedFiles.has("*") && !changedFiles.has(relativePath)) continue;

      const content = fs.readFileSync(f, "utf-8");
      const stat = fs.statSync(f);

      const contentClass = classifyContentClass(repoInfo.name, relativePath);
      const result = await embedChunks({
        repo: repoInfo.name,
        organ: organKey || "unknown",
        filePath: relativePath,
        content,
        fileMtime: stat.mtime,
        commitSha: headSha || undefined,
        contentClass,
      });

      totalChunksInserted += result.inserted;
      totalErrors += result.errors;

      // Track consecutive API errors for early abort
      if (result.errors > 0 && result.inserted === 0) {
        consecutiveApiErrors += result.errors;
      } else {
        consecutiveApiErrors = 0;
      }
    }

    // Update cursor after processing repo
    if (headSha) {
      await setRepoCursor(repoInfo.name, headSha);
    }
  }

  console.log(`\nEmbedding complete!`);
  console.log(`  Chunks: ${totalChunksInserted} inserted/updated, ${totalErrors} errors`);
  await pool.end();
}

// Support running directly or as module
if (require.main === module) {
  const allowStaleManifest = process.argv.includes("--allow-stale-manifest");
  const skipVector = process.argv.includes("--skip-vector");
  runIngestionWorker(allowStaleManifest, skipVector).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
