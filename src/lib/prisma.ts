import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildDatasourceUrl(): string | undefined {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return undefined;

  try {
    const url = new URL(rawUrl);
    const connectionLimit = parsePositiveInteger(process.env.PRISMA_CONNECTION_LIMIT);
    const poolTimeoutSeconds = parsePositiveInteger(process.env.PRISMA_POOL_TIMEOUT_SECONDS);

    if (connectionLimit) {
      url.searchParams.set("connection_limit", String(connectionLimit));
    }

    if (poolTimeoutSeconds) {
      url.searchParams.set("pool_timeout", String(poolTimeoutSeconds));
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    datasourceUrl: buildDatasourceUrl(),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
