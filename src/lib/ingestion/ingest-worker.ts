import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import * as yaml from "yaml";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { documentChunks } from "../db/schema";
import { sql } from "drizzle-orm";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// ---------------------------------------------------------------------------
// Config & DB Setup
// ---------------------------------------------------------------------------

const WORKSPACE = process.env.ORGANVM_WORKSPACE_DIR || path.join(process.env.HOME || "", "Workspace");
const CORPUS_DIR = path.join(WORKSPACE, "meta-organvm", "organvm-corpvs-testamentvm");
const REGISTRY_PATH = path.join(CORPUS_DIR, "registry-v2.json");
const METRICS_PATH = path.join(CORPUS_DIR, "system-metrics.json");
const MANIFEST_OUTPUT = path.join(process.cwd(), "src", "data", "manifest.json");

const EMBEDDING_API_URL = process.env.EMBEDDING_API_URL || "https://api.openai.com/v1/embeddings";
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("FATAL: DATABASE_URL is not set.");
  process.exit(1);
}
if (!EMBEDDING_API_KEY) {
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
  file_index: string[];
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

function getFileIndex(repoPath: string): string[] {
  const gitDir = path.join(repoPath, ".git");
  if (!fs.existsSync(gitDir)) return [];

  try {
    const result = execSync("git ls-files", { cwd: repoPath, stdio: "pipe", timeout: 10000 }).toString().trim();
    if (!result) return [];

    const allFiles = result.split("\n").filter(Boolean);
    const highValue = new Set<string>();

    for (const f of allFiles) {
      if (!f.includes("/") && (f.endsWith(".md") || ["package.json", "Cargo.toml", "seed.yaml"].includes(f))) {
        highValue.add(f);
      } else if (f.endsWith(".md")) {
        highValue.add(f);
      } else if (f.startsWith("conductor/") || f.startsWith("archetypes/") || f.startsWith("src/core/")) {
        highValue.add(f);
      } else if (f.startsWith("scripts/") && (f.endsWith(".py") || f.endsWith(".ts") || f.endsWith(".sh"))) {
        highValue.add(f);
      }
      if (f.includes("/")) {
        highValue.add(f.split("/")[0] + "/");
      }
    }
    return Array.from(highValue).sort().slice(0, 500);
  } catch {
    return [];
  }
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

// ----------------------------------------------------------------------------
// Embedding Logic using LangChain
// ----------------------------------------------------------------------------

async function fetchEmbedding(text: string): Promise<number[]> {
  const response = await fetch(EMBEDDING_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(EMBEDDING_API_KEY ? { Authorization: `Bearer ${EMBEDDING_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API failed: ${response.status} ${err}`);
  }

  const data = await response.json();
  if (!data?.data?.[0]?.embedding) {
    throw new Error("Invalid format returned by embedding API.");
  }
  return data.data[0].embedding;
}

function walkRepoForEmbeddings(dir: string): string[] {
  let results: string[] = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.resolve(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat && stat.isDirectory()) {
        if (!file.startsWith(".") && file !== "node_modules" && file !== "dist") {
          results = results.concat(walkRepoForEmbeddings(fullPath));
        }
      } else {
        const isValidFile =
          file.endsWith(".md") ||
          (dir.includes("conductor") && !file.endsWith(".json")) ||
          (dir.includes("research") && file.endsWith(".md")) ||
          (dir.includes("intake") && file.endsWith(".md")) ||
          (dir.includes("scripts") && file.endsWith(".py"));

        if (isValidFile) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore
  }
  return results;
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
    total_repos: (computed.total_repos as number) || 0,
    total_organs: (computed.total_organs as number) || 8,
    launch_date: registry.launch_date || "2026-02-11",
    sprints_completed: (computed.sprints_completed as number) || 0,
    sprint_names: (computed.sprint_names as string[]) || [],
    ci_workflows: (computed.ci_workflows as number) || 0,
    dependency_edges: (computed.dependency_edges as number) || 0,
    published_essays: (computed.published_essays as number) || 0,
    active_repos: (computed.active_repos as number) || 0,
    archived_repos: (computed.archived_repos as number) || 0,
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

    organsData.push({
      key: organKey,
      name: organInfo.name || "",
      greek: ORGAN_GREEK[organKey] || "",
      domain: ORGAN_DOMAIN[organKey] || "",
      org: organDirName,
      description: organInfo.description || "",
      repo_count: (organInfo.repositories || []).length,
      status: organInfo.launch_status || "OPERATIONAL",
      aesthetic,
    });

    for (const repoEntry of organInfo.repositories || []) {
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
      const fileIndex = repoPath ? getFileIndex(repoPath) : [];
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
        file_index: fileIndex,
        sections,
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

  // ----------------------------------------------------------------------------
  // Vector Embeddings Ingestion (LangChain text_splitter)
  // ----------------------------------------------------------------------------

  if (skipVector) {
    console.log("Skipping vector ingestion as requested.");
    return;
  }

  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);

  let totalChunksInserted = 0;

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  for (const { repoInfo, repoPath, organKey } of manifestReposWithPaths) {
    console.log(`[Ingest] Chunking and embedding ${repoInfo.name} at ${repoPath}`);
    const files = walkRepoForEmbeddings(repoPath);

    for (const f of files) {
      const relativePath = path.relative(repoPath, f);
      const content = fs.readFileSync(f, "utf-8");
      if (!content.trim()) continue;

      // Use langchain text splitter instead of naive paragraph splitter
      const chunks = await textSplitter.createDocuments([content]);

      for (let i = 0; i < chunks.length; i++) {
        const textChunk = chunks[i].pageContent;
        if (textChunk.length < 50) continue;

        try {
          const embedding = await fetchEmbedding(textChunk);
          const chunkId = `${repoInfo.name}:${relativePath}:${i}`;

          await db
            .insert(documentChunks)
            .values({
              id: chunkId,
              repo: repoInfo.name,
              organ: organKey || "unknown",
              path: relativePath,
              content: textChunk,
              embedding: embedding,
            })
            .onConflictDoUpdate({
              target: documentChunks.id,
              set: {
                content: textChunk,
                embedding: embedding,
              },
            });

          totalChunksInserted++;
        } catch (err: unknown) {
          const msg = (err as Error).message || String(err);
          console.error(`[Error] Failed to ingest chunk in ${relativePath}: ${msg}`);
        }
      }
    }
  }

  console.log(`\nIngestion complete! Inserted/Updated ${totalChunksInserted} chunks.`);
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
