import { test } from "node:test";
import assert from "node:assert/strict";
import { repliesInBranch } from "../history.ts";
import { stopShortcut } from "../shortcut.ts";

const user = (id, content) => ({ type: "message", id, message: { role: "user", content } });
const reply = (id, text, timestamp = "2026-11-09T12:00:00Z") => ({ type: "message", id, timestamp, message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] } });

test("history associates the preceding user prompt, ignores system/tool content, and keeps chronological numbers", () => {
  const entries = [user("u1", "Caffè e stelle"), reply("a1", "Prima risposta"),
    { type: "message", message: { role: "toolResult", content: "not a prompt" } },
    reply("a2", "Seconda risposta"), user("u2", [{ type: "text", text: "Pasta" }, { type: "image", data: "" }]), reply("a3", "Ricetta")];
  const all = repliesInBranch(entries);
  assert.equal(all[0].prompt, "Pasta");
  assert.equal(all[1].prompt, "Caffè e stelle");
  const filtered = repliesInBranch(entries, { filter: "caffe seconda", playingId: "a2" });
  assert.equal(filtered.length, 1);
  assert.match(filtered[0].label, /^2\. ▶ in lettura/);
  assert.match(filtered[0].label, /2026/);
});

test("missing dates and image-only prompts have safe fallback labels", () => {
  const replies = repliesInBranch([user("u", [{ type: "image", data: "" }]), reply("a", "test\u001b[0m", "invalid")]);
  assert.match(replies[0].label, /ora non disponibile.*allegati/);
  assert.ok(!replies[0].label.includes("\u001b"));
});

test("stop shortcut accepts a custom key, disabling and invalid configuration", () => {
  assert.equal(stopShortcut().key, "ctrl+alt+s");
  assert.equal(stopShortcut("ctrl+shift+F8").key, "ctrl+shift+f8");
  assert.equal(stopShortcut("alt+pageUp").key, "alt+pageUp");
  assert.equal(stopShortcut("off").key, undefined);
  assert.match(stopShortcut("not-a-key").warning, /non valido/);
});
