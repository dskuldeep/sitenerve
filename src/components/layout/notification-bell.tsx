"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotificationStore } from "@/stores/notification-store";
import { cn } from "@/lib/utils";
import { NotificationPanel } from "@/components/notifications/notification-panel";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export function NotificationBell() {
  const { unreadCount } = useNotificationStore();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B]"
        />}>
          <Bell className={cn("h-4 w-4", unreadCount > 0 && "animate-shake")} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-medium text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[400px] bg-[#111827] border-[#1E293B] p-0"
      >
        <NotificationPanel onClose={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
