import { redis } from "@/lib/redis";

const SKILLS_API_BASE = "https://skills.sh/api/v1";
const CACHE_PREFIX = "skill:";
const CACHE_TTL = 60 * 60 * 24; // 24 hours in seconds

interface SkillResponse {
  id: string;
  name: string;
  content: string;
  author: string;
  description: string;
}

async function fetchSkill(skillId: string): Promise<string | null> {
  const cacheKey = `${CACHE_PREFIX}${skillId}`;

  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Fetch from skills.sh API
  try {
    const response = await fetch(`${SKILLS_API_BASE}/skills/${skillId}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "SiteNerve/1.0",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.warn(
        `[SkillResolver] Failed to fetch skill ${skillId}: HTTP ${response.status}`
      );
      return null;
    }

    const data: SkillResponse = await response.json();
    const content = data.content;

    // Cache the result
    await redis.set(cacheKey, content, "EX", CACHE_TTL);

    return content;
  } catch (error) {
    console.error(
      `[SkillResolver] Error fetching skill ${skillId}:`,
      error instanceof Error ? error.message : error
    );

    // Fall back to cache even if expired (best-effort)
    const staleCache = await redis.get(cacheKey);
    if (staleCache) {
      console.info(`[SkillResolver] Using stale cache for skill ${skillId}`);
      return staleCache;
    }

    return null;
  }
}

export async function resolveSkills(skillIds: string[]): Promise<string[]> {
  if (skillIds.length === 0) {
    return [];
  }

  const results = await Promise.allSettled(
    skillIds.map((id) => fetchSkill(id))
  );

  const resolved: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value) {
      resolved.push(result.value);
    } else {
      console.warn(
        `[SkillResolver] Skill ${skillIds[i]} could not be resolved, skipping`
      );
    }
  }

  return resolved;
}
