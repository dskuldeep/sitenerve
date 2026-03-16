"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { FolderKanban, Settings, Plus, Search, Globe, Bot } from "lucide-react";

interface Project {
  id: string;
  name: string;
  siteUrl: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects-list"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      const json = await res.json();
      return json.success ? json.data : [];
    },
    enabled: open,
  });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const navigate = useCallback(
    (path: string) => {
      setOpen(false);
      router.push(path);
    },
    [router]
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search projects, pages, issues..."
        className="text-[#F8FAFC]"
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Quick Actions">
          <CommandItem onSelect={() => navigate("/projects")} className="text-[#94A3B8]">
            <Plus className="mr-2 h-4 w-4" />
            Create New Project
          </CommandItem>
          <CommandItem onSelect={() => navigate("/settings")} className="text-[#94A3B8]">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </CommandItem>
          <CommandItem onSelect={() => navigate("/settings/ai")} className="text-[#94A3B8]">
            <Bot className="mr-2 h-4 w-4" />
            AI Configuration
          </CommandItem>
        </CommandGroup>

        {projects.length > 0 && (
          <CommandGroup heading="Projects">
            {projects.map((project) => (
              <CommandItem
                key={project.id}
                onSelect={() => navigate(`/projects/${project.id}`)}
                className="text-[#94A3B8]"
              >
                <FolderKanban className="mr-2 h-4 w-4" />
                <div className="flex flex-col">
                  <span className="text-[#F8FAFC]">{project.name}</span>
                  <span className="text-xs font-mono text-[#64748B]">{project.siteUrl}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
