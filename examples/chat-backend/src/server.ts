import { createApp } from "./app";
import { createCustomizer } from "@pliant/studio";

const { app } = createApp({
  dbPath: process.env.CHAT_DB ?? "groupy.db",
  profileDbPath: process.env.PLIANT_DB ?? "pliant-profiles.db",
  customize: createCustomizer({ mock: process.env.PLIANT_MOCK === "1" }),
});
const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Groupy backend on :${port} (PLIANT_MOCK=${process.env.PLIANT_MOCK ?? "0"})`));
