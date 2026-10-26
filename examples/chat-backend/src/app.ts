import express from "express";
import { z } from "zod";
import { BUILTIN_COMPONENTS } from "@pliant/core";
import { createPliant, userIdOf, type CustomizeHandler } from "@pliant/server";
import { openDb, seed, type Db } from "./db";

export const SLOTS = [
  "chatList.header", "chatList.stories", "chatList.items", "chatList.footer", "conversation.header", "conversation.messages", "conversation.composer",
];

interface Row {
  id: string; name: string; memberCount: number; mutedUntil: number | null; archived: number; pinned: number;
  unread: number; lastOpened: number | null; lastMessage: string | null; lastActivity: number | null; adminOnlyMute: number;
}

/** Visitor sessions (ids "v_…") are isolated: you only see seeded messages plus your own. */
const VISIBLE_MSG = `(user_id NOT LIKE 'v\\_%' ESCAPE '\\' OR user_id = m.user_id)`;
const MAX_VISITORS = 2000;

const GROUP_SQL = `
  SELECT g.id, g.name, g.member_count AS memberCount, m.muted_until AS mutedUntil, m.archived, m.pinned, m.unread,
         m.last_opened AS lastOpened, g.admin_only_mute AS adminOnlyMute,
         (SELECT text FROM messages WHERE group_id=g.id AND ${VISIBLE_MSG} ORDER BY at DESC LIMIT 1) AS lastMessage,
         (SELECT at FROM messages WHERE group_id=g.id AND ${VISIBLE_MSG} ORDER BY at DESC LIMIT 1) AS lastActivity
  FROM groups g JOIN memberships m ON m.group_id=g.id`;

const toGroup = (r: Row, now: number) => ({
  id: r.id, name: r.name, memberCount: r.memberCount, muted: !!r.mutedUntil && r.mutedUntil > now,
  archived: !!r.archived, pinned: !!r.pinned, unread: r.unread, lastMessage: r.lastMessage, lastActivity: r.lastActivity,
  lastOpened: r.lastOpened,
});

export function createApp(opts: { dbPath?: string; profileDbPath?: string; customize?: CustomizeHandler; db?: Db } = {}) {
  const db = opts.db ?? openDb(opts.dbPath);
  seed(db);

  const pliant = createPliant({
    app: "Groupy",
    dbPath: opts.profileDbPath,
    customize: opts.customize,
    slots: SLOTS,
    examples: [
      "Dark mode, bigger text, and make the list compact",
      "Hide the stories bar and put pinned groups on top",
      "Give me a tab with only groups that have more than 50 unread",
      "Let me select multiple groups and mute or archive them",
      "Add a toggle to show only unread groups",
      "Show my groups as a grid",
      "Delete all groups I haven't opened in a month",
    ],
    labels: {
      "chatList.header": "Header", "chatList.stories": "Stories bar", "chatList.items": "Group list", "chatList.footer": "Footer",
      "conversation.header": "Chat header", "conversation.messages": "Messages", "conversation.composer": "Message box",
      "brand.logo": "Logo", "legal.footer": "Legal footer", "billing.price": "Price badge",
    },
    catalog: [...BUILTIN_COMPONENTS, "GroupRow"],
    entities: [
      { id: "group", fields: { name: "string", unread: "number", pinned: "boolean", muted: "boolean", archived: "boolean", memberCount: "number", lastActivity: "number", lastOpened: "number" }, relations: [{ kind: "hasMany", entity: "message" }] },
      { id: "message", fields: { text: "string", at: "number", userId: "string" }, relations: [{ kind: "belongsTo", entity: "group" }] },
      { id: "user", fields: { name: "string" }, relations: [] },
    ],
    dials: { L0: "open", L1: "open", L2: "open", L3: "restricted", L4: "locked" },
    locks: ["brand.logo", "legal.footer", "billing.price"],
  });

  const app = express();
  app.use(express.json());
  // A visitor id is a throwaway session: clone u1's groups so each visitor gets their own fresh copy of the demo.
  app.use((req, res, next) => {
    const id = userIdOf(req);
    if (!/^v_[a-z0-9]{4,20}$/.test(id)) return next();
    if (!db.prepare("SELECT 1 FROM users WHERE id=?").get(id)) {
      if ((db.prepare("SELECT COUNT(*) AS n FROM users WHERE id LIKE 'v\\_%' ESCAPE '\\'").get() as { n: number }).n >= MAX_VISITORS)
        return void res.status(429).json({ error: "demo_full", message: "The demo is busy. Please try again later." });
      db.transaction(() => {
        db.prepare("INSERT INTO users VALUES (?,?)").run(id, "You");
        db.prepare("INSERT INTO memberships SELECT ?, group_id, NULL, 0, pinned, unread, last_opened FROM memberships WHERE user_id='u1'").run(id);
      })();
    }
    next();
  });
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type,x-user-id,x-pliant-run");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return void res.sendStatus(204);
    next();
  });

  const mine = (req: express.Request, groupId: string) =>
    db.prepare(`${GROUP_SQL} WHERE m.user_id=? AND g.id=?`).get(userIdOf(req), groupId) as Row | undefined;
  const need = (req: express.Request, groupId: string) => {
    const r = mine(req, groupId);
    if (!r) throw Object.assign(new Error("Group not found"), { status: 404 });
    return r;
  };
  const upd = (req: express.Request, groupId: string, set: string, ...args: unknown[]) =>
    db.prepare(`UPDATE memberships SET ${set} WHERE user_id=? AND group_id=?`).run(...args, userIdOf(req), groupId);
  const G = z.object({ groupId: z.string() });

  pliant.capability({
    id: "group.list", description: "List the user's groups", entity: "group", effect: "read",
    route: { method: "GET", path: "/groups" }, params: z.object({}), returns: z.array(z.any()),
    handler: (_p, req) => (db.prepare(`${GROUP_SQL} WHERE m.user_id=?`).all(userIdOf(req)) as Row[]).map((r) => toGroup(r, Date.now())),
  });
  pliant.capability({
    id: "group.get", description: "Get one group", entity: "group", effect: "read",
    route: { method: "GET", path: "/groups/:groupId" }, params: G,
    handler: (p, req) => toGroup(need(req, p.groupId), Date.now()),
  });
  pliant.capability({
    id: "group.mute", description: "Mute notifications for a group", entity: "group", effect: "write",
    route: { method: "POST", path: "/groups/:groupId/mute" }, params: G.extend({ hours: z.number().optional() }), returns: z.object({ ok: z.boolean() }),
    policy: { batchable: true, maxFanOut: null, requiresConfirm: false, rateLimit: null, schedulable: true },
    handler: (p, req) => {
      const g = need(req, p.groupId);
      if (g.adminOnlyMute) throw Object.assign(new Error(`Only admins can mute "${g.name}"`), { status: 403 });
      upd(req, p.groupId, "muted_until=?", Date.now() + (p.hours ?? 8) * 3_600_000);
      return { ok: true };
    },
  });
  pliant.capability({
    id: "group.unmute", description: "Unmute a group", entity: "group", effect: "write",
    route: { method: "POST", path: "/groups/:groupId/unmute" }, params: G,
    handler: (p, req) => { need(req, p.groupId); upd(req, p.groupId, "muted_until=NULL"); return { ok: true }; },
  });
  pliant.capability({
    id: "group.archive", description: "Archive or unarchive a group", entity: "group", effect: "write",
    route: { method: "POST", path: "/groups/:groupId/archive" }, params: G.extend({ archived: z.boolean().optional() }),
    handler: (p, req) => { need(req, p.groupId); upd(req, p.groupId, "archived=?", p.archived === false ? 0 : 1); return { ok: true }; },
  });
  pliant.capability({
    id: "group.pin", description: "Pin or unpin a group", entity: "group", effect: "write",
    route: { method: "POST", path: "/groups/:groupId/pin" }, params: G.extend({ pinned: z.boolean().optional() }),
    handler: (p, req) => { need(req, p.groupId); upd(req, p.groupId, "pinned=?", p.pinned === false ? 0 : 1); return { ok: true }; },
  });
  pliant.capability({
    id: "group.markRead", description: "Mark all messages in a group as read", entity: "group", effect: "write",
    route: { method: "POST", path: "/groups/:groupId/read" }, params: G,
    handler: (p, req) => { need(req, p.groupId); upd(req, p.groupId, "unread=0, last_opened=?", Date.now()); return { ok: true }; },
  });
  pliant.capability({
    id: "group.leave", description: "Leave a group", entity: "group", effect: "destructive",
    route: { method: "POST", path: "/groups/:groupId/leave" }, params: G,
    policy: { batchable: false, requiresConfirm: true, schedulable: false },
    handler: (p, req) => {
      need(req, p.groupId);
      db.prepare("DELETE FROM memberships WHERE user_id=? AND group_id=?").run(userIdOf(req), p.groupId);
      return { ok: true };
    },
  });
  pliant.capability({
    id: "group.delete", description: "Delete a group for everyone", entity: "group", effect: "destructive",
    route: { method: "DELETE", path: "/groups/:groupId" }, params: G,
    policy: { batchable: false, requiresConfirm: true, schedulable: false },
    handler: (p, req) => {
      need(req, p.groupId);
      db.transaction(() => {
        db.prepare("DELETE FROM memberships WHERE group_id=?").run(p.groupId);
        db.prepare("DELETE FROM messages WHERE group_id=?").run(p.groupId);
        db.prepare("DELETE FROM groups WHERE id=?").run(p.groupId);
      })();
      return { ok: true };
    },
  });
  pliant.capability({
    id: "message.list", description: "List messages in a group", entity: "message", effect: "read",
    route: { method: "GET", path: "/groups/:groupId/messages" }, params: G,
    handler: (p, req) => {
      need(req, p.groupId);
      const me = userIdOf(req);
      const rows = db.prepare(`SELECT id, group_id AS groupId, user_id AS userId, text, at FROM messages m WHERE group_id=? AND (user_id NOT LIKE 'v\\_%' ESCAPE '\\' OR user_id=?) ORDER BY at`).all(p.groupId, me) as { userId: string }[];
      // A visitor is a clone of u1, so u1's seeded messages show as theirs.
      return me.startsWith("v_") ? rows.map((r) => (r.userId === "u1" ? { ...r, userId: me } : r)) : rows;
    },
  });
  pliant.capability({
    id: "message.send", description: "Send a message to a group (notifies its members)", entity: "message", effect: "external",
    route: { method: "POST", path: "/groups/:groupId/messages" }, params: G.extend({ text: z.string().min(1) }),
    policy: { batchable: true, maxFanOut: 5, requiresConfirm: true, rateLimit: { count: 30, perSeconds: 60 }, schedulable: false },
    handler: (p, req) => {
      need(req, p.groupId);
      const info = db.prepare("INSERT INTO messages (group_id, user_id, text, at) VALUES (?,?,?,?)").run(p.groupId, userIdOf(req), p.text, Date.now());
      return { id: info.lastInsertRowid, ok: true };
    },
  });

  app.use(pliant.router);
  app.get("/me", (req, res) => {
    const u = db.prepare("SELECT id, name FROM users WHERE id=?").get(userIdOf(req));
    u ? res.json(u) : res.status(404).json({ error: "no such user" });
  });
  app.get("/users", (_req, res) => res.json(db.prepare("SELECT id, name FROM users").all()));

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: "app_error", message: err.message });
  });

  return { app, db, pliant };
}
