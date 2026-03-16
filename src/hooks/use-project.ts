"use client";

import { useQuery } from "@tanstack/react-query";

interface Project {
  id: string;
  name: string;
  siteUrl: string;
  status: string;
  healthScore: number;
  totalPages: number;
  totalIssues: number;
}

export function useProject(projectId: string) {
  return useQuery<Project>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    enabled: !!projectId,
    refetchInterval: (query) => {
      const data = query.state.data as Project | undefined;
      return data?.status === "CRAWLING" || data?.status === "INITIALIZING"
        ? 2000
        : false;
    },
  });
}
