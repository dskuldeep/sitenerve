interface PageSnapshot {
  url: string;
  title: string | null;
  metaDescription: string | null;
  statusCode: number | null;
  h1: string[];
}

export interface CrawlDiff {
  newPages: string[];
  removedPages: string[];
  changedPages: Array<{
    url: string;
    changes: Array<{
      field: string;
      oldValue: unknown;
      newValue: unknown;
    }>;
  }>;
}

export function computeCrawlDiff(
  previousPages: PageSnapshot[],
  currentPages: PageSnapshot[]
): CrawlDiff {
  const prevMap = new Map(previousPages.map((p) => [p.url, p]));
  const currMap = new Map(currentPages.map((p) => [p.url, p]));

  const newPages: string[] = [];
  const removedPages: string[] = [];
  const changedPages: CrawlDiff["changedPages"] = [];

  // Find new pages
  for (const url of currMap.keys()) {
    if (!prevMap.has(url)) {
      newPages.push(url);
    }
  }

  // Find removed pages
  for (const url of prevMap.keys()) {
    if (!currMap.has(url)) {
      removedPages.push(url);
    }
  }

  // Find changed pages
  for (const [url, currPage] of currMap.entries()) {
    const prevPage = prevMap.get(url);
    if (!prevPage) continue;

    const changes: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];

    if (prevPage.title !== currPage.title) {
      changes.push({ field: "title", oldValue: prevPage.title, newValue: currPage.title });
    }

    if (prevPage.metaDescription !== currPage.metaDescription) {
      changes.push({
        field: "metaDescription",
        oldValue: prevPage.metaDescription,
        newValue: currPage.metaDescription,
      });
    }

    if (prevPage.statusCode !== currPage.statusCode) {
      changes.push({
        field: "statusCode",
        oldValue: prevPage.statusCode,
        newValue: currPage.statusCode,
      });
    }

    const prevH1 = (prevPage.h1 || []).join(", ");
    const currH1 = (currPage.h1 || []).join(", ");
    if (prevH1 !== currH1) {
      changes.push({ field: "h1", oldValue: prevPage.h1, newValue: currPage.h1 });
    }

    if (changes.length > 0) {
      changedPages.push({ url, changes });
    }
  }

  return { newPages, removedPages, changedPages };
}
