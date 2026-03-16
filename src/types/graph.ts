export interface GraphNodeData {
  id: string;
  pageId: string;
  url: string;
  label: string;
  group: string;
  depth: number;
  issueCount: number;
  inboundLinks: number;
  status: string;
  isNew: boolean;
  isRemoved: boolean;
  val?: number;
  color?: string;
  semanticClusterId?: string | null;
  semanticClusterColor?: string | null;
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

export interface GraphEdgeData {
  id: string;
  source: string;
  target: string;
  anchorText?: string;
  isNew: boolean;
}

export interface GraphCluster {
  id: string;
  label: string;
  urls: string[];
  avgDepth: number;
  totalIssues: number;
  keywords: string[];
}

export interface SemanticNeighbor {
  url: string;
  similarity: number;
  sharedKeywords: string[];
}

export interface SemanticKnnNode {
  url: string;
  neighbors: SemanticNeighbor[];
}

export interface SemanticSegment {
  id: string;
  label: string;
  urls: string[];
  size: number;
  avgDepth: number;
  totalIssues: number;
  keywords: string[];
  cohesion: number;
}

export interface BridgePage {
  url: string;
  segmentCount: number;
  inboundLinks: number;
  issueCount: number;
}

export interface LinkOpportunity {
  fromUrl: string;
  toUrl: string;
  similarity: number;
  sharedKeywords: string[];
  reason: string;
}

export interface CannibalizationRisk {
  keyword: string;
  pageCount: number;
  avgSimilarity: number;
  avgScore: number;
  pages: string[];
}

export interface GraphAnalytics {
  totalNodes: number;
  totalEdges: number;
  orphanPages: Array<{ url: string; pageId: string; title: string | null; wordCount: number | null }>;
  depthDistribution: Record<number, number>;
  groupDistribution: Record<string, { count: number; avgIssues: number; avgInbound: number }>;
  topLinked: Array<{ url: string; inboundLinks: number; issueCount: number }>;
  linkStarved: Array<{ url: string; inboundLinks: number; wordCount: number | null }>;
  clusters: GraphCluster[];
  semanticKnn: SemanticKnnNode[];
  semanticSegments: SemanticSegment[];
  bridgePages: BridgePage[];
  linkOpportunities: LinkOpportunity[];
  cannibalizationRisks: CannibalizationRisk[];
  keywordDistribution: Record<string, { pageCount: number; avgScore: number; topPages: string[] }>;
}

export interface GraphData {
  nodes: GraphNodeData[];
  links: GraphEdgeData[];
  analytics?: GraphAnalytics | null;
}
