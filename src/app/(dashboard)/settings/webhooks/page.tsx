"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import Link from "next/link";
import {
  Link2,
  ExternalLink,
  Globe,
  Loader2,
  Settings,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface Project {
  id: string;
  name: string;
  siteUrl: string;
}

export default function WebhooksPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProjects() {
      try {
        const res = await fetch("/api/projects");
        if (!res.ok) throw new Error("Failed to fetch projects");
        const data = await res.json();
        setProjects(Array.isArray(data) ? data : data.data || []);
      } catch {
        toast.error("Failed to load projects");
      } finally {
        setLoading(false);
      }
    }
    fetchProjects();
  }, []);

  return (
    <div>
      <PageHeader
        title="Webhooks"
        description="Configure webhook endpoints for event notifications"
      />

      {/* Info Banner */}
      <Card className="bg-[#111827] border-[#1E293B] mb-6">
        <CardContent className="py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-blue-500/10 p-2 shrink-0 mt-0.5">
              <Link2 className="h-4 w-4 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#F8FAFC]">
                Webhook configuration is per-project
              </p>
              <p className="text-sm text-[#94A3B8] mt-1">
                Webhooks are configured individually for each project. Select a
                project below to manage its webhook endpoints and event
                subscriptions.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator className="bg-[#1E293B] mb-6" />

      {/* Projects List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-[#64748B]" />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No Projects Found"
          description="Create a project first to configure webhooks for it"
        />
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-[#94A3B8] uppercase tracking-wider">
            Your Projects
          </h2>
          <div className="grid gap-3">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="bg-[#111827] border-[#1E293B] hover:border-[#334155] transition-colors"
              >
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="rounded-lg bg-blue-500/10 p-2 shrink-0">
                        <Globe className="h-4 w-4 text-blue-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#F8FAFC] truncate">
                          {project.name}
                        </p>
                        <p className="text-xs text-[#64748B] truncate">
                          {project.siteUrl}
                        </p>
                      </div>
                    </div>
                    <Link href={`/projects/${project.id}/settings`}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-[#1E293B] bg-[#0A0F1C] text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B] shrink-0 ml-4"
                      >
                        <Settings className="h-3.5 w-3.5 mr-1.5" />
                        Configure Webhooks
                        <ExternalLink className="h-3 w-3 ml-1.5" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
