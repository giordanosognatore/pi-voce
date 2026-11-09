import { test, mock, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const scratch = mkdtempSync(join(tmpdir(), "pi-voce-test-"));
const previousDir = process.env.PI_CODING_AGENT_DIR;
let sequence = 0;
after(() => {
  if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousDir;
  rmSync(scratch, { recursive: true, force: true });
});
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

function setup({ mode = "tui", result, select, input, entries = [], directory } = {}) {
  process.env.PI_CODING_AGENT_DIR = directory ?? join(scratch, String(sequence++));
  const configPath = join(process.env.PI_CODING_AGENT_DIR, "pi-voce.json");
  const hooks = {}, commands = {}, notifications = [];
  const ctx = { mode, sessionManager: { getBranch: () => entries }, ui: { notify: (message, kind) => notifications.push({ message, kind }), select: select ?? (async () => undefined), input: input ?? (async () => "180") } };
  const pi = { on: (name, handler) => { hooks[name] = handler; }, registerCommand: (name, command) => { commands[name] = command; }, exec: async () => result };
  extension(pi);
  return { hooks, commands, notifications, ctx, configPath };
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
  assert.deepEqual(child.args, ["-v", "Alice", "-r", "180"]);
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
  assert.deepEqual(processes.at(-1).args, ["-v", "Federica", "-r", "180"]);
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
  const answers = ["it_IT", "Federica — it_IT", "Continua", "Disattiva"];
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

test("voice, locale, speed and disabled state survive a fresh extension runtime", async () => {
  const directory = join(scratch, "persistent");
  const first = setup({ directory, result: { code: 0, stderr: "", stdout: "Luca  it_IT # Ciao\n" } });
  await first.commands.voce.handler("voce Luca", first.ctx);
  await first.commands.voce.handler("velocita 220", first.ctx);
  await first.commands.voce.handler("off", first.ctx);
  assert.deepEqual(JSON.parse(await readFile(first.configPath, "utf8")), { voice: "Luca", locale: "it_IT", rate: 220, enabled: false });
  const second = setup({ directory });
  await second.hooks.session_start({}, second.ctx);
  await second.commands.voce.handler("status", second.ctx);
  assert.match(second.notifications.at(-1).message, /disattivata.*Luca.*it_IT.*220/);
  await second.commands.voce.handler("anteprima", second.ctx);
  assert.deepEqual(processes.at(-1).args, ["-v", "Luca", "-r", "220"]);
  const before = processes.length;
  second.hooks.message_end(message("silenzio"), second.ctx);
  second.hooks.agent_settled({ aborted: false }, second.ctx);
  assert.equal(processes.length, before);
  second.hooks.session_shutdown({}, second.ctx);
});

test("config displays the default speed and empty input preserves the current speed", async () => {
  const answers = ["it_IT", "Federica — it_IT", "Continua", "Disattiva"];
  let title;
  const app = setup({
    result: { code: 0, stderr: "", stdout: "Federica  it_IT # Ciao\n" },
    select: async () => answers.shift(),
    input: async (prompt) => { title = prompt; return ""; },
  });
  await app.commands.voce.handler("velocita 220", app.ctx);
  await app.commands.voce.handler("config", app.ctx);
  assert.match(title, /predefinita: 180/);
  assert.match(title, /Invio senza testo: 220/);
  assert.equal(JSON.parse(await readFile(app.configPath, "utf8")).rate, 220);
});

test("speed validation rejects invalid numbers without changing saved preferences", async () => {
  const app = setup();
  await app.commands.voce.handler("velocita 200", app.ctx);
  for (const value of ["0", "79", "401", "Infinity", "200.5", "testo"]) {
    await app.commands.voce.handler(`velocita ${value}`, app.ctx);
    assert.equal(app.notifications.at(-1).kind, "warning");
  }
  assert.equal(JSON.parse(await readFile(app.configPath, "utf8")).rate, 200);
  await app.commands.voce.handler("velocita", app.ctx);
  assert.match(app.notifications.at(-1).message, /200/);
});

test("config preview uses proposed voice and speed; cancellation at every stage preserves settings", async () => {
  for (const cancelAt of [0, 1, 2, 3, 4]) {
    let step = 0;
    const values = ["it_IT", "Federica — it_IT", "250", "Ascolta anteprima", undefined];
    const answer = async () => step === cancelAt ? (step++, undefined) : values[step++];
    const app = setup({ result: { code: 0, stderr: "", stdout: "Federica  it_IT # Ciao\n" }, select: answer, input: answer });
    await app.commands.voce.handler("velocita 180", app.ctx);
    const saved = await readFile(app.configPath, "utf8");
    await app.commands.voce.handler("config", app.ctx);
    assert.equal(await readFile(app.configPath, "utf8"), saved);
    if (cancelAt === 4) {
      assert.deepEqual(processes.at(-1).args, ["-v", "Federica", "-r", "250"]);
      assert.equal(processes.at(-1).killed, true);
    }
  }
  const answers = ["it_IT", "Federica — it_IT", "Continua", undefined];
  const app = setup({ result: { code: 0, stderr: "", stdout: "Federica  it_IT # Ciao\n" }, select: async () => answers.shift() });
  await app.commands.voce.handler("config", app.ctx);
  await app.commands.voce.handler("status", app.ctx);
  assert.match(app.notifications.at(-1).message, /attiva.*Alice/);
});

test("missing preferences use defaults; corrupt or unwritable preferences are reported", async () => {
  const app = setup();
  await app.hooks.session_start({}, app.ctx);
  assert.equal(app.notifications.length, 0);
  await app.commands.voce.handler("on", app.ctx);
  await writeFile(app.configPath, "not json");
  await app.hooks.session_start({}, app.ctx);
  assert.equal(app.notifications.at(-1).kind, "warning");
  await writeFile(app.configPath, JSON.stringify({ enabled: true, voice: "Alice", locale: "it_IT", rate: 1 }));
  await app.hooks.session_start({}, app.ctx);
  assert.match(app.notifications.at(-1).message, /Formato/);
  const blocked = setup({ directory: join(app.configPath, "not-a-directory") });
  await blocked.commands.voce.handler("off", blocked.ctx);
  assert.equal(blocked.notifications.at(-1).kind, "error");
  await blocked.commands.voce.handler("status", blocked.ctx);
  assert.match(blocked.notifications.at(-1).message, /automatica attiva/);
});

test("reports list errors and empty filters", async () => {
  const failure = setup({ result: { code: 1, stderr: "errore say", stdout: "" } });
  await failure.commands.voce.handler("elenco", failure.ctx);
  assert.match(failure.notifications.at(-1).message, /errore say/);
  const empty = setup({ result: { code: 0, stderr: "", stdout: "Alice  it_IT    # Ciao\n" } });
  await empty.commands.voce.handler("elenco fr_FR", empty.ctx);
  assert.match(empty.notifications.at(-1).message, /Nessuna voce/);
});
