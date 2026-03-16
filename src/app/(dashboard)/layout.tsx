"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { CommandPalette } from "@/components/shared/command-palette";
import { useSidebarStore } from "@/stores/sidebar-store";
import { cn } from "@/lib/utils";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isCollapsed } = useSidebarStore();

  return (
    <div className="min-h-screen bg-[#0A0F1C]">
      <Sidebar />
      <TopBar />
      <main
        className={cn(
          "pt-14 min-h-screen transition-all duration-200",
          isCollapsed ? "ml-16" : "ml-60"
        )}
      >
        <div className="p-6 max-w-[1400px] mx-auto animate-fade-in">
          {children}
        </div>
      </main>
      <CommandPalette />
    </div>
  );
}
