import { useCallback, useEffect, useMemo, useState } from "react";
import { PliantProvider, Screen, Slot } from "@pliant/react";
import { api, userId, type Group } from "./api";
import { Conversation } from "./components/Conversation";
import { Footer } from "./components/Footer";
import { GroupList } from "./components/GroupList";
import { Header } from "./components/Header";
import { StoriesBar } from "./components/StoriesBar";

const API = (import.meta as any).env?.VITE_API ?? "http://localhost:4000";

export function App() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = useCallback(() => api.groups().then(setGroups), []);
  useEffect(() => { refresh(); }, [refresh]);

  const visible = useMemo(() => groups.filter((g) => !g.archived), [groups]);
  const active = groups.find((g) => g.id === activeId);

  return (
    <PliantProvider manifestUrl="/__pliant/manifest" baseUrl={API} userId={userId} onChange={refresh}>
      <Screen id="chatList">
        <div className="app">
          <aside className="sidebar">
            <Slot id="chatList.header"><Header /></Slot>
            <Slot id="chatList.stories"><StoriesBar /></Slot>
            <Slot id="chatList.items" entity="group" data={visible}>
              <GroupList groups={visible} activeId={activeId} onOpen={setActiveId} />
            </Slot>
            <Slot id="legal.footer" locked><Footer /></Slot>
          </aside>
          <main className="main">
            {active ? <Conversation group={active} onChanged={refresh} /> : <div className="placeholder">Select a group to start chatting</div>}
          </main>
        </div>
      </Screen>
    </PliantProvider>
  );
}
