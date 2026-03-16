"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function CardSkeleton() {
  return (
    <div className="rounded-lg border border-[#1E293B] bg-[#111827] p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-32 bg-[#1E293B]" />
        <Skeleton className="h-5 w-16 bg-[#1E293B]" />
      </div>
      <Skeleton className="h-4 w-48 bg-[#1E293B]" />
      <div className="flex items-center gap-4">
        <Skeleton className="h-4 w-20 bg-[#1E293B]" />
        <Skeleton className="h-4 w-20 bg-[#1E293B]" />
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      <Skeleton className="h-10 w-full bg-[#1E293B]" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full bg-[#111827]" />
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48 bg-[#1E293B]" />
        <Skeleton className="h-9 w-32 bg-[#1E293B]" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}
