import express from "express";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { createCustomizer } from "@pliant/studio";

// PLIANT_DEMO=1: in-memory SQLite, so every boot reseeds and nothing persists (the public demo).
const demo = process.env.PLIANT_DEMO === "1";
const { app } = createApp({
  dbPath: demo ? ":memory:" : process.env.CHAT_DB ?? "groupy.db",
  profileDbPath: demo ? ":memory:" : process.env.PLIANT_DB ?? "pliant-profiles.db",
  customize: createCustomizer({ mock: process.env.PLIANT_MOCK === "1" }),
});

// One service: if the frontends are built, serve them next to the API (Pliant app at /, classic at /classic, side-by-side at /compare).
const here = dirname(fileURLToPath(import.meta.url));
const pliantWeb = process.env.WEB_DIR ?? resolve(here, "../../chat-pliant/dist");
const classicWeb = process.env.CLASSIC_WEB_DIR ?? resolve(here, "../../chat-classic/dist");
if (existsSync(pliantWeb)) {
  app.get("/compare", (_req, res) => res.sendFile(resolve(pliantWeb, "compare.html")));
  if (existsSync(classicWeb)) app.use("/classic", express.static(classicWeb));
  app.use(express.static(pliantWeb));
}

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Groupy on :${port} (mock=${process.env.PLIANT_MOCK ?? "0"}, demo=${demo}, web=${existsSync(pliantWeb)})`));
