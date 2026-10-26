import type { Group } from "../api";

export function GroupRow({ group, active, onOpen }: { group: Group; active: boolean; onOpen: () => void }) {
  return (
    <div className={"group-row" + (active ? " active" : "")} onClick={onOpen} data-testid={`group-${group.id}`}>
      <div className="avatar">{group.name.replace(/[^\p{L}\p{N}]/gu, "")[0]}</div>
      <div className="group-main">
        <div className="group-top">
          <span className="group-name">{group.pinned && "📌 "}{group.name}</span>
          {group.muted && <span title="Muted">🔕</span>}
        </div>
        <div className="group-last">{group.lastMessage ?? "No messages yet"}</div>
      </div>
      {group.unread > 0 && <span className="badge">{group.unread}</span>}
    </div>
  );
}
