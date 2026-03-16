"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNotificationStore } from "@/stores/notification-store";

export function useNotifications() {
  const { setUnreadCount } = useNotificationStore();

  const query = useQuery({
    queryKey: ["notifications-count"],
    queryFn: async () => {
      const res = await fetch("/api/notifications?limit=100");
      const json = await res.json();
      if (json.success) {
        const unread = json.data.filter((n: { isRead: boolean }) => !n.isRead).length;
        return unread;
      }
      return 0;
    },
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (query.data !== undefined) {
      setUnreadCount(query.data);
    }
  }, [query.data, setUnreadCount]);

  return query;
}
