"use client";

import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-[#1E293B] p-4 mb-4">
        <Icon className="h-8 w-8 text-[#475569]" />
      </div>
      <h3 className="text-lg font-medium text-[#F8FAFC] mb-1">{title}</h3>
      <p className="text-sm text-[#64748B] max-w-md">{description}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
