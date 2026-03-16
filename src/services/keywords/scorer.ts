interface PageKeywords {
  pageUrl: string;
  keywords: Array<{ keyword: string; score: number }>;
}

export function applyTfIdf(
  pagesKeywords: PageKeywords[]
): PageKeywords[] {
  const totalDocs = pagesKeywords.length;
  if (totalDocs === 0) return [];

  // Calculate document frequency for each keyword
  const df = new Map<string, number>();
  for (const page of pagesKeywords) {
    const seen = new Set<string>();
    for (const kw of page.keywords) {
      if (!seen.has(kw.keyword)) {
        seen.add(kw.keyword);
        df.set(kw.keyword, (df.get(kw.keyword) || 0) + 1);
      }
    }
  }

  // Apply IDF weighting
  return pagesKeywords.map((page) => ({
    pageUrl: page.pageUrl,
    keywords: page.keywords
      .map((kw) => {
        const docFreq = df.get(kw.keyword) || 1;
        const idf = Math.log(totalDocs / docFreq);
        return {
          keyword: kw.keyword,
          score: Math.round(kw.score * idf * 100) / 100,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 20),
  }));
}
