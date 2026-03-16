import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { extractKeywords } from "@/services/keywords/extractor";
import { applyTfIdf } from "@/services/keywords/scorer";

const KEYWORD_EXTRACTION_LOG_INTERVAL = 250;
const KEYWORD_WRITE_PAGE_BATCH_SIZE = 50;
const KEYWORD_CREATE_BATCH_SIZE = 500;
const PRISMA_RETRY_ATTEMPTS = 5;

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryablePrismaConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const maybeError = error as { code?: unknown; message?: unknown };
  const code = typeof maybeError.code === "string" ? maybeError.code : "";
  const message =
    typeof maybeError.message === "string"
      ? maybeError.message.toLowerCase()
      : error instanceof Error
        ? error.message.toLowerCase()
        : "";

  return (
    code === "P2024" ||
    code === "P1017" ||
    message.includes("timed out fetching a new connection") ||
    message.includes("closed the connection") ||
    message.includes("server has closed the connection") ||
    message.includes("terminating connection")
  );
}

async function withPrismaRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= PRISMA_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const shouldRetry =
        attempt < PRISMA_RETRY_ATTEMPTS && isRetryablePrismaConnectionError(error);
      if (!shouldRetry) {
        throw error;
      }

      const backoffMs = attempt * 1000;
      const reason = error instanceof Error ? error.message : "Unknown Prisma error";
      console.warn(
        `[Keyword Engine] ${label} hit a transient database error (${reason}). Retrying in ${backoffMs}ms...`
      );

      await prisma.$disconnect().catch(() => undefined);
      await wait(backoffMs);
      await prisma.$connect().catch((connectError) => {
        const message =
          connectError instanceof Error ? connectError.message : "Unknown reconnect error";
        console.warn(`[Keyword Engine] Prisma reconnect attempt failed: ${message}`);
      });
    }
  }

  throw new Error(`[Keyword Engine] ${label} failed after exhausting Prisma retries`);
}

export async function extractAndScoreKeywords(projectId: string) {
  console.log(`[Keyword Engine] Extracting keywords for project ${projectId}`);

  const pages = await withPrismaRetry("Loading project pages", () =>
    prisma.page.findMany({
      where: { projectId },
      select: {
        id: true,
        url: true,
        title: true,
        h1: true,
        h2: true,
        h3: true,
        metaDescription: true,
        wordCount: true,
        images: true,
      },
      orderBy: { id: "asc" },
    })
  );

  console.log(`[Keyword Engine] Loaded ${pages.length} pages for keyword extraction`);

  const allPageKeywords: Array<{
    pageUrl: string;
    pageId: string;
    keywords: Array<{
      keyword: string;
      score: number;
      frequency: number;
      sources: string[];
    }>;
  }> = [];

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    allPageKeywords.push({
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
        internalLinks: null,
      }),
    });

    if ((index + 1) % KEYWORD_EXTRACTION_LOG_INTERVAL === 0 || index === pages.length - 1) {
      console.log(
        `[Keyword Engine] Extracted keyword candidates for ${index + 1}/${pages.length} pages`
      );
    }
  }

  const scoredByPageUrl = new Map(
    applyTfIdf(
      allPageKeywords.map((pageKeywords) => ({
        pageUrl: pageKeywords.pageUrl,
        keywords: pageKeywords.keywords.map((keyword) => ({
          keyword: keyword.keyword,
          score: keyword.score,
        })),
      }))
    ).map((pageKeywords) => [pageKeywords.pageUrl, pageKeywords.keywords])
  );

  const pageBatches = chunkArray(allPageKeywords, KEYWORD_WRITE_PAGE_BATCH_SIZE);
  for (let batchIndex = 0; batchIndex < pageBatches.length; batchIndex += 1) {
    const pageBatch = pageBatches[batchIndex];
    const pageIds = pageBatch.map((page) => page.pageId);
    const keywordRows: Prisma.PageKeywordCreateManyInput[] = [];

    for (const page of pageBatch) {
      const scoredKeywords = scoredByPageUrl.get(page.pageUrl) || [];
      for (const keyword of scoredKeywords.slice(0, 20)) {
        const original = page.keywords.find((entry) => entry.keyword === keyword.keyword);
        keywordRows.push({
          pageId: page.pageId,
          keyword: keyword.keyword,
          score: keyword.score,
          frequency: original?.frequency || 1,
          sources: (original?.sources || []) as Prisma.InputJsonValue,
        });
      }
    }

    await withPrismaRetry(
      `Persisting keyword batch ${batchIndex + 1}/${pageBatches.length}`,
      async () => {
        await prisma.$transaction(async (tx) => {
          await tx.pageKeyword.deleteMany({
            where: { pageId: { in: pageIds } },
          });

          for (const createChunk of chunkArray(keywordRows, KEYWORD_CREATE_BATCH_SIZE)) {
            await tx.pageKeyword.createMany({
              data: createChunk,
            });
          }
        });
      }
    );

    console.log(
      `[Keyword Engine] Stored keywords for ${Math.min(
        (batchIndex + 1) * KEYWORD_WRITE_PAGE_BATCH_SIZE,
        pages.length
      )}/${pages.length} pages`
    );

    // Briefly yield between DB-heavy batches so other requests can borrow pool slots.
    await wait(25);
  }

  console.log(`[Keyword Engine] Keywords extracted for ${pages.length} pages`);
}
