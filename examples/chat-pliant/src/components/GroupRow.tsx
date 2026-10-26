import type { Group } from "../api";

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/** "now", "5m", "3h", "2d", "3w" */
export function ago(ts: number | null | undefined, now = Date.now()) {
  if (!ts) return "";
  const m = Math.max(0, Math.round((now - ts) / 60000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  if (m < 10080) return `${Math.round(m / 1440)}d`;
  return `${Math.round(m / 10080)}w`;
}

export function GroupRow({ group, active, onOpen }: { group: Group; active: boolean; onOpen: () => void }) {
  return (
    <div className={"group-row" + (active ? " active" : "")} onClick={onOpen} data-testid={`group-${group.id}`}>
      <div className="avatar" style={{ ["--h" as any]: hue(group.name) }}>{group.name.replace(/[^\p{L}\p{N}]/gu, "")[0]}</div>
      <div className="group-main">
        <div className="group-top">
          <span className="group-name">{group.pinned && "📌 "}{group.name}</span>
          <span className="group-time">{group.muted && "🔕 "}{ago(group.lastActivity)}</span>
        </div>
        <div className="group-bottom">
          <div className="group-last">{group.lastMessage ?? "No messages yet"}</div>
          {group.unread > 0 && <span className="badge">{group.unread}</span>}
        </div>
      </div>
    </div>
  );
}
