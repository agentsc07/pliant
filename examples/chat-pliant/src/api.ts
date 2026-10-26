export interface Group {
  id: string; name: string; memberCount: number; muted: boolean; archived: boolean; pinned: boolean;
  unread: number; lastMessage: string | null; lastActivity: number | null; lastOpened: number | null;
}
export interface Message { id: number; groupId: string; userId: string; text: string; at: number }

const BASE = (import.meta as any).env?.VITE_API ?? "http://localhost:4000";
function visitorId(): string {
  const q = new URLSearchParams(location.search).get("user");
  if (q) return q; // ?user=u2 etc. for the fixed demo users
  const fresh = () => "v_" + Math.random().toString(36).slice(2, 12).padEnd(8, "0");
  try {
    let v = localStorage.getItem("groupy.visitor");
    if (!v) { v = fresh(); localStorage.setItem("groupy.visitor", v); }
    return v;
  } catch { return fresh(); }
}
export const userId = visitorId();

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message ?? data.error ?? `HTTP ${r.status}`);
  return data as T;
}

export const api = {
  groups: () => req<Group[]>("GET", "/groups"),
  messages: (id: string) => req<Message[]>("GET", `/groups/${id}/messages`),
  send: (id: string, text: string) => req("POST", `/groups/${id}/messages`, { text }),
  mute: (id: string, hours = 8) => req("POST", `/groups/${id}/mute`, { hours }),
  unmute: (id: string) => req("POST", `/groups/${id}/unmute`),
  archive: (id: string, archived = true) => req("POST", `/groups/${id}/archive`, { archived }),
  pin: (id: string, pinned = true) => req("POST", `/groups/${id}/pin`, { pinned }),
  markRead: (id: string) => req("POST", `/groups/${id}/read`),
  leave: (id: string) => req("POST", `/groups/${id}/leave`),
};
