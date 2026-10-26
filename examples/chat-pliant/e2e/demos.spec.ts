import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:4000";

test.beforeEach(async ({ request, page }) => {
  await request.delete(`${API}/__pliant/profile/u1`);
  await page.goto("/");
  await expect(page.getByTestId("group-list")).toBeVisible();
});

async function ask(page: Page, text: string) {
  await page.getByTestId("customize-open").click();
  await page.getByTestId("customize-input").fill(text);
  await page.getByTestId("customize-submit").click();
  await expect(page.getByTestId("verdict")).toBeVisible();
}
async function accept(page: Page) {
  await page.getByTestId("patch-accept").click();
  await expect(page.getByTestId("patch-list")).toBeVisible();
  await page.getByTestId("customize-close").click();
}
const row = (page: Page, name: string) => page.locator(".pliant-item", { hasText: name });

test("1 · dark mode, bigger text, compact list (L0)", async ({ page }) => {
  await ask(page, "Dark mode, bigger text, compact list");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "allow");
  // previewed immediately, before accepting
  await expect(page.locator(".pliant-root")).toHaveAttribute("data-theme", "dark");
  await accept(page);
  await expect(page.locator(".pliant-root")).toHaveAttribute("data-theme", "dark");
  const size = await page.locator(".pliant-root").evaluate((el) => getComputedStyle(el).fontSize);
  expect(size).toBe("20px");
  await page.reload();
  await expect(page.locator(".pliant-root")).toHaveAttribute("data-theme", "dark"); // persisted
});

test("2 · hide stories, pinned on top (L1)", async ({ page }) => {
  await expect(page.getByTestId("stories")).toBeVisible();
  await ask(page, "Hide the stories bar, put pinned groups on top");
  await accept(page);
  await expect(page.getByTestId("stories")).toHaveCount(0);
  await expect(page.locator(".group-row").first()).toContainText("📌");
});

test("3 · tab of groups with >50 unread (L2)", async ({ page }) => {
  await ask(page, "Give me a tab with groups that have more than 50 unread");
  await accept(page);
  await page.getByTestId("tab-my-views").click();
  const rows = page.getByTestId("view-items").locator("tbody tr");
  expect(await rows.count()).toBeGreaterThan(0);
  for (const cell of await rows.locator("td:nth-child(2)").allTextContents()) expect(Number(cell)).toBeGreaterThan(50);
});

test("4 · multi-select + bulk mute with partial failure and retry (L3)", async ({ page }) => {
  await ask(page, "Let me select multiple groups and mute or archive them");
  await accept(page);
  await expect(page.getByTestId("selection-bar")).toHaveCount(0);
  for (const n of ["Family", "College Friends", "Office Announcements", "Parents Association"])
    await row(page, n).getByRole("checkbox").check();
  await expect(page.getByTestId("selection-count")).toHaveText("4 selected");
  await page.getByTestId("action-wf_bulk_mute").click();
  await expect(page.getByTestId("report-text")).toHaveText("Mute selected: 2/4 done · 2 failed");
  await expect(page.getByTestId("report-failures")).toContainText("Only admins can mute");
  await expect(page.getByTestId("report-retry")).toBeVisible();
  await expect(page.getByTestId("selection-bar")).toHaveCount(0);
  await expect(page.locator(".group-row", { hasText: "College Friends" })).toContainText("🔕");
});

test("5 · message all groups is denied; suggestion works and is capped at 5", async ({ page }) => {
  await ask(page, "Send 'Happy Diwali' to all my groups");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "deny");
  await expect(page.getByTestId("verdict-reason")).toContainText("5");
  await page.getByTestId("suggestion").click();
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "allow");
  await accept(page);

  // 6 selected → the 5-group cap stops the run before any message is sent
  const names = ["Family", "College Friends", "Weekend Trek", "Book Club", "Cricket Gang", "Cousins"];
  for (const n of names) await row(page, n).getByRole("checkbox").check();
  await page.getByTestId("action-wf_send_selected").click();
  await page.getByTestId("dialog-input").fill("Happy Diwali");
  await page.getByTestId("dialog-ok").click();
  await expect(page.getByTestId("dialog-message")).toContainText("6 group(s)");
  await page.getByTestId("dialog-ok").click();
  await expect(page.getByTestId("report-text")).toContainText("at most 5");
  await page.getByTestId("report-dismiss").click();

  // 3 selected → goes through
  for (const n of names) await row(page, n).getByRole("checkbox").uncheck().catch(() => {});
  for (const n of names.slice(0, 3)) await row(page, n).getByRole("checkbox").check();
  await page.getByTestId("action-wf_send_selected").click();
  await page.getByTestId("dialog-input").fill("Happy Diwali");
  await page.getByTestId("dialog-ok").click();
  await page.getByTestId("dialog-ok").click();
  await expect(page.getByTestId("report-text")).toHaveText("Send message: 3/3 done");
});

test("6 · bulk delete is denied (not batchable)", async ({ page }) => {
  await ask(page, "Delete all groups I haven't opened in a month");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "deny");
  await expect(page.getByTestId("verdict-reason")).toContainText("batch");
  await expect(page.getByTestId("patch-accept")).toHaveCount(0);
});

test("7 · removing the logo is denied (locked)", async ({ page }) => {
  await ask(page, "Remove the logo");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "deny");
  await expect(page.getByTestId("verdict-reason")).toContainText("locked");
  await expect(page.getByTestId("brand-logo")).toBeVisible();
});

test("8 · video calling is denied as L4", async ({ page }) => {
  await ask(page, "Add video calling");
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "deny");
  await expect(page.getByTestId("verdict")).toContainText("L4");
  await expect(page.getByTestId("verdict-reason")).toContainText("developer");
});

test("9 · tampered client: server rejects message.send after 5 in one run", async ({ page }) => {
  const statuses = await page.evaluate(async (api) => {
    const h = { "content-type": "application/json", "x-user-id": "u2" };
    const { runId } = await (await fetch(`${api}/__pliant/run`, { method: "POST", headers: h, body: JSON.stringify({ workflowId: "evil", fanOut: 20 }) })).json();
    const out: number[] = [];
    for (let i = 1; i <= 20; i++)
      out.push((await fetch(`${api}/groups/g${i}/messages`, { method: "POST", headers: { ...h, "x-pliant-run": runId }, body: JSON.stringify({ text: "Happy Diwali" }) })).status);
    return out;
  }, API);
  expect(statuses.filter((s) => s === 200)).toHaveLength(5);
  expect(statuses.slice(5).every((s) => s === 403)).toBe(true);
});

test("profile management: toggle, diff, delete, reset", async ({ page }) => {
  await ask(page, "Hide the stories bar, put pinned groups on top");
  await accept(page);
  await page.getByTestId("customize-open").click();
  await page.getByRole("checkbox", { name: /Enable/ }).click();
  await expect(page.getByTestId("stories")).toBeVisible();
  await page.getByRole("checkbox", { name: /Enable/ }).click();
  await expect(page.getByTestId("stories")).toHaveCount(0);
  await page.getByTestId("show-diff").click();
  await expect(page.getByTestId("diff")).toContainText("Hide chatList.stories");
  await page.getByTestId("reset").click();
  await expect(page.getByTestId("no-patches")).toBeVisible();
  await expect(page.getByTestId("stories")).toBeVisible();
});

test("11 · new controls: a toggle, a grid layout, then undo", async ({ page }) => {
  await ask(page, "Add a toggle to show only unread groups");
  await expect(page.getByTestId("preview-changes")).toContainText("“Unread only” switch".replace(/[“”]/g, '"'));
  await accept(page);
  const before = await page.locator(".group-row").count();
  await page.getByTestId("toggle-Unread only").click();
  await expect(page.locator(".group-row")).not.toHaveCount(before);
  await page.getByTestId("customize-open").click();
  await page.getByTestId("customize-input").fill("Show my groups as a grid");
  await page.getByTestId("customize-submit").click();
  await page.getByTestId("patch-accept").click();
  await expect(page.locator(".pliant-layout[data-layout=grid]")).toBeVisible();
  await page.getByTestId("undo").click();
  await expect(page.locator(".pliant-layout[data-layout=grid]")).toHaveCount(0);
});

test("12 · unknown request on the demo model is a neutral note with example chips, not a refusal", async ({ page }) => {
  await ask(page, "make the buttons spin");
  await expect(page.getByTestId("verdict")).toContainText("Demo model");
  await expect(page.getByTestId("clarify")).toHaveCount(0);
  await expect(page.getByTestId("examples")).toBeVisible();
});

test("13 · visitors are isolated: a change in one browser context is not seen in another", async ({ page, browser }) => {
  await ask(page, "Dark mode, bigger text, compact list");
  await accept(page);
  await expect(page.locator("[data-theme=dark]")).toBeVisible();
  const other = await (await browser.newContext()).newPage();
  await other.goto("/");
  await expect(other.getByTestId("group-list")).toBeVisible();
  await expect(other.locator("[data-theme=dark]")).toHaveCount(0);
});

test("14 · developer console: tightening a limit is enforced for that session only", async ({ page, request }) => {
  await page.goto("/dev");
  await expect(page.getByRole("heading", { name: "Developer console" })).toBeVisible();
  const input = page.getByLabel("message.send max per run");
  await input.fill("2");
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Tampered client: 7 sends in a 1-send run" }).click();
  await expect(page.getByText("Layer 3 · server enforcement")).toBeVisible();
  await expect(page.getByText("Blocked").first()).toBeVisible();
  const m = await (await request.get(`${API}/__pliant/manifest`, { headers: { "x-user-id": "u2" } })).json();
  expect(m.capabilities.find((c: any) => c.id === "message.send").policy.maxFanOut).toBe(5);
});

test("15 · phone layout: list → chat → back", async ({ browser }) => {
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await p.goto("/");
  await p.locator(".group-row").first().click();
  await expect(p.getByTestId("conversation")).toBeVisible();
  await expect(p.getByTestId("group-list")).toBeHidden();
  await p.getByRole("button", { name: "Back to groups" }).click();
  await expect(p.getByTestId("group-list")).toBeVisible();
});
