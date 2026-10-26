import { useEffect, useRef, useState } from "react";
import { api, userId, type Group, type Message } from "../api";

const HOUR = 3_600_000;
const clock = (t: number) => new Date(t).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

export function Conversation({ group, onChanged, onBack }: { group: Group; onChanged: () => void; onBack?: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setError(null);
    api.messages(group.id).then(setMessages).catch((e) => setError(e.message));
    if (group.unread > 0) api.markRead(group.id).then(onChanged);
  }, [group.id]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages]);

  const act = (fn: () => Promise<unknown>) => fn().then(onChanged).catch((e) => setError(e.message));

  async function send() {
    if (!text.trim()) return;
    await api.send(group.id, text).then(() => setText("")).catch((e) => setError(e.message));
    setMessages(await api.messages(group.id));
    onChanged();
  }

  return (
    <section className="conversation" data-testid="conversation">
      <div className="conv-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.3em" }}>
          {onBack && <button className="back" onClick={onBack} aria-label="Back to groups">‹ Groups</button>}
          <div>
            <div className="conv-title">{group.name}</div>
            <div className="conv-sub">{group.memberCount} members</div>
          </div>
        </div>
        <div className="conv-actions">
          <button onClick={() => act(() => (group.muted ? api.unmute(group.id) : api.mute(group.id)))}>{group.muted ? "Unmute" : "Mute"}</button>
          <button onClick={() => act(() => api.pin(group.id, !group.pinned))}>{group.pinned ? "Unpin" : "Pin"}</button>
          <button onClick={() => act(() => api.archive(group.id, !group.archived))}>{group.archived ? "Unarchive" : "Archive"}</button>
          <button className="danger" onClick={() => confirm(`Leave ${group.name}?`) && act(() => api.leave(group.id))}>Leave</button>
        </div>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="messages">
        {messages.map((m, i) => {
          const prev = messages[i - 1], next = messages[i + 1];
          const mine = m.userId === userId;
          const newBlock = !prev || prev.userId !== m.userId || m.at - prev.at > HOUR;
          const lastInBlock = !next || next.userId !== m.userId || next.at - m.at > HOUR;
          return (
            <div key={m.id} style={{ display: "contents" }}>
              {(!prev || m.at - prev.at > 6 * HOUR) && <div className="msg-time">{clock(m.at)}</div>}
              <div className={"msg" + (mine ? " mine" : "") + (newBlock ? " gap" : "") + (lastInBlock ? (mine ? " tail-out" : " tail-in") : "")}>{m.text}</div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" aria-label="Message" />
        <button type="submit" disabled={!text.trim()} aria-label="Send">↑</button>
      </form>
    </section>
  );
}
