import { prisma } from "@/lib/prisma";
import { normalizeComparableUrl as normalizeComparableSiteUrl } from "@/lib/url-normalization";
import type { GraphAnalytics } from "@/types/graph";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "was",
  "were",
  "with",
  "www",
  "com",
  "org",
  "net",
  "page",
  "pages",
]);

interface SemanticPage {
  index: number;
  nodeId: string;
  normalizedUrl: string;
  url: string;
  group: string;
  depth: number;
  issueCount: number;
  inboundLinks: number;
  vector: Map<string, number>;
  norm: number;
  topKeywords: string[];
}

interface KnnNeighbor {
  index: number;
  similarity: number;
  sharedKeywords: string[];
}

function roundTo(value: number, decimals: number = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function intersectKeywords(a: string[], b: string[], limit: number): string[] {
  if (a.length === 0 || b.length === 0) return [];
  const bSet = new Set(b);
  const shared: string[] = [];
  for (const keyword of a) {
    if (!bSet.has(keyword)) continue;
    shared.push(keyword);
    if (shared.length >= limit) break;
  }
  return shared;
}

function normalizeKeyword(raw: string): string | null {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < 3) return null;
  if (/^\d+$/.test(cleaned)) return null;
  if (STOPWORDS.has(cleaned)) return null;
  return cleaned;
}

function extractUrlTokenKeywords(url: string): string[] {
  try {
    const parsed = new URL(url);
    const tokens: string[] = [];
    for (const segment of parsed.pathname.split("/").filter(Boolean)) {
      const cleaned = decodeURIComponent(segment)
        .replace(/[^a-zA-Z0-9_-]/g, " ")
        .toLowerCase();
      for (const token of cleaned.split(/[\s_-]+/)) {
        const normalized = normalizeKeyword(token);
        if (normalized) tokens.push(normalized);
      }
    }
    return tokens;
  } catch {
    return [];
  }
}

function extractUrlGroup(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts[0] || "root";
  } catch {
    return "root";
  }
}

function extractUrlSegments(url: string): string[] {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

interface StoredLink {
  href: string;
  text: string | null;
}

function extractStoredLinks(raw: unknown): StoredLink[] {
  if (!Array.isArray(raw)) return [];
  const links: StoredLink[] = [];

  for (const entry of raw) {
    if (typeof entry === "string") {
      if (entry.trim().length === 0) continue;
      links.push({ href: entry, text: null });
      continue;
    }

    if (!entry || typeof entry !== "object") continue;
    const href = (entry as { href?: unknown }).href;
    if (typeof href !== "string" || href.trim().length === 0) continue;
    const text = (entry as { text?: unknown }).text;
    links.push({
      href,
      text: typeof text === "string" && text.trim().length > 0 ? text : null,
    });
  }

  return links;
}

export async function buildGraph(projectId: string): Promise<void> {
  const pages = await prisma.page.findMany({
    where: { projectId },
    include: {
      issues: {
        where: { status: "ACTIVE" },
        select: { severity: true },
      },
    },
  });

  const pageByUrl = new Map<string, (typeof pages)[number]>();
  for (const page of pages) {
    pageByUrl.set(normalizeComparableSiteUrl(page.url), page);
  }

  const outboundTargets = new Map<string, Map<string, string | null>>();
  const inboundCounts = new Map<string, number>();

  for (const page of pages) {
    const sourceUrl = normalizeComparableSiteUrl(page.url);
    const targetMap = new Map<string, string | null>();
    const combinedLinks = [
      ...extractStoredLinks(page.internalLinks),
      ...extractStoredLinks(page.externalLinks),
    ];

    for (const link of combinedLinks) {
      let targetUrl: string;
      try {
        targetUrl = normalizeComparableSiteUrl(new URL(link.href, page.url).href);
      } catch {
        continue;
      }

      if (targetUrl === sourceUrl) continue;
      if (!pageByUrl.has(targetUrl)) continue;
      if (!targetMap.has(targetUrl)) {
        targetMap.set(targetUrl, link.text?.substring(0, 200) || null);
      }
    }

    outboundTargets.set(sourceUrl, targetMap);
    for (const targetUrl of targetMap.keys()) {
      inboundCounts.set(targetUrl, (inboundCounts.get(targetUrl) || 0) + 1);
    }
  }

  await prisma.graphEdge.deleteMany({ where: { projectId } });
  await prisma.graphNode.deleteMany({ where: { projectId } });

  const nodeMap = new Map<string, string>();

  for (const page of pages) {
    const urlObj = new URL(page.url);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    const group = pathParts[0] || "root";
    const label = "/" + (pathParts[pathParts.length - 1] || "");
    const inboundLinks = inboundCounts.get(normalizeComparableSiteUrl(page.url)) || 0;

    let status = "healthy";
    if (page.statusCode && page.statusCode >= 400) {
      status = "unreachable";
    } else if (page.issues.some((i) => i.severity === "CRITICAL" || i.severity === "HIGH")) {
      status = "high";
    } else if (page.issues.some((i) => i.severity === "MEDIUM")) {
      status = "medium";
    } else if (page.issues.some((i) => i.severity === "LOW")) {
      status = "low";
    }

    const node = await prisma.graphNode.create({
      data: {
        projectId,
        pageId: page.id,
        url: page.url,
        label,
        group,
        depth: page.depth,
        issueCount: page.issues.length,
        inboundLinks,
        status,
      },
    });

    nodeMap.set(normalizeComparableSiteUrl(page.url), node.id);
  }

  const edgeRows: Array<{
    projectId: string;
    sourceNodeId: string;
    targetNodeId: string;
    anchorText: string | null;
  }> = [];

  for (const [sourceUrl, targets] of outboundTargets.entries()) {
    const sourceNodeId = nodeMap.get(sourceUrl);
    if (!sourceNodeId) continue;

    for (const [targetUrl, anchorText] of targets.entries()) {
      const targetNodeId = nodeMap.get(targetUrl);
      if (!targetNodeId || targetNodeId === sourceNodeId) continue;

      edgeRows.push({
        projectId,
        sourceNodeId,
        targetNodeId,
        anchorText,
      });
    }
  }

  if (edgeRows.length > 0) {
    await prisma.graphEdge.createMany({
      data: edgeRows,
      skipDuplicates: true,
    });
  }
}

export async function computeGraphAnalytics(projectId: string): Promise<GraphAnalytics> {
  const nodes = await prisma.graphNode.findMany({
    where: { projectId },
    include: {
      page: {
        select: { title: true, wordCount: true, url: true },
      },
    },
  });

  const edges = await prisma.graphEdge.findMany({
    where: { projectId },
  });

  const keywords = await prisma.pageKeyword.findMany({
    where: {
      page: { projectId },
    },
    select: {
      keyword: true,
      score: true,
      page: { select: { url: true } },
    },
    orderBy: { score: "desc" },
    take: 5000,
  });

  if (nodes.length === 0) {
    return {
      totalNodes: 0,
      totalEdges: edges.length,
      orphanPages: [],
      depthDistribution: {},
      groupDistribution: {},
      topLinked: [],
      linkStarved: [],
      clusters: [],
      semanticKnn: [],
      semanticSegments: [],
      bridgePages: [],
      linkOpportunities: [],
      cannibalizationRisks: [],
      keywordDistribution: {},
    };
  }

  const normalizedToDisplayUrl = new Map<string, string>();
  for (const node of nodes) {
    const normalized = normalizeComparableSiteUrl(node.url);
    if (!normalizedToDisplayUrl.has(normalized)) {
      normalizedToDisplayUrl.set(normalized, node.url);
    }
  }

  const orphanPages = nodes
    .filter((node) => {
      const segments = extractUrlSegments(node.url);
      return node.inboundLinks === 0 && segments.length > 0;
    })
    .map((node) => ({
      url: node.url,
      pageId: node.pageId,
      title: node.page?.title ?? null,
      wordCount: node.page?.wordCount ?? null,
    }));

  const depthDistribution: Record<number, number> = {};
  for (const node of nodes) {
    depthDistribution[node.depth] = (depthDistribution[node.depth] || 0) + 1;
  }

  const groupData: Record<string, { count: number; totalIssues: number; totalInbound: number }> = {};
  for (const node of nodes) {
    const group = node.group || "root";
    if (!groupData[group]) groupData[group] = { count: 0, totalIssues: 0, totalInbound: 0 };
    groupData[group].count += 1;
    groupData[group].totalIssues += node.issueCount;
    groupData[group].totalInbound += node.inboundLinks;
  }

  const groupDistribution: Record<string, { count: number; avgIssues: number; avgInbound: number }> = {};
  for (const [group, data] of Object.entries(groupData)) {
    groupDistribution[group] = {
      count: data.count,
      avgIssues: roundTo(data.totalIssues / data.count, 2),
      avgInbound: roundTo(data.totalInbound / data.count, 2),
    };
  }

  const topLinked = [...nodes]
    .sort((a, b) => b.inboundLinks - a.inboundLinks)
    .slice(0, 15)
    .map((node) => ({
      url: node.url,
      inboundLinks: node.inboundLinks,
      issueCount: node.issueCount,
    }));

  const linkStarved = nodes
    .filter((node) => node.inboundLinks <= 1 && (node.page?.wordCount ?? 0) > 500)
    .sort((a, b) => (b.page?.wordCount ?? 0) - (a.page?.wordCount ?? 0))
    .slice(0, 20)
    .map((node) => ({
      url: node.url,
      inboundLinks: node.inboundLinks,
      wordCount: node.page?.wordCount ?? null,
    }));

  const pageKeywordScores = new Map<string, Map<string, number>>();
  const keywordAgg = new Map<string, { totalScore: number; pages: Set<string> }>();

  const getPageScoreMap = (normalizedUrl: string): Map<string, number> => {
    const existing = pageKeywordScores.get(normalizedUrl);
    if (existing) return existing;
    const created = new Map<string, number>();
    pageKeywordScores.set(normalizedUrl, created);
    return created;
  };

  for (const item of keywords) {
    const normalizedUrl = normalizeComparableSiteUrl(item.page.url);
    if (!normalizedToDisplayUrl.has(normalizedUrl)) {
      normalizedToDisplayUrl.set(normalizedUrl, item.page.url);
    }

    const normalizedKeyword = normalizeKeyword(item.keyword);
    if (!normalizedKeyword) continue;

    const score = Math.max(0.05, item.score);
    const pageScores = getPageScoreMap(normalizedUrl);
    pageScores.set(normalizedKeyword, (pageScores.get(normalizedKeyword) || 0) + score);

    if (normalizedKeyword.includes(" ")) {
      for (const token of normalizedKeyword.split(" ")) {
        const tokenKeyword = normalizeKeyword(token);
        if (!tokenKeyword || tokenKeyword === normalizedKeyword) continue;
        pageScores.set(tokenKeyword, (pageScores.get(tokenKeyword) || 0) + score * 0.35);
      }
    }

    const agg = keywordAgg.get(normalizedKeyword) || { totalScore: 0, pages: new Set<string>() };
    agg.totalScore += score;
    agg.pages.add(normalizedUrl);
    keywordAgg.set(normalizedKeyword, agg);
  }

  for (const node of nodes) {
    const normalizedUrl = normalizeComparableSiteUrl(node.url);
    const pageScores = getPageScoreMap(normalizedUrl);
    for (const tokenKeyword of extractUrlTokenKeywords(node.url)) {
      pageScores.set(tokenKeyword, (pageScores.get(tokenKeyword) || 0) + 0.25);
    }
  }

  const docFrequency = new Map<string, number>();
  for (const scoreMap of pageKeywordScores.values()) {
    for (const term of scoreMap.keys()) {
      docFrequency.set(term, (docFrequency.get(term) || 0) + 1);
    }
  }

  const totalDocuments = Math.max(1, nodes.length);
  const semanticPages: SemanticPage[] = [];

  for (const [index, node] of nodes.entries()) {
    const normalizedUrl = normalizeComparableSiteUrl(node.url);
    const scoreMap = pageKeywordScores.get(normalizedUrl) || new Map<string, number>();
    const weightedTerms: Array<[string, number]> = [];

    for (const [term, score] of scoreMap.entries()) {
      const df = docFrequency.get(term) || 1;
      if (df > totalDocuments * 0.7) continue;

      const tf = Math.log1p(score);
      const idf = Math.log((1 + totalDocuments) / (1 + df)) + 1;
      const weight = tf * idf;
      if (weight < 0.08) continue;
      weightedTerms.push([term, weight]);
    }

    weightedTerms.sort((a, b) => b[1] - a[1]);
    const compactTerms = weightedTerms.slice(0, 24);

    if (compactTerms.length === 0) {
      compactTerms.push([`group:${node.group || extractUrlGroup(node.url)}`, 1]);
    }

    const vector = new Map<string, number>(compactTerms);
    const norm = Math.sqrt(compactTerms.reduce((sum, [, weight]) => sum + weight ** 2, 0)) || 1;
    const topKeywords = compactTerms
      .map(([term]) => term)
      .filter((term) => !term.startsWith("group:"))
      .slice(0, 10);

    semanticPages.push({
      index,
      nodeId: node.id,
      normalizedUrl,
      url: node.url,
      group: node.group || "root",
      depth: node.depth,
      issueCount: node.issueCount,
      inboundLinks: node.inboundLinks,
      vector,
      norm,
      topKeywords,
    });
  }

  const pageIndexByNormalizedUrl = new Map<string, number>();
  for (const page of semanticPages) {
    pageIndexByNormalizedUrl.set(page.normalizedUrl, page.index);
  }

  const invertedIndex = new Map<string, Array<{ index: number; weight: number }>>();
  for (const page of semanticPages) {
    for (const [term, weight] of page.vector.entries()) {
      const postings = invertedIndex.get(term) || [];
      postings.push({ index: page.index, weight });
      invertedIndex.set(term, postings);
    }
  }

  const knnByIndex = new Map<number, KnnNeighbor[]>();
  const pairSimilarity = new Map<string, number>();

  for (const page of semanticPages) {
    const candidateDots = new Map<number, number>();

    for (const [term, sourceWeight] of page.vector.entries()) {
      const postings = invertedIndex.get(term);
      if (!postings) continue;

      for (const posting of postings) {
        if (posting.index === page.index) continue;
        candidateDots.set(
          posting.index,
          (candidateDots.get(posting.index) || 0) + sourceWeight * posting.weight
        );
      }
    }

    const neighbors: KnnNeighbor[] = [];

    for (const [neighborIndex, dotProduct] of candidateDots.entries()) {
      const neighborPage = semanticPages[neighborIndex];
      if (!neighborPage) continue;

      const similarity = dotProduct / (page.norm * neighborPage.norm);
      if (similarity < 0.12) continue;

      neighbors.push({
        index: neighborIndex,
        similarity,
        sharedKeywords: intersectKeywords(page.topKeywords, neighborPage.topKeywords, 4),
      });

      const key = pairKey(page.index, neighborIndex);
      const prev = pairSimilarity.get(key) || 0;
      if (similarity > prev) {
        pairSimilarity.set(key, similarity);
      }
    }

    neighbors.sort((a, b) => b.similarity - a.similarity || b.sharedKeywords.length - a.sharedKeywords.length);
    knnByIndex.set(page.index, neighbors.slice(0, 6));
  }

  const adjacency = Array.from({ length: semanticPages.length }, () => new Set<number>());
  for (const [sourceIndex, neighbors] of knnByIndex.entries()) {
    for (const neighbor of neighbors) {
      const isStrongPair =
        neighbor.similarity >= 0.3 ||
        (neighbor.similarity >= 0.24 && neighbor.sharedKeywords.length >= 2);

      if (!isStrongPair) continue;
      adjacency[sourceIndex].add(neighbor.index);
      adjacency[neighbor.index].add(sourceIndex);
    }
  }

  const visited = new Set<number>();
  const segmentBuckets: number[][] = [];

  for (const page of semanticPages) {
    if (visited.has(page.index)) continue;

    const queue: number[] = [page.index];
    const component: number[] = [];
    visited.add(page.index);

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      component.push(current);

      for (const neighbor of adjacency[current]) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    if (component.length >= 2) {
      segmentBuckets.push(component);
    }
  }

  const provisionalSegmentByPage = new Map<number, number>();
  for (const [segmentIndex, bucket] of segmentBuckets.entries()) {
    for (const pageIndex of bucket) {
      provisionalSegmentByPage.set(pageIndex, segmentIndex);
    }
  }

  for (const page of semanticPages) {
    if (provisionalSegmentByPage.has(page.index)) continue;

    const fallbackNeighbor = (knnByIndex.get(page.index) || []).find(
      (neighbor) =>
        neighbor.similarity >= 0.24 &&
        provisionalSegmentByPage.has(neighbor.index)
    );

    if (!fallbackNeighbor) continue;

    const segmentIndex = provisionalSegmentByPage.get(fallbackNeighbor.index);
    if (segmentIndex === undefined) continue;

    segmentBuckets[segmentIndex].push(page.index);
    provisionalSegmentByPage.set(page.index, segmentIndex);
  }

  const orderedBuckets = segmentBuckets
    .filter((bucket) => bucket.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 30);

  const segmentByPage = new Map<number, number>();
  for (const [segmentIndex, bucket] of orderedBuckets.entries()) {
    for (const pageIndex of bucket) {
      segmentByPage.set(pageIndex, segmentIndex);
    }
  }

  const semanticSegments: GraphAnalytics["semanticSegments"] = orderedBuckets.map((bucket, idx) => {
    const bucketSet = new Set(bucket);
    const keywordWeights = new Map<string, number>();
    const groupCounts = new Map<string, number>();

    let totalDepth = 0;
    let totalIssues = 0;

    for (const pageIndex of bucket) {
      const page = semanticPages[pageIndex];
      if (!page) continue;

      totalDepth += page.depth;
      totalIssues += page.issueCount;
      groupCounts.set(page.group, (groupCounts.get(page.group) || 0) + 1);

      for (const [term, weight] of page.vector.entries()) {
        if (term.startsWith("group:")) continue;
        keywordWeights.set(term, (keywordWeights.get(term) || 0) + weight);
      }
    }

    const topKeywords = [...keywordWeights.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([term]) => term);

    const dominantGroup = [...groupCounts.entries()]
      .sort((a, b) => b[1] - a[1])[0]?.[0] || "root";

    const label = topKeywords.length >= 2
      ? `${topKeywords[0]} + ${topKeywords[1]}`
      : `/${dominantGroup}`;

    let cohesionSum = 0;
    let cohesionCount = 0;

    for (const pageIndex of bucket) {
      const neighbors = knnByIndex.get(pageIndex) || [];
      for (const neighbor of neighbors) {
        if (neighbor.index <= pageIndex) continue;
        if (!bucketSet.has(neighbor.index)) continue;
        cohesionSum += neighbor.similarity;
        cohesionCount += 1;
      }
    }

    return {
      id: `semantic-${idx + 1}`,
      label,
      urls: bucket.map((pageIndex) => semanticPages[pageIndex]?.url).filter((url): url is string => Boolean(url)),
      size: bucket.length,
      avgDepth: roundTo(totalDepth / bucket.length, 1),
      totalIssues,
      keywords: topKeywords,
      cohesion: cohesionCount > 0 ? roundTo(cohesionSum / cohesionCount, 3) : 0,
    };
  });

  const clusters: GraphAnalytics["clusters"] = semanticSegments.map((segment) => ({
    id: segment.id,
    label: segment.label,
    urls: segment.urls,
    avgDepth: segment.avgDepth,
    totalIssues: segment.totalIssues,
    keywords: segment.keywords,
  }));

  if (clusters.length === 0) {
    const fallbackClusterMap = new Map<string, { urls: string[]; depths: number[]; issues: number }>();

    for (const node of nodes) {
      const segments = extractUrlSegments(node.url);
      const clusterKey = segments.length >= 2
        ? `/${segments[0]}/${segments[1]}`
        : `/${segments[0] || "root"}`;

      const cluster = fallbackClusterMap.get(clusterKey) || { urls: [], depths: [], issues: 0 };
      cluster.urls.push(node.url);
      cluster.depths.push(node.depth);
      cluster.issues += node.issueCount;
      fallbackClusterMap.set(clusterKey, cluster);
    }

    for (const [clusterKey, clusterData] of fallbackClusterMap.entries()) {
      if (clusterData.urls.length < 2) continue;

      const keywordCounts = new Map<string, number>();
      for (const url of clusterData.urls) {
        const normalized = normalizeComparableSiteUrl(url);
        const scoreMap = pageKeywordScores.get(normalized);
        if (!scoreMap) continue;
        const topTerms = [...scoreMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([term]) => term);

        for (const keyword of topTerms) {
          keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
        }
      }

      clusters.push({
        id: clusterKey,
        label: clusterKey,
        urls: clusterData.urls.slice(0, 50),
        avgDepth: roundTo(
          clusterData.depths.reduce((sum, depth) => sum + depth, 0) / clusterData.depths.length,
          1
        ),
        totalIssues: clusterData.issues,
        keywords: [...keywordCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([keyword]) => keyword),
      });
    }
  }

  const bridgePages: GraphAnalytics["bridgePages"] = [];
  for (const page of semanticPages) {
    const ownSegment = segmentByPage.get(page.index);
    if (ownSegment === undefined) continue;

    const crossSegments = new Set<number>();
    for (const neighbor of knnByIndex.get(page.index) || []) {
      if (neighbor.similarity < 0.22) continue;
      const neighborSegment = segmentByPage.get(neighbor.index);
      if (neighborSegment === undefined || neighborSegment === ownSegment) continue;
      crossSegments.add(neighborSegment);
    }

    if (crossSegments.size === 0) continue;

    bridgePages.push({
      url: page.url,
      segmentCount: crossSegments.size + 1,
      inboundLinks: page.inboundLinks,
      issueCount: page.issueCount,
    });
  }

  bridgePages.sort((a, b) => {
    if (b.segmentCount !== a.segmentCount) return b.segmentCount - a.segmentCount;
    if (a.inboundLinks !== b.inboundLinks) return a.inboundLinks - b.inboundLinks;
    return b.issueCount - a.issueCount;
  });

  const nodeIdToNormalizedUrl = new Map<string, string>();
  for (const page of semanticPages) {
    nodeIdToNormalizedUrl.set(page.nodeId, page.normalizedUrl);
  }

  const existingLinks = new Set<string>();
  for (const edge of edges) {
    const sourceUrl = nodeIdToNormalizedUrl.get(edge.sourceNodeId);
    const targetUrl = nodeIdToNormalizedUrl.get(edge.targetNodeId);
    if (!sourceUrl || !targetUrl) continue;
    existingLinks.add(`${sourceUrl}->${targetUrl}`);
  }

  const opportunityCandidates: Array<GraphAnalytics["linkOpportunities"][number] & { rank: number }> = [];

  for (const page of semanticPages) {
    if (page.inboundLinks > 2 && page.issueCount === 0) continue;

    for (const neighbor of knnByIndex.get(page.index) || []) {
      if (neighbor.similarity < 0.34) continue;

      const target = semanticPages[neighbor.index];
      if (!target) continue;

      if (existingLinks.has(`${page.normalizedUrl}->${target.normalizedUrl}`)) continue;
      if (existingLinks.has(`${target.normalizedUrl}->${page.normalizedUrl}`)) continue;
      if (page.normalizedUrl === target.normalizedUrl) continue;

      if (page.inboundLinks > target.inboundLinks && neighbor.similarity < 0.45) {
        continue;
      }

      const sharedKeywords = neighbor.sharedKeywords.slice(0, 3);
      const reason = sharedKeywords.length > 0
        ? `Shared intent around: ${sharedKeywords.join(", ")}`
        : "Strong semantic overlap and no direct internal link";

      opportunityCandidates.push({
        fromUrl: page.url,
        toUrl: target.url,
        similarity: roundTo(neighbor.similarity, 3),
        sharedKeywords,
        reason,
        rank: neighbor.similarity * (1 + Math.max(0, target.inboundLinks - page.inboundLinks) * 0.03),
      });
    }
  }

  const dedupedOpportunities = new Map<string, GraphAnalytics["linkOpportunities"][number] & { rank: number }>();
  for (const opportunity of opportunityCandidates) {
    const key = `${opportunity.fromUrl}->${opportunity.toUrl}`;
    const existing = dedupedOpportunities.get(key);
    if (!existing || opportunity.rank > existing.rank) {
      dedupedOpportunities.set(key, opportunity);
    }
  }

  const linkOpportunities = [...dedupedOpportunities.values()]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 25)
    .map((opportunity) => ({
      fromUrl: opportunity.fromUrl,
      toUrl: opportunity.toUrl,
      similarity: opportunity.similarity,
      sharedKeywords: opportunity.sharedKeywords,
      reason: opportunity.reason,
    }));

  const cannibalizationRisks: GraphAnalytics["cannibalizationRisks"] = [];
  for (const [keyword, data] of keywordAgg.entries()) {
    const pageCount = data.pages.size;
    if (pageCount < 3 || pageCount > 10) continue;

    const pages = Array.from(data.pages);
    let similaritySum = 0;
    let similarityCount = 0;

    for (let i = 0; i < pages.length; i += 1) {
      for (let j = i + 1; j < pages.length; j += 1) {
        const leftIndex = pageIndexByNormalizedUrl.get(pages[i]);
        const rightIndex = pageIndexByNormalizedUrl.get(pages[j]);
        if (leftIndex === undefined || rightIndex === undefined) continue;

        const similarity = pairSimilarity.get(pairKey(leftIndex, rightIndex)) || 0;
        similaritySum += similarity;
        similarityCount += 1;
      }
    }

    if (similarityCount === 0) continue;

    const avgSimilarity = similaritySum / similarityCount;
    if (avgSimilarity < 0.24) continue;

    cannibalizationRisks.push({
      keyword,
      pageCount,
      avgSimilarity: roundTo(avgSimilarity, 3),
      avgScore: roundTo(data.totalScore / pageCount, 3),
      pages: pages
        .map((url) => normalizedToDisplayUrl.get(url) || url)
        .slice(0, 8),
    });
  }

  cannibalizationRisks.sort((a, b) => {
    const left = a.pageCount * a.avgSimilarity;
    const right = b.pageCount * b.avgSimilarity;
    return right - left;
  });

  const semanticKnn = semanticPages
    .filter((page) => (knnByIndex.get(page.index)?.length || 0) > 0)
    .sort((a, b) => b.issueCount - a.issueCount || a.inboundLinks - b.inboundLinks)
    .slice(0, 120)
    .map((page) => ({
      url: page.url,
      neighbors: (knnByIndex.get(page.index) || []).slice(0, 5).map((neighbor) => ({
        url: semanticPages[neighbor.index]?.url || "",
        similarity: roundTo(neighbor.similarity, 3),
        sharedKeywords: neighbor.sharedKeywords,
      })).filter((neighbor) => Boolean(neighbor.url)),
    }));

  const keywordDistribution: GraphAnalytics["keywordDistribution"] = {};
  const topKeywords = [...keywordAgg.entries()]
    .sort((a, b) => b[1].pages.size - a[1].pages.size)
    .slice(0, 50);

  for (const [keyword, data] of topKeywords) {
    keywordDistribution[keyword] = {
      pageCount: data.pages.size,
      avgScore: roundTo(data.totalScore / data.pages.size, 3),
      topPages: [...data.pages]
        .map((url) => normalizedToDisplayUrl.get(url) || url)
        .slice(0, 5),
    };
  }

  return {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    orphanPages,
    depthDistribution,
    groupDistribution,
    topLinked,
    linkStarved,
    clusters,
    semanticKnn,
    semanticSegments,
    bridgePages: bridgePages.slice(0, 20),
    linkOpportunities,
    cannibalizationRisks: cannibalizationRisks.slice(0, 20),
    keywordDistribution,
  };
}
