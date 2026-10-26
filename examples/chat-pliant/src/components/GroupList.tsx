import { Item } from "@pliant/react";
import type { Group } from "../api";
import { GroupRow } from "./GroupRow";

export function GroupList({ groups, activeId, onOpen }: { groups: Group[]; activeId: string | null; onOpen: (id: string) => void }) {
  return (
    <div className="group-list" data-testid="group-list" data-layout-target>
      {groups.map((g) => (
        <Item key={g.id} id={g.id}>
          <GroupRow group={g} active={g.id === activeId} onOpen={() => onOpen(g.id)} />
        </Item>
      ))}
      {groups.length === 0 && <div className="empty">No groups</div>}
    </div>
  );
}
