"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export type PresenceUpdate = {
  signedIn: boolean;
  state?: "active" | "idle" | "break" | "offline";
  breakType?: string | null;
  notifications?: number;
  messages?: number;
  requests?: number | null;
};

const HEARTBEAT_MS = 30_000;
const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

/**
 * Invisible. Records the last keyboard/mouse activity and reports it every 30 s.
 * The server decides active vs idle; nothing about it is shown to agents.
 */
export function ActivityTracker({ onUpdate }: { onUpdate: (update: PresenceUpdate) => void }) {
  const router = useRouter();

  useEffect(() => {
    let lastActivity = Date.now();
    let ended = false;
    const mark = () => {
      lastActivity = Date.now();
    };

    async function beat() {
      if (ended) return;
      try {
        const res = await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lastActivityAt: lastActivity }),
          keepalive: true,
        });
        if (res.status === 401) {
          ended = true;
          router.replace("/login?expired=1");
          return;
        }
        if (res.ok) onUpdate((await res.json()) as PresenceUpdate);
      } catch {
        // offline for a moment; the next beat retries
      }
    }

    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, mark, { passive: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        mark();
        void beat();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    void beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);

    return () => {
      ended = true;
      window.clearInterval(timer);
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, mark);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, onUpdate]);

  return null;
}
