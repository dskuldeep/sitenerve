import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeComparableUrl } from "@/lib/url-normalization";
import { computeGraphAnalytics } from "@/services/graph/builder";

const CLUSTER_COLORS = [
  "#22D3EE",
  "#34D399",
  "#60A5FA",
  "#F59E0B",
  "#A78BFA",
  "#F472B6",
  "#FB7185",
  "#2DD4BF",
  "#4ADE80",
  "#38BDF8",
  "#C084FC",
  "#FBBF24",
  "#F87171",
  "#A3E635",
  "#818CF8",
  "#06B6D4",
];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    select: { id: true },
  });

  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  const includeAnalytics = req.nextUrl.searchParams.get("analytics") !== "false";

  const [nodes, edges] = await Promise.all([
    prisma.graphNode.findMany({
      where: { projectId },
    }),
    prisma.graphEdge.findMany({
      where: { projectId },
    }),
  ]);

  let analytics = null;
  if (includeAnalytics && nodes.length > 0) {
    try {
      analytics = await computeGraphAnalytics(projectId);
    } catch (error) {
      console.error("[Graph API] Analytics computation failed:", error);
    }
  }

  const semanticSegments = analytics?.semanticSegments || [];
  const clusterByNormalizedUrl = new Map<string, { id: string; index: number }>();
  semanticSegments.forEach((segment, segmentIndex) => {
    segment.urls.forEach((url) => {
      clusterByNormalizedUrl.set(normalizeComparableUrl(url), { id: segment.id, index: segmentIndex });
    });
  });

  return NextResponse.json({
    success: true,
    data: {
      nodes: nodes.map((n) => ({
        ...((): Record<string, unknown> => {
          const clusterMeta = clusterByNormalizedUrl.get(normalizeComparableUrl(n.url));
          if (!clusterMeta) return {};

          return {
            semanticClusterId: clusterMeta.id,
            semanticClusterColor: CLUSTER_COLORS[clusterMeta.index % CLUSTER_COLORS.length],
          };
        })(),
        id: n.id,
        pageId: n.pageId,
        url: n.url,
        label: n.label,
        group: n.group,
        depth: n.depth,
        issueCount: n.issueCount,
        inboundLinks: n.inboundLinks,
        status: n.status,
        isNew: n.isNew,
        isRemoved: n.isRemoved,
        val: Math.max(3, Math.min(20, n.inboundLinks + 3)),
      })),
      links: edges.map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        anchorText: e.anchorText,
        isNew: e.isNew,
      })),
      analytics,
    },
  });
}
