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
