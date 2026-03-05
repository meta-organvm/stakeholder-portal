export interface SystemData {
  name: string;
  tagline: string;
  total_repos: number;
  total_organs: number;
  launch_date: string;
  sprints_completed: number;
  sprint_names: string[];
  ci_workflows: number;
  dependency_edges: number;
  published_essays: number;
  active_repos: number;
  archived_repos: number;
}

export interface OrganAesthetic {
  palette: string;
  typography: string;
  tone: string;
  visual: string;
}

export interface Organ {
  key: string;
  name: string;
  greek: string;
  domain: string;
  org: string;
  description: string;
  repo_count: number;
  status: string;
  aesthetic: OrganAesthetic;
}

export interface GitStats {
  total_commits?: number;
  first_commit?: string;
  last_commit?: string;
  weekly_velocity?: number;
}

export interface Repo {
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
  git_stats: GitStats;
  sections: Record<string, string>;
  ai_context: string;
  revenue_model: string | null;
  revenue_status: string | null;
  platinum_status: boolean;
}

export interface DepNode {
  id: string;
  organ: string;
  tier: string;
}

export interface DepEdge {
  from: string;
  to: string;
}

export interface DependencyGraph {
  nodes: DepNode[];
  edges: DepEdge[];
}

export interface Deployment {
  repo: string;
  organ: string;
  url: string;
}

export interface Manifest {
  generated: string;
  system: SystemData;
  organs: Organ[];
  repos: Repo[];
  dependency_graph: DependencyGraph;
  deployments: Deployment[];
}
