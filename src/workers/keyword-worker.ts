import { Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@/lib/prisma";
import { extractKeywords } from "@/services/keywords/extractor";
import { applyTfIdf } from "@/services/keywords/scorer";

export async function extractAndScoreKeywords(projectId: string) {
  console.log(`[Keyword Engine] Extracting keywords for project ${projectId}`);

  const pages = await prisma.page.findMany({
    where: { projectId },
  });

    // Extract keywords per page
    const allPageKeywords = pages.map((page) => ({
      pageUrl: page.url,
      pageId: page.id,
      keywords: extractKeywords({
        title: page.title,
        h1: page.h1,
        h2: page.h2,
        h3: page.h3,
        metaDescription: page.metaDescription,
        url: page.url,
        wordCount: page.wordCount,
        images: page.images as Array<{ alt: string }> | null,
        internalLinks: page.internalLinks as Array<{ text: string }> | null,
      }),
    }));

    // Apply TF-IDF scoring
    const scored = applyTfIdf(
      allPageKeywords.map((p) => ({
        pageUrl: p.pageUrl,
        keywords: p.keywords.map((k) => ({ keyword: k.keyword, score: k.score })),
      }))
    );

    // Store keywords
    for (const page of allPageKeywords) {
      const scoredPage = scored.find((s) => s.pageUrl === page.pageUrl);
      if (!scoredPage) continue;

      // Delete existing keywords for this page
      await prisma.pageKeyword.deleteMany({
        where: { pageId: page.pageId },
      });

      // Create new keywords
      for (const kw of scoredPage.keywords.slice(0, 20)) {
        const original = page.keywords.find((k) => k.keyword === kw.keyword);
        await prisma.pageKeyword.create({
          data: {
            pageId: page.pageId,
            keyword: kw.keyword,
            score: kw.score,
            frequency: original?.frequency || 1,
            sources: original?.sources || [],
          },
        });
      }
    }

  console.log(`[Keyword Engine] Keywords extracted for ${pages.length} pages`);
}
