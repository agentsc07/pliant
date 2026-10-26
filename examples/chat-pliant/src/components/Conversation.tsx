import { useEffect, useState } from "react";
import { api, userId, type Group, type Message } from "../api";

export function Conversation({ group, onChanged }: { group: Group; onChanged: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api.messages(group.id).then(setMessages).catch((e) => setError(e.message));
    if (group.unread > 0) api.markRead(group.id).then(onChanged);
  }, [group.id]);

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
        <div>
          <div className="conv-title">{group.name}</div>
          <div className="conv-sub">{group.memberCount} members</div>
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
        {messages.map((m) => (
          <div key={m.id} className={"msg" + (m.userId === userId ? " mine" : "")}>{m.text}</div>
        ))}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" />
        <button type="submit">Send</button>
      </form>
    </section>
  );
}
