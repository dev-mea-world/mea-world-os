"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function LiveRefresh({ intervalMs = 5_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, router]);

  return null;
}
