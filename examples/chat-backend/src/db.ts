import Database from "better-sqlite3";

export const USERS = [
  { id: "u1", name: "Sai" },
  { id: "u2", name: "Maya" },
  { id: "u3", name: "Ravi" },
];

const GROUP_NAMES = [
  "Family 👨‍👩‍👧", "College Friends", "Weekend Trek Crew", "Office Announcements", "Book Club", "Cricket Gang",
  "Neighbourhood Watch", "Cousins", "Project Atlas", "Gym Buddies", "Foodies of Bangalore", "Parents Association",
  "Old Classmates Reunion", "Startup Founders", "Movie Night", "Diwali Planning", "Flat 402", "Hackathon Team",
  "Yoga Mornings", "Travel Goa 2026", "Dev Rel Chat", "Photography Club", "Board Games", "Kids Birthday Party",
  "Alumni Network", "Design Critique", "Run Club", "Home Renovation", "Investing 101", "Language Exchange",
  "Music Jam", "Chess Club", "Garden Swap", "Car Pool", "Wedding Planning", "Thesis Support",
  "Open Source Folks", "Pet Parents", "Coffee Roasters", "Retro Gaming",
];

const SNIPPETS = [
  "Are we still on for tomorrow?", "Sent the photos 📸", "Can someone share the doc?", "Haha that's hilarious",
  "Reminder: meeting at 5", "Who's bringing snacks?", "Just landed!", "Thanks everyone 🙏", "Let's decide by Friday",
  "I'll be 10 minutes late", "Check out this link", "Happy birthday! 🎉", "Great work team", "Anyone free this weekend?",
];

/** Names of groups where only admins can change notification settings (for the partial-failure demo). */
export const ADMIN_ONLY_MUTE = new Set(["Office Announcements", "Parents Association"]);

export function openDb(path = ":memory:") {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, member_count INTEGER NOT NULL, admin_only_mute INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS memberships (
      user_id TEXT NOT NULL, group_id TEXT NOT NULL,
      muted_until INTEGER, archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
      unread INTEGER NOT NULL DEFAULT 0, last_opened INTEGER,
      PRIMARY KEY (user_id, group_id));
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, user_id TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
  `);
  return db;
}
export type Db = ReturnType<typeof openDb>;

/** Deterministic PRNG so every run seeds identically. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

export function seed(db: Db, now = Date.now()) {
  if ((db.prepare("SELECT COUNT(*) AS n FROM groups").get() as { n: number }).n > 0) return;
  const rand = rng(42);
  const day = 86_400_000;
  db.transaction(() => {
    for (const u of USERS) db.prepare("INSERT INTO users VALUES (?,?)").run(u.id, u.name);
    GROUP_NAMES.forEach((name, i) => {
      const gid = `g${i + 1}`;
      db.prepare("INSERT INTO groups VALUES (?,?,?,?)").run(gid, name, 3 + Math.floor(rand() * 200), ADMIN_ONLY_MUTE.has(name) ? 1 : 0);
      for (const u of USERS) {
        // A spread of unread counts so ">50 unread" is meaningful; a few groups not opened for 30+ days.
        const raw = rand() < 0.2 ? 51 + Math.floor(rand() * 120) : Math.floor(rand() * 30);
        // Every 4th group is fully read, so "unread only" has something to hide. (rng consumption is unchanged.)
        const unread = raw <= 50 && i % 4 === 2 ? 0 : raw;
        const stale = rand() < 0.25;
        db.prepare("INSERT INTO memberships VALUES (?,?,?,?,?,?,?)").run(
          u.id, gid, null, 0, rand() < 0.1 ? 1 : 0, unread, now - (stale ? 35 + Math.floor(rand() * 60) : Math.floor(rand() * 10)) * day,
        );
      }
      const n = 6 + Math.floor(rand() * 8);
      for (let m = 0; m < n; m++) {
        db.prepare("INSERT INTO messages (group_id, user_id, text, at) VALUES (?,?,?,?)").run(
          gid, USERS[Math.floor(rand() * 3)].id, SNIPPETS[Math.floor(rand() * SNIPPETS.length)], now - (n - m) * 3_600_000 * (1 + Math.floor(rand() * 6)),
        );
      }
    });
  })();
}
