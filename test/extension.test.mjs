import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const processes = [];
mock.module("node:child_process", { exports: {
  spawn(file, args, options) {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    child.file = file;
    child.args = args;
    child.options = options;
    child.input = "";
    child.stdin.on("data", (chunk) => { child.input += chunk.toString(); });
    processes.push(child);
    return child;
  },
}});
const { default: extension } = await import("../index.ts");

function setup({ mode = "tui", result, select, entries = [] } = {}) {
  const hooks = {}, commands = {}, notifications = [];
  const ctx = { mode, sessionManager: { getBranch: () => entries }, ui: { notify: (message, kind) => notifications.push({ message, kind }), select: select ?? (async () => undefined) } };
  const pi = { on: (name, handler) => { hooks[name] = handler; }, registerCommand: (name, command) => { commands[name] = command; }, exec: async () => result };
  extension(pi);
  return { hooks, commands, notifications, ctx };
}
function message(text, stopReason = "stop") {
  return { message: { role: "assistant", stopReason, content: [{ type: "text", text }] } };
}

test("speaks only the final text after settling and cleans common Markdown", () => {
  const { hooks, ctx } = setup();
  const before = processes.length;
  hooks.before_agent_start({}, ctx);
  hooks.message_end(message("intermediate", "toolUse"), ctx);
  hooks.message_end(message("# Ciao **mondo**\n```js\ncode()\n```\n[link](https://example.com)"), ctx);
  assert.equal(processes.length, before);
  hooks.agent_settled({ aborted: false }, ctx);
  const child = processes.at(-1);
  assert.equal(processes.length, before + 1);
  assert.equal(child.file, "/usr/bin/say");
  assert.deepEqual(child.args, ["-v", "Alice"]);
  assert.match(child.input, /Ciao mondo/);
  assert.match(child.input, /blocco di codice omesso/);
  assert.doesNotMatch(child.input, /code\(\)|https:/);
  hooks.session_shutdown({}, ctx);
  assert.equal(child.killed, true);
});

test("ignores aborted, headless and failed responses", () => {
  const before = processes.length;
  const { hooks, ctx } = setup();
  hooks.message_end(message("errore", "error"), ctx);
  hooks.agent_settled({ aborted: false }, ctx);
  hooks.message_end(message("interrotta"), ctx);
  hooks.agent_settled({ aborted: true }, ctx);
  const headless = setup({ mode: "rpc" });
  headless.hooks.message_end(message("rpc"), headless.ctx);
  headless.hooks.agent_settled({ aborted: false }, headless.ctx);
  assert.equal(processes.length, before);
});

test("off, on, stop and a new prompt manage playback", async () => {
  const { hooks, commands, ctx } = setup();
  await commands.voce.handler("off", ctx);
  const before = processes.length;
  hooks.message_end(message("silenzio"), ctx);
  hooks.agent_settled({ aborted: false }, ctx);
  assert.equal(processes.length, before);
  await commands.voce.handler("on", ctx);
  hooks.message_end(message("ciao"), ctx);
  hooks.agent_settled({ aborted: false }, ctx);
  const first = processes.at(-1);
  await commands.voce.handler("stop", ctx);
  assert.equal(first.killed, true);
  hooks.message_end(message("ancora"), ctx);
  hooks.agent_settled({ aborted: false }, ctx);
  const second = processes.at(-1);
  hooks.before_agent_start({}, ctx);
  assert.equal(second.killed, true);
});

test("filters voices, selects one and uses it", async () => {
  let shown;
  const { hooks, commands, ctx, notifications } = setup({
    result: { code: 0, stdout: "Alice               it_IT    # Salve\nFederica            it_IT    # Ciao\nSamantha            en_US    # Hello\n", stderr: "" },
    select: async (_title, items) => { shown = items; return "Federica — it_IT"; },
  });
  await commands.voce.handler("elenco it_IT", ctx);
  assert.deepEqual(shown, ["Alice — it_IT", "Federica — it_IT"]);
  assert.match(notifications.at(-1).message, /Federica/);
  hooks.message_end(message("ciao"), ctx);
  hooks.agent_settled({ aborted: false }, ctx);
  assert.deepEqual(processes.at(-1).args, ["-v", "Federica"]);
  hooks.session_shutdown({}, ctx);
});

test("manual playback uses the latest complete response even when automatic speech is off", async () => {
  const entries = [
    { type: "message", ...message("prima") },
    { type: "message", ...message("ultima risposta") },
    { type: "message", ...message("strumento", "toolUse") },
  ];
  const { hooks, commands, ctx, notifications } = setup({ entries });
  await commands.voce.handler("off", ctx);
  await commands.voce.handler("", ctx);
  assert.equal(processes.at(-1).input, "ultima risposta");
  await commands.voce.handler("status", ctx);
  assert.match(notifications.at(-1).message, /disattivata/);
  hooks.session_shutdown({}, ctx);
  const empty = setup();
  await empty.commands.voce.handler("", empty.ctx);
  assert.match(empty.notifications.at(-1).message, /Nessuna risposta/);
});

test("config selects locale, voice and automatic playback; cancellation changes nothing", async () => {
  const result = { code: 0, stderr: "", stdout: "Alice  it_IT # Ciao\nFederica  it_IT # Salve\nSamantha  en_US # Hello\n" };
  const answers = ["it_IT", "Federica — it_IT", "Disattiva"];
  const { hooks, commands, ctx, notifications } = setup({ result, select: async () => answers.shift() });
  await commands.voce.handler("config", ctx);
  await commands.voce.handler("status", ctx);
  assert.match(notifications.at(-1).message, /disattivata.*Federica/);
  const before = processes.length;
  hooks.message_end(message("silenzio"), ctx);
  hooks.agent_settled({ aborted: false }, ctx);
  assert.equal(processes.length, before);
  const cancelled = setup({ result, select: async (_title, _items) => undefined });
  await cancelled.commands.voce.handler("config", cancelled.ctx);
  await cancelled.commands.voce.handler("status", cancelled.ctx);
  assert.match(cancelled.notifications.at(-1).message, /attiva.*Alice/);
});

test("completion advertises the filter and suggests actual locales and voice names", async () => {
  const result = { code: 0, stderr: "", stdout: "Alice  it_IT # Ciao\nFederica  it_IT # Salve\nSamantha  en_US # Hello\n" };
  const { commands } = setup({ result });
  const complete = commands.voce.getArgumentCompletions;
  assert.ok((await complete("")).some((item) => item.label === "elenco [lingua o nome]" && item.value === "elenco"));
  assert.deepEqual(await complete("elenco it"), [{ value: "elenco it_IT", label: "it_IT" }]);
  assert.deepEqual(await complete("voce Fed"), []);
  assert.deepEqual(await complete("voce it"), [{ value: "voce it_IT", label: "it_IT" }]);
  assert.deepEqual(await complete("voce "), [{ value: "voce en_US", label: "en_US" }, { value: "voce it_IT", label: "it_IT" }]);
  assert.deepEqual((await complete("voce ")).map((item) => item.label), (await complete("elenco ")).map((item) => item.label));
  assert.deepEqual(await complete("voce it_IT "), [{ value: "voce it_IT Alice", label: "Alice" }, { value: "voce it_IT Federica", label: "Federica" }]);
  assert.equal(await complete("inesistente"), null);
});

test("voice command selects language then voice, or accepts either directly", async () => {
  const result = { code: 0, stderr: "", stdout: "Alice  it_IT # Ciao\nFederica  it_IT # Salve\nSamantha  en_US # Hello\n" };
  const answers = ["it_IT", "Federica — it_IT"];
  const { commands, ctx, notifications } = setup({ result, select: async () => answers.shift() });
  await commands.voce.handler("voce", ctx);
  assert.match(notifications.at(-1).message, /Federica/);
  answers.push("Alice — it_IT");
  await commands.voce.handler("voce it_IT", ctx);
  assert.match(notifications.at(-1).message, /Alice/);
  await commands.voce.handler("voce Samantha", ctx);
  assert.match(notifications.at(-1).message, /Samantha/);
  await commands.voce.handler("voce it_IT Federica", ctx);
  assert.match(notifications.at(-1).message, /Federica/);
  await commands.voce.handler("voce Samantha", ctx);
  await commands.voce.handler("voce inesistente", ctx);
  assert.match(notifications.at(-1).message, /non trovata/);
  await commands.voce.handler("voce", ctx); // cancelled
  await commands.voce.handler("status", ctx);
  assert.match(notifications.at(-1).message, /Samantha/);
});

test("reports list errors and empty filters", async () => {
  const failure = setup({ result: { code: 1, stderr: "errore say", stdout: "" } });
  await failure.commands.voce.handler("elenco", failure.ctx);
  assert.match(failure.notifications.at(-1).message, /errore say/);
  const empty = setup({ result: { code: 0, stderr: "", stdout: "Alice  it_IT    # Ciao\n" } });
  await empty.commands.voce.handler("elenco fr_FR", empty.ctx);
  assert.match(empty.notifications.at(-1).message, /Nessuna voce/);
});
