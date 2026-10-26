import Database from "better-sqlite3";
import { Patch } from "@pliant/core";

/** Per-user profile storage: an ordered list of patches. */
export class ProfileStore {
  private db: Database.Database;
  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS pliant_patches (
      user_id TEXT NOT NULL, patch_id TEXT NOT NULL, position INTEGER NOT NULL, json TEXT NOT NULL,
      PRIMARY KEY (user_id, patch_id))`);
  }

  list(userId: string): Patch[] {
    const rows = this.db.prepare("SELECT json FROM pliant_patches WHERE user_id=? ORDER BY position").all(userId) as { json: string }[];
    return rows.map((r) => Patch.parse(JSON.parse(r.json)));
  }

  upsert(userId: string, patch: Patch) {
    const existing = this.db.prepare("SELECT position FROM pliant_patches WHERE user_id=? AND patch_id=?").get(userId, patch.id) as { position: number } | undefined;
    const pos = existing?.position ?? ((this.db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS p FROM pliant_patches WHERE user_id=?").get(userId) as { p: number }).p);
    this.db.prepare("INSERT OR REPLACE INTO pliant_patches (user_id, patch_id, position, json) VALUES (?,?,?,?)").run(userId, patch.id, pos, JSON.stringify(patch));
  }

  remove(userId: string, patchId: string): boolean {
    return this.db.prepare("DELETE FROM pliant_patches WHERE user_id=? AND patch_id=?").run(userId, patchId).changes > 0;
  }

  reset(userId: string) { this.db.prepare("DELETE FROM pliant_patches WHERE user_id=?").run(userId); }

  reorder(userId: string, ids: string[]) {
    const stmt = this.db.prepare("UPDATE pliant_patches SET position=? WHERE user_id=? AND patch_id=?");
    this.db.transaction(() => ids.forEach((id, i) => stmt.run(i, userId, id)))();
  }
}
