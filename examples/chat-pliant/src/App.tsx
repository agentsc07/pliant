import { useCallback, useEffect, useMemo, useState } from "react";
import { PliantProvider, Screen, Slot } from "@pliant/react";
import { api, userId, type Group } from "./api";
import { Conversation } from "./components/Conversation";
import { Footer } from "./components/Footer";
import { GroupList } from "./components/GroupList";
import { Header } from "./components/Header";
import { StoriesBar } from "./components/StoriesBar";

const API = (import.meta as any).env?.VITE_API ?? "http://localhost:4000";

function DemoBanner() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("groupy.banner") !== "off"; } catch { return true; } });
  if (!(import.meta as any).env?.VITE_DEMO || !open) return null;
  return (
    <div className="demo-banner" data-testid="demo-banner">
      <span>Demo: resets on restart; first load can take ~50 s. <a href="/compare">Compare</a> · <a href="/dev">Developer console</a></span>
      <button aria-label="Dismiss" onClick={() => { setOpen(false); try { localStorage.setItem("groupy.banner", "off"); } catch {} }}>✕</button>
    </div>
  );
}

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
        <div className={"app" + (active ? " has-active" : "")}>
          <aside className="sidebar">
            <Slot id="chatList.header"><Header /></Slot>
            <Slot id="chatList.stories"><StoriesBar /></Slot>
            <Slot id="chatList.items" entity="group" data={visible}>
              <GroupList groups={visible} activeId={activeId} onOpen={setActiveId} />
            </Slot>
            <Slot id="legal.footer" locked><Footer /></Slot>
          </aside>
          <main className="main">
            {active ? <Conversation group={active} onChanged={refresh} onBack={() => setActiveId(null)} /> : <div className="placeholder"><b>No chat selected</b>Choose a group from the list.</div>}
          </main>
        </div>
        <DemoBanner />
      </Screen>
    </PliantProvider>
  );
}
