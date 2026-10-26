import type { Group } from "../api";
import { GroupRow } from "./GroupRow";

export function GroupList({ groups, activeId, onOpen }: { groups: Group[]; activeId: string | null; onOpen: (id: string) => void }) {
  return (
    <div className="group-list" data-testid="group-list">
      {groups.map((g) => (
        <GroupRow key={g.id} group={g} active={g.id === activeId} onOpen={() => onOpen(g.id)} />
      ))}
      {groups.length === 0 && <div className="empty">No groups</div>}
    </div>
  );
}
