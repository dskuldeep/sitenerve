"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Loader2 } from "lucide-react";
import { normalizeOptionalSitemapUrl, normalizeSiteUrl } from "@/lib/url-normalization";

function validateSitemapCandidate(raw: string | undefined, siteUrl: string): void {
  normalizeOptionalSitemapUrl(raw, siteUrl);
}

function normalizeSitemapCandidate(raw: string | undefined, siteUrl: string): string | undefined {
  try {
    return normalizeOptionalSitemapUrl(raw, siteUrl);
  } catch {
    return undefined;
  }
}

const projectSchema = z.object({
  name: z.string().optional(),
  siteUrl: z
    .string()
    .min(1, "URL is required")
    .transform(normalizeSiteUrl)
    .pipe(z.string().url("Must be a valid URL")),
  description: z.string().optional(),
  sitemapUrl: z.string().optional(),
})
  .superRefine((value, ctx) => {
    if (!value.sitemapUrl?.trim()) return;

    try {
      validateSitemapCandidate(value.sitemapUrl, value.siteUrl);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sitemapUrl"],
        message: "Must be a valid sitemap URL or sitemap path",
      });
    }
  })
  .transform((value) => ({
    ...value,
    sitemapUrl: normalizeSitemapCandidate(value.sitemapUrl, value.siteUrl),
  }));

type ProjectFormInput = z.input<typeof projectSchema>;
type ProjectFormData = z.output<typeof projectSchema>;

export function CreateProjectDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProjectFormInput, unknown, ProjectFormData>({
    resolver: zodResolver(projectSchema),
  });

  const createProject = useMutation({
    mutationFn: async (data: ProjectFormData) => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create project");
      return json.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project created! Initial crawl started.");
      setOpen(false);
      reset();
      router.push(`/projects/${data.id}`);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-blue-600 hover:bg-blue-700 text-white" />}>
          <Plus className="h-4 w-4 mr-2" />
          New Project
      </DialogTrigger>
      <DialogContent className="bg-[#111827] border-[#1E293B]">
        <DialogHeader>
          <DialogTitle className="text-[#F8FAFC]">Create New Project</DialogTitle>
          <DialogDescription className="text-[#94A3B8]">
            Enter the URL of the site you want to monitor. An initial crawl will start automatically.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit((data) => createProject.mutate(data))} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="siteUrl" className="text-[#94A3B8]">
              Site URL <span className="text-red-400">*</span>
            </Label>
            <Input
              id="siteUrl"
              placeholder="https://example.com"
              {...register("siteUrl")}
              className="bg-[#1E293B] border-[#334155] text-[#F8FAFC] font-mono text-sm placeholder:text-[#64748B]"
            />
            {errors.siteUrl && (
              <p className="text-xs text-red-400">{errors.siteUrl.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name" className="text-[#94A3B8]">
              Project Name <span className="text-[#64748B]">(optional)</span>
            </Label>
            <Input
              id="name"
              placeholder="Auto-derived from URL if left blank"
              {...register("name")}
              className="bg-[#1E293B] border-[#334155] text-[#F8FAFC] placeholder:text-[#64748B]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-[#94A3B8]">
              Description <span className="text-[#64748B]">(optional)</span>
            </Label>
            <Textarea
              id="description"
              placeholder="Brief description of this project"
              {...register("description")}
              className="bg-[#1E293B] border-[#334155] text-[#F8FAFC] placeholder:text-[#64748B] resize-none"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sitemapUrl" className="text-[#94A3B8]">
              Sitemap URL <span className="text-[#64748B]">(optional)</span>
            </Label>
            <Input
              id="sitemapUrl"
              placeholder="https://example.com/sitemap.xml or /sitemap.xml"
              {...register("sitemapUrl")}
              className="bg-[#1E293B] border-[#334155] text-[#F8FAFC] font-mono text-sm placeholder:text-[#64748B]"
            />
            {errors.sitemapUrl && (
              <p className="text-xs text-red-400">{errors.sitemapUrl.message}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              className="text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createProject.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {createProject.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Project
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
