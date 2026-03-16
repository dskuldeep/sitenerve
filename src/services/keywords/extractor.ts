const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
  "had", "has", "have", "he", "her", "his", "how", "i", "if", "in", "into",
  "is", "it", "its", "just", "me", "my", "no", "nor", "not", "of", "on",
  "or", "our", "out", "own", "say", "she", "so", "some", "than", "that",
  "the", "their", "them", "then", "there", "these", "they", "this", "to",
  "too", "us", "very", "was", "we", "were", "what", "when", "where", "which",
  "who", "whom", "why", "will", "with", "you", "your", "about", "after",
  "all", "also", "am", "any", "been", "before", "being", "between", "both",
  "can", "did", "do", "does", "each", "few", "get", "got", "here", "him",
  "how", "more", "most", "much", "must", "new", "now", "off", "old", "one",
  "only", "other", "over", "said", "same", "should", "such", "take", "tell",
  "through", "under", "up", "use", "way", "well", "would",
]);

interface SignalWeight {
  text: string;
  weight: number;
  source: string;
}

interface KeywordResult {
  keyword: string;
  score: number;
  frequency: number;
  sources: string[];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function generateNgrams(tokens: string[], maxN: number = 4): string[] {
  const ngrams: string[] = [];

  for (let n = 1; n <= Math.min(maxN, tokens.length); n++) {
    for (let i = 0; i <= tokens.length - n; i++) {
      const gram = tokens.slice(i, i + n).join(" ");
      // Skip if any word is a stop word (for multi-word n-grams)
      if (n > 1 && tokens.slice(i, i + n).some((t) => STOP_WORDS.has(t))) continue;
      ngrams.push(gram);
    }
  }

  return ngrams;
}

export function extractKeywords(page: {
  title: string | null;
  h1: string[];
  h2: string[];
  h3: string[];
  metaDescription: string | null;
  url: string;
  wordCount: number | null;
  images: Array<{ alt: string }> | null;
  internalLinks: Array<{ text: string }> | null;
}): KeywordResult[] {
  const signals: SignalWeight[] = [];

  // Title (10x weight)
  if (page.title) {
    const tokens = tokenize(page.title);
    const ngrams = generateNgrams(tokens, 3);
    ngrams.forEach((g) => signals.push({ text: g, weight: 10, source: "title" }));
  }

  // H1 (8x weight)
  for (const h of page.h1) {
    const tokens = tokenize(h);
    const ngrams = generateNgrams(tokens, 3);
    ngrams.forEach((g) => signals.push({ text: g, weight: 8, source: "h1" }));
  }

  // Meta description (5x weight)
  if (page.metaDescription) {
    const tokens = tokenize(page.metaDescription);
    const ngrams = generateNgrams(tokens, 3);
    ngrams.forEach((g) => signals.push({ text: g, weight: 5, source: "meta_description" }));
  }

  // H2-H3 headings (4x weight)
  for (const h of [...page.h2, ...page.h3]) {
    const tokens = tokenize(h);
    const ngrams = generateNgrams(tokens, 3);
    ngrams.forEach((g) => signals.push({ text: g, weight: 4, source: "headings" }));
  }

  // URL path (3x weight)
  try {
    const pathSegments = new URL(page.url).pathname.split(/[/-]/).filter(Boolean);
    const urlTokens = pathSegments.flatMap((s) => tokenize(s));
    const ngrams = generateNgrams(urlTokens, 2);
    ngrams.forEach((g) => signals.push({ text: g, weight: 3, source: "url" }));
  } catch {
    // Invalid URL
  }

  // Image alt text (1x weight)
  if (page.images) {
    for (const img of page.images) {
      if (img.alt) {
        const tokens = tokenize(img.alt);
        const ngrams = generateNgrams(tokens, 2);
        ngrams.forEach((g) => signals.push({ text: g, weight: 1, source: "image_alt" }));
      }
    }
  }

  // Aggregate scores
  const keywordMap = new Map<string, { score: number; frequency: number; sources: Set<string> }>();

  for (const signal of signals) {
    const existing = keywordMap.get(signal.text);
    if (existing) {
      existing.score += signal.weight;
      existing.frequency++;
      existing.sources.add(signal.source);
    } else {
      keywordMap.set(signal.text, {
        score: signal.weight,
        frequency: 1,
        sources: new Set([signal.source]),
      });
    }
  }

  // Sort by score and take top 20
  const results: KeywordResult[] = Array.from(keywordMap.entries())
    .map(([keyword, data]) => ({
      keyword,
      score: data.score,
      frequency: data.frequency,
      sources: Array.from(data.sources),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return results;
}
