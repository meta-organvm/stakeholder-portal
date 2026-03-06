#!/usr/bin/env python3
"""Generate manifest.json for the Stakeholder Intelligence Portal.

Reads registry-v2.json, system-metrics.json, seed.yaml, CLAUDE.md, README.md,
organ-aesthetic.yaml, and git logs to produce a comprehensive manifest.json
that powers the Next.js frontend and AI chat context.

Usage:
    python3 scripts/generate-manifest.py [--output src/data/manifest.json]

Requires: PyYAML (pip install pyyaml)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import yaml
except ModuleNotFoundError:  # pragma: no cover - optional dependency in CI/cloud builds
    yaml = None

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
WORKSPACE = Path(os.environ.get("ORGANVM_WORKSPACE_DIR", Path.home() / "Workspace"))
CORPUS_DIR = WORKSPACE / "meta-organvm" / "organvm-corpvs-testamentvm"
REGISTRY_PATH = CORPUS_DIR / "registry-v2.json"
METRICS_PATH = CORPUS_DIR / "system-metrics.json"
DEFAULT_OUTPUT = PROJECT_DIR / "src" / "data" / "manifest.json"

# Map organ key -> local workspace directory name
ORGAN_DIR_MAP: dict[str, str] = {
    "ORGAN-I": "organvm-i-theoria",
    "ORGAN-II": "organvm-ii-poiesis",
    "ORGAN-III": "organvm-iii-ergon",
    "ORGAN-IV": "organvm-iv-taxis",
    "ORGAN-V": "organvm-v-logos",
    "ORGAN-VI": "organvm-vi-koinonia",
    "ORGAN-VII": "organvm-vii-kerygma",
    "META-ORGANVM": "meta-organvm",
}

ORGAN_GREEK: dict[str, str] = {
    "ORGAN-I": "Theoria",
    "ORGAN-II": "Poiesis",
    "ORGAN-III": "Ergon",
    "ORGAN-IV": "Taxis",
    "ORGAN-V": "Logos",
    "ORGAN-VI": "Koinonia",
    "ORGAN-VII": "Kerygma",
    "META-ORGANVM": "Meta",
}

ORGAN_DOMAIN: dict[str, str] = {
    "ORGAN-I": "Foundational theory, recursive engines, symbolic computing",
    "ORGAN-II": "Generative art, performance systems, creative coding",
    "ORGAN-III": "Commercial products, SaaS tools, developer utilities",
    "ORGAN-IV": "Orchestration, governance, AI agents, skills",
    "ORGAN-V": "Public discourse, essays, editorial, analytics",
    "ORGAN-VI": "Community, reading groups, salons, learning",
    "ORGAN-VII": "POSSE distribution, social automation, announcements",
    "META-ORGANVM": "Cross-organ engine, schemas, dashboard, governance corpus",
}

# Deployment URL patterns to extract from CLAUDE.md
DEPLOY_URL_PATTERN = re.compile(
    r"https?://[\w.-]+\.(?:netlify\.app|onrender\.com|pages\.dev|github\.io|vercel\.app)[\w/.-]*"
)


# ---------------------------------------------------------------------------
# Markdown parser (reuses logic from organvm-engine readme_parser)
# ---------------------------------------------------------------------------


def parse_markdown_sections(path: Path) -> dict[str, str]:
    """Extract sections from a markdown file by heading (## or ###)."""
    if not path.exists():
        return {}
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return {}

    sections: dict[str, str] = {}
    current_key: str | None = None
    current_lines: list[str] = []

    for line in text.splitlines():
        match = re.match(r"^(#{2,3})\s+(.+)$", line)
        if match:
            if current_key is not None:
                sections[current_key] = "\n".join(current_lines).strip()
            current_key = match.group(2).strip().lower()
            current_lines = []
        elif current_key is not None:
            current_lines.append(line)

    if current_key is not None:
        sections[current_key] = "\n".join(current_lines).strip()

    return sections


def extract_first_paragraph(text: str) -> str:
    """Extract the first non-empty, non-code paragraph from markdown."""
    lines: list[str] = []
    in_para = False
    in_code = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code = not in_code
            if in_para:
                break
            continue
        if in_code:
            continue
        if not stripped:
            if in_para:
                break
            continue
        if stripped.startswith(("![", "|", "---", "===", "- [x]", "- [ ]")):
            if in_para:
                break
            continue
        in_para = True
        lines.append(stripped)
    return " ".join(lines)


def extract_full_text(path: Path, max_chars: int = 3000) -> str:
    """Read a file and return its text, truncated."""
    if not path.exists():
        return ""
    try:
        text = path.read_text(encoding="utf-8")
        return text[:max_chars]
    except (OSError, UnicodeDecodeError):
        return ""


# ---------------------------------------------------------------------------
# Humanize name (from organvm-engine pitchdeck data.py)
# ---------------------------------------------------------------------------


def humanize_name(repo_name: str) -> str:
    """Convert repo-name--descriptor to human-readable display name."""
    if "--" in repo_name:
        parts = repo_name.split("--", 1)
        left = parts[0].replace("-", " ").title()
        right = parts[1].replace("-", " ").title()
        return f"{left}: {right}"
    return repo_name.replace("-", " ").title()


def normalize_tech_stack(raw: Any) -> list[str]:
    """Normalize tech stack values to a strict list of non-empty strings."""
    if isinstance(raw, list):
        cleaned = [str(item).strip() for item in raw if str(item).strip()]
        return cleaned
    if isinstance(raw, str):
        parts = [part.strip() for part in re.split(r"[,;|/]", raw) if part.strip()]
        return parts
    return []


# ---------------------------------------------------------------------------
# Git stats
# ---------------------------------------------------------------------------


def git_stats(repo_path: Path) -> dict[str, Any]:
    """Gather git statistics for a local repo."""
    if not (repo_path / ".git").exists() and not (repo_path / ".git").is_file():
        return {}

    stats: dict[str, Any] = {}

    def _run(args: list[str]) -> str:
        try:
            result = subprocess.run(
                args,
                cwd=str(repo_path),
                capture_output=True,
                text=True,
                timeout=10,
            )
            return result.stdout.strip()
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return ""

    # Total commits
    count_str = _run(["git", "rev-list", "--count", "HEAD"])
    if count_str.isdigit():
        stats["total_commits"] = int(count_str)

    # First commit date
    first = _run(["git", "log", "--format=%aI", "--reverse"])
    if first:
        stats["first_commit"] = first.splitlines()[0][:10]

    # Last commit date
    last = _run(["git", "log", "--format=%aI", "-1"])
    if last:
        stats["last_commit"] = last[:10]

    # Weekly velocity (commits in last 4 weeks / 4)
    recent = _run(["git", "log", "--oneline", "--since=4 weeks ago"])
    if recent:
        count = len(recent.splitlines())
        stats["weekly_velocity"] = round(count / 4, 1)
    else:
        stats["weekly_velocity"] = 0

    return stats


# ---------------------------------------------------------------------------
# Deployment URL extraction
# ---------------------------------------------------------------------------


def extract_deployment_urls(claude_md_path: Path, registry_url: str | None = None) -> list[str]:
    """Extract deployment URLs from CLAUDE.md + registry entry."""
    urls: set[str] = set()

    if registry_url:
        urls.add(registry_url)

    if claude_md_path.exists():
        try:
            text = claude_md_path.read_text(encoding="utf-8")
            for url in DEPLOY_URL_PATTERN.findall(text):
                urls.add(url.rstrip("/"))
        except (OSError, UnicodeDecodeError):
            pass

    return sorted(urls)


# ---------------------------------------------------------------------------
# Seed.yaml reader
# ---------------------------------------------------------------------------


def read_seed(repo_path: Path) -> dict[str, Any]:
    """Read seed.yaml from a repo directory."""
    if yaml is None:
        return {}
    seed_path = repo_path / "seed.yaml"
    if not seed_path.exists():
        return {}
    try:
        with open(seed_path) as f:
            return yaml.safe_load(f) or {}
    except (yaml.YAMLError, OSError):
        return {}


# ---------------------------------------------------------------------------
# Organ aesthetic
# ---------------------------------------------------------------------------


def read_organ_aesthetic(organ_dir: Path) -> dict[str, str]:
    """Read organ-aesthetic.yaml from .github/ within an organ directory."""
    if yaml is None:
        return {}
    path = organ_dir / ".github" / "organ-aesthetic.yaml"
    if not path.exists():
        return {}
    try:
        with open(path) as f:
            data = yaml.safe_load(f) or {}
        modifiers = data.get("modifiers", {})
        return {
            "palette": modifiers.get("palette_shift", ""),
            "typography": modifiers.get("typography_emphasis", ""),
            "tone": modifiers.get("tone_shift", ""),
            "visual": modifiers.get("visual_shift", ""),
        }
    except (yaml.YAMLError, OSError):
        return {}


# ---------------------------------------------------------------------------
# File Index builder
# ---------------------------------------------------------------------------

def get_file_index(repo_path: Path) -> list[str]:
    """Get a lightweight file index for the AI highlighting key paths."""
    if not (repo_path / ".git").exists() and not (repo_path / ".git").is_file():
        return []

    try:
        result = subprocess.run(
            ["git", "ls-files"],
            cwd=str(repo_path),
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return []

        all_files = result.stdout.splitlines()

        high_value = set()
        for f in all_files:
            # Root level markdown or key metadata
            if "/" not in f and (f.endswith(".md") or f in ("package.json", "Cargo.toml", "seed.yaml")):
                high_value.add(f)
            # Markdown everywhere
            elif f.endswith(".md"):
                high_value.add(f)
            # Conductor, archetypes, and similar high value logic
            elif f.startswith("conductor/") or f.startswith("archetypes/") or f.startswith("src/core/"):
                high_value.add(f)
            # Scripts
            elif f.startswith("scripts/") and f.endswith((".py", ".ts", ".sh")):
                high_value.add(f)
            # Add top-level directory hints
            if "/" in f:
                root_dir = f.split("/")[0] + "/"
                high_value.add(root_dir)

        return sorted(high_value)[:500]
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []


# ---------------------------------------------------------------------------
# AI context builder
# ---------------------------------------------------------------------------


def build_ai_context(
    repo_name: str,
    description: str,
    tech_stack: list[str],
    sections: dict[str, str],
    deployment_urls: list[str],
    organ_key: str,
) -> str:
    """Build a 200-500 word combined summary for AI retrieval."""
    parts: list[str] = []

    display = humanize_name(repo_name)
    parts.append(f"{display} ({repo_name}) — {organ_key}.")

    if description:
        parts.append(description[:300])

    if tech_stack:
        parts.append(f"Tech stack: {', '.join(tech_stack[:10])}.")

    # Key sections
    for key in ("what this is", "architecture", "features"):
        text = sections.get(key, "")
        if text:
            para = extract_first_paragraph(text)
            if para:
                parts.append(para[:200])

    if deployment_urls:
        parts.append(f"Deployed at: {', '.join(deployment_urls[:3])}.")

    combined = " ".join(parts)
    # Truncate to ~500 words
    words = combined.split()
    if len(words) > 500:
        combined = " ".join(words[:500]) + "..."

    return combined


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------


def generate_manifest(output_path: Path, allow_stale_manifest: bool = False) -> None:
    """Generate the full manifest.json."""
    if not REGISTRY_PATH.exists():
        if allow_stale_manifest and output_path.exists():
            print(
                f"WARNING: Registry not found at {REGISTRY_PATH}; "
                f"keeping existing manifest at {output_path}"
            )
            return
        raise FileNotFoundError(
            f"Registry not found at {REGISTRY_PATH}. "
            "Set ORGANVM_WORKSPACE_DIR or pass --allow-stale-manifest with an existing output file."
        )

    print(f"Loading registry from {REGISTRY_PATH}")
    with open(REGISTRY_PATH) as f:
        registry = json.load(f)

    # Load system metrics
    metrics: dict[str, Any] = {}
    if METRICS_PATH.exists():
        with open(METRICS_PATH) as f:
            metrics = json.load(f)

    computed = metrics.get("computed", {})

    # System-level data
    system_data = {
        "name": "ORGANVM",
        "tagline": "Eight-organ creative-institutional system",
        "total_repos": computed.get("total_repos", 0),
        "total_organs": computed.get("total_organs", 8),
        "launch_date": registry.get("launch_date", "2026-02-11"),
        "sprints_completed": computed.get("sprints_completed", 0),
        "sprint_names": computed.get("sprint_names", []),
        "ci_workflows": computed.get("ci_workflows", 0),
        "dependency_edges": computed.get("dependency_edges", 0),
        "published_essays": computed.get("published_essays", 0),
        "active_repos": computed.get("active_repos", 0),
        "archived_repos": computed.get("archived_repos", 0),
    }

    # Organs
    organs_data: list[dict[str, Any]] = []
    for organ_key, organ_info in registry.get("organs", {}).items():
        organ_dir_name = ORGAN_DIR_MAP.get(organ_key, "")
        organ_dir = WORKSPACE / organ_dir_name if organ_dir_name else None

        aesthetic = {}
        if organ_dir and organ_dir.exists():
            aesthetic = read_organ_aesthetic(organ_dir)

        organs_data.append({
            "key": organ_key,
            "name": organ_info.get("name", ""),
            "greek": ORGAN_GREEK.get(organ_key, ""),
            "domain": ORGAN_DOMAIN.get(organ_key, ""),
            "org": organ_dir_name,
            "description": organ_info.get("description", ""),
            "repo_count": len(organ_info.get("repositories", [])),
            "status": organ_info.get("launch_status", "OPERATIONAL"),
            "aesthetic": aesthetic,
        })

    # Repos
    repos_data: list[dict[str, Any]] = []
    dep_edges: list[dict[str, str]] = []
    total_processed = 0

    for organ_key, organ_info in registry.get("organs", {}).items():
        organ_dir_name = ORGAN_DIR_MAP.get(organ_key, "")
        organ_dir = WORKSPACE / organ_dir_name if organ_dir_name else None

        for repo_entry in organ_info.get("repositories", []):
            name = repo_entry.get("name", "")
            if not name:
                continue

            org = repo_entry.get("org", organ_dir_name)
            slug = name  # use repo name as slug

            # Find local path
            repo_path: Path | None = None
            if organ_dir and organ_dir.exists():
                candidate = organ_dir / name
                if candidate.exists():
                    repo_path = candidate

            # Seed data
            seed = read_seed(repo_path) if repo_path else {}
            seed_meta = seed.get("metadata", {})

            # Markdown sections from CLAUDE.md and README.md
            claude_sections: dict[str, str] = {}
            readme_sections: dict[str, str] = {}
            if repo_path:
                claude_sections = parse_markdown_sections(repo_path / "CLAUDE.md")
                readme_sections = parse_markdown_sections(repo_path / "README.md")

            # Merge sections (CLAUDE.md takes precedence)
            all_sections: dict[str, str] = {}
            all_sections.update(readme_sections)
            all_sections.update(claude_sections)

            # Description: registry > seed > README
            description = repo_entry.get("description", "")
            if not description and seed_meta.get("description"):
                description = seed_meta["description"]
            if not description and "what this is" in all_sections:
                description = extract_first_paragraph(all_sections["what this is"])

            # Tech stack
            tech_stack = normalize_tech_stack(repo_entry.get("tech_stack"))
            if not tech_stack:
                tech_stack = normalize_tech_stack(seed_meta.get("tags"))

            # Extract key sections
            sections: dict[str, str] = {}
            for key in ("what this is", "architecture", "features", "build & dev commands",
                         "conventions", "environment", "key design constraints",
                         "remaining limitations", "key files", "data integrity rules", "schemas"):
                if key in all_sections:
                    sections[key] = all_sections[key][:2500]

            # Dependencies
            deps = repo_entry.get("dependencies", [])
            for dep in deps:
                dep_edges.append({"from": f"{org}/{name}", "to": dep})

            # Produces/consumes from seed
            produces: list[str] = []
            consumes: list[str] = []
            for edge in seed.get("produces", []):
                if isinstance(edge, dict):
                    art = edge.get("artifact") or edge.get("type") or ""
                    desc = edge.get("description", "")
                    produces.append(f"{art}: {desc}" if desc else art)
                else:
                    produces.append(str(edge))
            for edge in seed.get("consumes", []):
                if isinstance(edge, dict):
                    art = edge.get("artifact") or edge.get("type") or ""
                    desc = edge.get("description", "")
                    consumes.append(f"{art}: {desc}" if desc else art)
                else:
                    consumes.append(str(edge))

            # Deployment URLs
            registry_url = repo_entry.get("deployment_url", None)
            deployment_urls: list[str] = []
            if repo_path:
                deployment_urls = extract_deployment_urls(
                    repo_path / "CLAUDE.md", registry_url
                )
            elif registry_url:
                deployment_urls = [registry_url]

            # Git stats
            gs = git_stats(repo_path) if repo_path else {}

            # File index
            file_index = get_file_index(repo_path) if repo_path else []

            # AI context
            ai_context = build_ai_context(
                name, description, tech_stack, all_sections, deployment_urls, organ_key
            )

            repos_data.append({
                "name": name,
                "display_name": humanize_name(name),
                "slug": slug,
                "organ": organ_key,
                "org": org,
                "tier": repo_entry.get("tier", "standard"),
                "status": repo_entry.get("implementation_status", "ACTIVE"),
                "promotion_status": repo_entry.get("promotion_status", "LOCAL"),
                "description": description,
                "tech_stack": tech_stack,
                "ci_workflow": repo_entry.get("ci_workflow"),
                "dependencies": deps,
                "produces": produces,
                "consumes": consumes,
                "deployment_urls": deployment_urls,
                "github_url": f"https://github.com/{org}/{name}" if org else "",
                "git_stats": gs,
                "file_index": file_index,
                "sections": sections,
                "ai_context": ai_context,
                "revenue_model": repo_entry.get("revenue_model"),
                "revenue_status": repo_entry.get("revenue_status"),
                "platinum_status": repo_entry.get("platinum_status", False),
            })
            total_processed += 1

    # Dependency graph
    dep_graph = {
        "nodes": [{"id": f"{r['org']}/{r['name']}", "organ": r["organ"], "tier": r["tier"]}
                  for r in repos_data],
        "edges": dep_edges,
    }

    # Deployments summary
    deployments = []
    for r in repos_data:
        for url in r.get("deployment_urls", []):
            deployments.append({
                "repo": r["name"],
                "organ": r["organ"],
                "url": url,
            })

    # Assemble manifest
    manifest = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "system": system_data,
        "organs": organs_data,
        "repos": repos_data,
        "dependency_graph": dep_graph,
        "deployments": deployments,
    }

    # Write output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(manifest, f, indent=2, default=str)
        f.write("\n")

    print(f"Generated manifest: {total_processed} repos, {len(dep_edges)} dep edges, "
          f"{len(deployments)} deployments -> {output_path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate stakeholder manifest.json")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output path (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--allow-stale-manifest",
        action="store_true",
        help="If registry source files are unavailable, keep existing output file instead of failing.",
    )
    args = parser.parse_args()
    generate_manifest(args.output, allow_stale_manifest=args.allow_stale_manifest)
