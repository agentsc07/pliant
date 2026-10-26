import { useCallback, useEffect, useState } from "react";
import { api, type Group } from "./api";
import { Conversation } from "./components/Conversation";
import { Footer } from "./components/Footer";
import { GroupList } from "./components/GroupList";
import { Header } from "./components/Header";
import { StoriesBar } from "./components/StoriesBar";

export function App() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = useCallback(() => api.groups().then(setGroups), []);
  useEffect(() => { refresh(); }, [refresh]);

  const visible = groups.filter((g) => !g.archived);
  const active = groups.find((g) => g.id === activeId);

  return (
    <div className="app">
      <aside className="sidebar">
        <Header />
        <StoriesBar />
        <GroupList groups={visible} activeId={activeId} onOpen={setActiveId} />
        <Footer />
      </aside>
      <main className="main">
        {active ? <Conversation group={active} onChanged={refresh} /> : <div className="placeholder">Select a group to start chatting</div>}
      </main>
    </div>
  );
}
