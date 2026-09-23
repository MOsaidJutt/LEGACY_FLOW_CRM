import { Coffee, Moon, Power, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LiveState } from "@/lib/metrics";

const MAP = {
  active: { label: "Active", tone: "success", icon: Zap },
  idle: { label: "Idle", tone: "warning", icon: Moon },
  break: { label: "On break", tone: "info", icon: Coffee },
  offline: { label: "Offline", tone: "neutral", icon: Power },
} as const;

export function PresenceBadge({ state, detail }: { state: LiveState; detail?: string }) {
  const m = MAP[state];
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {m.label}
      {detail ? <span className="font-normal opacity-80"> · {detail}</span> : null}
    </Badge>
  );
}
