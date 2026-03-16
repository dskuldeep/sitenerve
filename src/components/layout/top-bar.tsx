"use client";

import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NotificationBell } from "./notification-bell";
import { useSidebarStore } from "@/stores/sidebar-store";
import { cn } from "@/lib/utils";

function getBreadcrumbs(pathname: string): { label: string; href: string }[] {
  const segments = pathname.split("/").filter(Boolean);
  const breadcrumbs: { label: string; href: string }[] = [];

  let path = "";
  for (const segment of segments) {
    path += `/${segment}`;
    const label = segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");
    breadcrumbs.push({ label, href: path });
  }

  return breadcrumbs;
}

function getPageTitle(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, " ");
}

export function TopBar({ onOpenCommandPalette }: { onOpenCommandPalette?: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { isCollapsed } = useSidebarStore();
  const breadcrumbs = getBreadcrumbs(pathname);
  const title = getPageTitle(pathname);
  const user = session?.user;

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex items-center justify-between h-14 px-6 border-b border-[#1E293B] bg-[#0A0F1C]/80 backdrop-blur-sm transition-all duration-200",
        isCollapsed ? "ml-16" : "ml-60"
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center text-sm">
          {breadcrumbs.length > 0 ? (
            <div className="flex items-center gap-1 text-[#64748B]">
              {breadcrumbs.map((crumb, i) => (
                <span key={crumb.href} className="flex items-center gap-1">
                  {i > 0 && <span className="text-[#334155]">/</span>}
                  <span
                    className={cn(
                      i === breadcrumbs.length - 1
                        ? "text-[#F8FAFC] font-medium"
                        : "text-[#64748B]"
                    )}
                  >
                    {crumb.label}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[#F8FAFC] font-medium">{title}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenCommandPalette}
          className="hidden md:flex items-center gap-2 text-[#64748B] hover:text-[#F8FAFC] hover:bg-[#1E293B] border border-[#1E293B] h-8 px-3"
        >
          <Search className="h-3 w-3" />
          <span className="text-xs">Search...</span>
          <kbd className="pointer-events-none text-[10px] text-[#475569] border border-[#334155] rounded px-1">
            ⌘K
          </kbd>
        </Button>

        <NotificationBell />

        <Avatar className="h-8 w-8">
          <AvatarImage src={user?.image || undefined} />
          <AvatarFallback className="bg-[#1E293B] text-[#94A3B8] text-xs">
            {user?.name?.charAt(0)?.toUpperCase() || "U"}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
