import { prisma } from "@/lib/prisma";

export async function markGraphDiffs(
  projectId: string,
  newPageUrls: string[],
  removedPageUrls: string[]
): Promise<void> {
  // Reset previous flags
  await prisma.graphNode.updateMany({
    where: { projectId },
    data: { isNew: false, isRemoved: false },
  });

  // Mark new nodes
  if (newPageUrls.length > 0) {
    await prisma.graphNode.updateMany({
      where: {
        projectId,
        url: { in: newPageUrls },
      },
      data: { isNew: true },
    });
  }

  // Mark removed nodes
  if (removedPageUrls.length > 0) {
    await prisma.graphNode.updateMany({
      where: {
        projectId,
        url: { in: removedPageUrls },
      },
      data: { isRemoved: true },
    });
  }

  // Mark new edges
  await prisma.graphEdge.updateMany({
    where: { projectId },
    data: { isNew: false },
  });
}
