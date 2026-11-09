import { test, mock, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const scratch = mkdtempSync(join(tmpdir(), "pi-voce-test-"));
const original = { dir: process.env.PI_CODING_AGENT_DIR, lock: process.env.PI_VOCE_LOCK_PATH };
const processes = [], apps = [];
let sequence = 0;
mock.module("node:child_process", { exports: {
  spawn(file, args) {
    const child = new EventEmitter();
    child.pid = process.pid;
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.killed = false;
    child.kill = (signal = "SIGTERM") => { child.killed = true; child.emit("close", null, signal); return true; };
    child.file = file; child.args = args; child.input = "";
    child.stdin.on("data", (chunk) => { child.input += chunk.toString(); });
    processes.push(child);
    return child;
  },
}});
const { default: extension } = await import("../index.ts");
const catalog = "Alice  it_IT # Salve, mi chiamo Alice.\nFederica  it_IT # Salve, mi chiamo Federica.\nLuca  it_IT # Ciao.\nSamantha  en_US # Hello, my name is Samantha.\n";
const message = (text, stopReason = "stop") => ({ message: { role: "assistant", stopReason, content: [{ type: "text", text }] } });
function setup({ mode = "tui", result = { code: 0, stdout: catalog, stderr: "" }, answers = [], input = "180", entries = [], directory, lockPath, exec } = {}) {
  const dir = directory ?? join(scratch, String(sequence++));
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.PI_VOCE_LOCK_PATH = lockPath ?? join(dir, "audio.lock");
  const hooks = {}, commands = {}, notifications = [], dialogs = [];
  const ctx = {
    mode, sessionManager: { getBranch: () => entries },
    ui: {
      notify: (message, kind) => notifications.push({ message, kind }),
      input: async (title) => { dialogs.push({ title }); return input; },
      select: async (title, items) => {
        dialogs.push({ title, items });
        const desired = answers.shift();
        if (desired === undefined) return undefined;
        const selected = items.find((item) => item === desired || item.includes(`(${desired})`) || item.startsWith(desired + " —"));
        assert.ok(selected, `Selection ${desired} not in ${JSON.stringify(items)}`);
        return selected;
      },
    },
  };
  extension({ on: (n, h) => { hooks[n] = h; }, registerCommand: (n, c) => { commands[n] = c; }, exec: exec ?? (async () => result) });
  const app = { hooks, commands, ctx, notifications, dialogs, configPath: join(dir, "pi-voce.json"), run: (args) => commands.voce.handler(args, ctx) };
  apps.push(app);
  return app;
}
afterEach(async () => { for (const app of apps.splice(0)) await app.hooks.session_shutdown({}, app.ctx); });
after(() => {
  for (const [name, value] of [["PI_CODING_AGENT_DIR", original.dir], ["PI_VOCE_LOCK_PATH", original.lock]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  rmSync(scratch, { recursive: true, force: true });
});

test("automatic speech is OFF by default, manual playback still works", async () => {
  const app = setup({ entries: [{ type: "message", ...message("Ultima risposta") }] });
  const before = processes.length;
  app.hooks.message_end(message("silenzio"), app.ctx);
  await app.hooks.agent_settled({ aborted: false }, app.ctx);
  assert.equal(processes.length, before);
  await app.run("");
  assert.equal(processes.at(-1).input, "Ultima risposta");
  await app.run("status");
  assert.match(app.notifications.at(-1).message, /disattivata/);
});

test("automatic final reply is cleaned; aborted, failed, tool and RPC messages are ignored", async () => {
  const app = setup();
  await app.run("on");
  const before = processes.length;
  for (const reason of ["toolUse", "error", "aborted"]) {
    app.hooks.message_end(message("ignore", reason), app.ctx);
    await app.hooks.agent_settled({ aborted: false }, app.ctx);
  }
  app.hooks.message_end(message("abort"), app.ctx);
  await app.hooks.agent_settled({ aborted: true }, app.ctx);
  assert.equal(processes.length, before);
  app.hooks.message_end(message("# Ciao **mondo**\n```js\ncode()\n```"), app.ctx);
  await app.hooks.agent_settled({ aborted: false }, app.ctx);
  assert.match(processes.at(-1).input, /Ciao mondo\nBlocco di codice omesso/);
  const headless = setup({ mode: "rpc" });
  await headless.run("on");
  headless.hooks.message_end(message("rpc"), headless.ctx);
  await headless.hooks.agent_settled({ aborted: false }, headless.ctx);
  assert.equal(processes.length, before + 1);
});

test("stop, new prompt and session shutdown terminate only owned playback", async () => {
  const app = setup();
  await app.run("anteprima");
  const first = processes.at(-1);
  await app.run("stop");
  assert.equal(first.killed, true);
  await app.run("anteprima");
  const second = processes.at(-1);
  await app.hooks.before_agent_start({}, app.ctx);
  assert.equal(second.killed, true);
  await app.run("anteprima");
  const third = processes.at(-1);
  await app.hooks.session_shutdown({}, app.ctx);
  assert.equal(third.killed, true);
});

test("language labels are readable, current voice marked, guided and direct selection work", async () => {
  const app = setup({ answers: ["it_IT", "Federica"] });
  await app.run("voce");
  assert.ok(app.dialogs[0].items.some((item) => /italiano/i.test(item) && /it_IT/.test(item)));
  assert.ok(app.dialogs[1].items.some((item) => /Alice.*attuale/.test(item)));
  await app.run("voce Samantha");
  await app.run("anteprima");
  assert.equal(processes.at(-1).input, "Hello, my name is Samantha.");
  assert.deepEqual(processes.at(-1).args, ["-v", "Samantha", "-r", "180"]);
  await app.run("voce it_IT Luca");
  assert.match(app.notifications.at(-1).message, /Luca/);
  await app.run("voce inesistente");
  assert.match(app.notifications.at(-1).message, /non trovata/);
});

test("both completion entry points suggest only languages, then voices for selected locale", async () => {
  const app = setup();
  const complete = app.commands.voce.getArgumentCompletions;
  assert.deepEqual((await complete("voce ")).map((i) => i.label), (await complete("elenco ")).map((i) => i.label));
  assert.deepEqual((await complete("voce it")).map((i) => i.value), ["voce it_IT"]);
  assert.deepEqual((await complete("voce it_IT F")).map((i) => i.value), ["voce it_IT Federica"]);
  assert.deepEqual(await complete("voce Fed"), []);
  assert.equal(await complete("inesistente"), null);
});

test("preferences persist and legacy automatic ON choice is preserved", async () => {
  const dir = join(scratch, "legacy");
  const first = setup({ directory: dir });
  await first.run("off");
  await writeFile(first.configPath, JSON.stringify({ enabled: true, voice: "Luca", locale: "it_IT", rate: 220 }));
  const second = setup({ directory: dir });
  await second.hooks.session_start({}, second.ctx);
  await second.run("status");
  assert.match(second.notifications.at(-1).message, /automatica attiva.*Luca.*220/);
  await second.run("off");
  const saved = JSON.parse(await readFile(first.configPath, "utf8"));
  assert.deepEqual(saved, { enabled: false, voice: "Luca", locale: "it_IT", rate: 220, readCode: false, readUrls: false, readTables: true });
});

test("config saves speed and state, displays defaults, empty speed preserves current value", async () => {
  const app = setup({ answers: ["it_IT", "Federica", "Continua", "Disattiva"], input: "" });
  await app.run("velocita 220");
  await app.run("config");
  assert.match(app.dialogs.find((i) => i.title.startsWith("Velocità")).title, /predefinita: 180.*Invio senza testo: 220/);
  assert.deepEqual(JSON.parse(await readFile(app.configPath, "utf8")), { enabled: false, voice: "Federica", locale: "it_IT", rate: 220, readCode: false, readUrls: false, readTables: true });
});

test("config preview is stopped on cancellation and saves no partial preference", async () => {
  const app = setup({ answers: ["it_IT", "Federica", "Ascolta anteprima", undefined], input: "250" });
  await app.run("velocita 180");
  const saved = await readFile(app.configPath, "utf8");
  await app.run("config");
  assert.equal(await readFile(app.configPath, "utf8"), saved);
  assert.deepEqual(processes.at(-1).args, ["-v", "Federica", "-r", "250"]);
  assert.equal(processes.at(-1).killed, true);
});

test("text preferences are saved atomically and used for manual speech", async () => {
  const app = setup({ answers: ["Leggi", "Leggi", "Ometti"], entries: [{ type: "message", ...message("~~~sh\necho ciao\n~~~\nhttps://example.com\n| A | B |\n| --- | --- |\n| 1 | 2 |") }] });
  await app.run("testo");
  await app.run("");
  const text = processes.at(-1).input;
  assert.match(text, /echo ciao/); assert.match(text, /https:\/\/example.com/); assert.match(text, /Tabella omessa/);
  const cancelled = setup({ answers: ["Leggi", undefined] });
  await cancelled.run("off");
  const saved = await readFile(cancelled.configPath, "utf8");
  await cancelled.run("testo");
  assert.equal(await readFile(cancelled.configPath, "utf8"), saved);
});

test("two sessions cannot overlap; stopping the other session does not interrupt the owner", async () => {
  const lockPath = join(scratch, "shared-audio.lock");
  const first = setup({ lockPath }), second = setup({ lockPath });
  await first.run("anteprima");
  const owner = processes.at(-1), count = processes.length;
  await second.run("anteprima");
  assert.equal(processes.length, count);
  assert.match(second.notifications.at(-1).message, /Audio occupato/);
  await second.run("stop");
  assert.equal(owner.killed, false);
  await first.run("stop");
  await second.run("anteprima");
  assert.equal(processes.length, count + 1);
});

test("unavailable voice falls back without overwriting saved preference, empty catalog reports error", async () => {
  const app = setup({ result: { code: 0, stdout: "Samantha  en_US # Hello.\n", stderr: "" } });
  await app.run("off");
  await app.run("anteprima");
  assert.match(app.notifications.at(-1).message, /Alice.*non disponibile.*Samantha/);
  assert.equal(JSON.parse(await readFile(app.configPath, "utf8")).voice, "Alice");
  assert.equal(processes.at(-1).args[1], "Samantha");
  const empty = setup({ result: { code: 0, stdout: "", stderr: "" } });
  await empty.run("anteprima");
  assert.match(empty.notifications.at(-1).message, /Nessuna voce/);
});

test("invalid rates, corrupt preferences, save failures and enumeration errors are reported", async () => {
  const app = setup();
  await app.hooks.session_start({}, app.ctx);
  await app.run("velocita 200");
  for (const value of ["79", "401", "200.5", "testo"]) { await app.run(`velocita ${value}`); assert.equal(app.notifications.at(-1).kind, "warning"); }
  assert.equal(JSON.parse(await readFile(app.configPath, "utf8")).rate, 200);
  await writeFile(app.configPath, "not json");
  await app.hooks.session_start({}, app.ctx);
  assert.match(app.notifications.at(-1).message, /non caricate/);
  const blocked = setup({ directory: join(app.configPath, "blocked") });
  await blocked.run("on");
  assert.equal(blocked.notifications.at(-1).kind, "error");
  const failed = setup({ result: { code: 1, stdout: "", stderr: "errore say" } });
  await failed.run("elenco");
  assert.match(failed.notifications.at(-1).message, /errore say/);
});

test("a new prompt cancels voice preparation before a pending enumeration completes", async () => {
  let resolve;
  const app = setup({ exec: () => new Promise((done) => { resolve = done; }) });
  const before = processes.length;
  const reading = app.run("anteprima");
  // Let preparation reach enumeration, then cancel it like a new user prompt.
  while (!resolve) await Promise.resolve();
  await app.hooks.before_agent_start({}, app.ctx);
  resolve({ code: 0, stdout: catalog, stderr: "" });
  await reading;
  assert.equal(processes.length, before);
});

test("a new manual read closes its old player before reacquiring the audio lease", async () => {
  const app = setup();
  await app.run("anteprima");
  const first = processes.at(-1);
  await app.run("anteprima");
  assert.equal(first.killed, true);
  assert.notEqual(processes.at(-1), first);
  assert.equal(app.notifications.length, 0);
});

test("player error and abnormal exit free the audio lease", async () => {
  const app = setup();
  await app.run("anteprima");
  processes.at(-1).emit("error", new Error("spawn failure"));
  processes.at(-1).emit("close", -1, null);
  assert.match(app.notifications.at(-1).message, /spawn failure/);
  await app.run("anteprima");
  processes.at(-1).stderr.write("bad voice");
  processes.at(-1).emit("close", 1, null);
  assert.match(app.notifications.at(-1).message, /bad voice/);
  await app.run("anteprima");
});
