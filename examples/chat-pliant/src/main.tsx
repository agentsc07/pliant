import React from "react";
import { createRoot } from "react-dom/client";
import { registerComponent } from "@pliant/react";
import { App } from "./App";
import { GroupRow } from "./components/GroupRow";
import "./styles.css";

// Put the app's own component in the catalog so generated views stay on-brand.
registerComponent("GroupRow", ({ item }) => <GroupRow group={item} active={false} onOpen={() => {}} />, undefined, { itemProp: "item" });

createRoot(document.getElementById("root")!).render(<App />);
