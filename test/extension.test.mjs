import { test, mock, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const scratch = mkdtempSync(join(tmpdir(), "pi-voce-test-"));
const original = { dir: process.env.PI_CODING_AGENT_DIR, lock: process.env.PI_VOCE_LOCK_PATH, stopKey: process.env.PI_VOCE_STOP_KEY };
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
function setup({ mode = "tui", result = { code: 0, stdout: catalog, stderr: "" }, answers = [], input = "180", entries = [], directory, lockPath, exec, stopKey = "escape" } = {}) {
  const dir = directory ?? join(scratch, String(sequence++));
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.PI_VOCE_LOCK_PATH = lockPath ?? join(dir, "audio.lock");
  process.env.PI_VOCE_STOP_KEY = stopKey;
  const hooks = {}, commands = {}, shortcuts = {}, notifications = [], dialogs = [], statuses = [], colors = [];
  const terminalHandlers = new Set();
  const ctx = {
    mode, sessionManager: { getBranch: () => entries },
    ui: {
      theme: { fg: (color, text) => { colors.push(color); return text; } },
      onTerminalInput: (handler) => { terminalHandlers.add(handler); return () => terminalHandlers.delete(handler); },
      notify: (message, kind) => notifications.push({ message, kind }),
      setStatus: (key, text) => statuses.push({ key, text }),
      input: async (title) => { dialogs.push({ title }); return input; },
      select: async (title, items) => {
        dialogs.push({ title, items });
        const desired = answers.shift();
        if (desired === undefined) return undefined;
        const selected = typeof desired === "number" ? items[desired] : items.find((item) => item === desired || item.includes(`(${desired})`) || item.startsWith(desired + " —"));
        assert.ok(selected, `Selection ${desired} not in ${JSON.stringify(items)}`);
        return selected;
      },
    },
  };
  extension({ on: (n, h) => { hooks[n] = h; }, registerShortcut: (key, options) => { shortcuts[key] = options; }, registerCommand: (n, c) => { commands[n] = c; }, exec: exec ?? (async () => result) });
  const app = { hooks, commands, shortcuts, terminalHandlers, ctx, notifications, dialogs, statuses, colors, configPath: join(dir, "pi-voce.json"), run: (args) => commands.voce.handler(args, ctx) };
  apps.push(app);
  return app;
}
afterEach(async () => { for (const app of apps.splice(0)) await app.hooks.session_shutdown({}, app.ctx); });
after(() => {
  for (const [name, value] of [["PI_CODING_AGENT_DIR", original.dir], ["PI_VOCE_LOCK_PATH", original.lock], ["PI_VOCE_STOP_KEY", original.stopKey]]) {
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
  assert.match(second.notifications.at(-1).message, /automatica: attiva.*Luca.*220/s);
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

test("status groups current and saved preferences into readable multiline sections", async () => {
  const app = setup();
  await app.run("off");
  await app.run("sessione voce Federica");
  await app.run("status");
  const output = app.notifications.at(-1).message;
  assert.match(output, /^SESSIONE CORRENTE\n  Lettura automatica: disattivata\n  Voce: Federica/);
  assert.match(output, /\n\nPREDEFINITE SALVATE\n  Lettura automatica: disattivata\n  Voce: Alice/);
  assert.match(output, /\n\nINFORMAZIONI\n  Modifiche rispetto alle salvate: sì/);
  assert.match(output, /File preferenze:\n    /);
  assert.ok(output.split("\n").length > 15);
});

test("footer follows settings, actual playback and cleanup, but stays hidden in RPC mode", async () => {
  const app = setup();
  await app.hooks.session_start({}, app.ctx);
  assert.match(app.statuses.at(-1).text, /Alice.*180.*auto off/);
  assert.equal(app.colors.at(-1), "dim");
  await app.run("sessione velocita 240");
  assert.match(app.statuses.at(-1).text, /240.*sessione/);
  await app.run("anteprima");
  assert.match(app.statuses.at(-1).text, /lettura in corso/);
  processes.at(-1).emit("close", 0, null);
  assert.doesNotMatch(app.statuses.at(-1).text, /lettura in corso/);
  await app.hooks.session_shutdown({}, app.ctx);
  assert.equal(app.statuses.at(-1).text, undefined);
  const rpc = setup({ mode: "rpc" });
  await rpc.hooks.session_start({}, rpc.ctx);
  await rpc.run("sessione off");
  assert.equal(rpc.statuses.length, 0);
});

test("reply browser lists only complete answers in the current branch, newest first", async () => {
  const entries = [
    { id: "a", type: "message", ...message("prima risposta") },
    { id: "tool", type: "message", ...message("non finale", "toolUse") },
    { id: "b", type: "message", ...message("seconda risposta") },
    { id: "fail", type: "message", ...message("errore", "error") },
  ];
  const app = setup({ entries, answers: [1] });
  await app.run("risposte");
  assert.match(app.dialogs.at(-1).items[0], /^2\..*seconda risposta/);
  assert.match(app.dialogs.at(-1).items[1], /^1\..*prima risposta/);
  assert.equal(processes.at(-1).input, "prima risposta");
  await app.hooks.session_tree({}, app.ctx);
  assert.equal(processes.at(-1).killed, true);
  const count = processes.length;
  await app.run("risposte"); // Esc
  assert.equal(processes.length, count);
  entries.splice(0, entries.length);
  await app.run("risposte");
  assert.match(app.notifications.at(-1).message, /Nessuna risposta/);
});

test("temporary overrides survive prompts but do not alter defaults or leak into ordinary saves", async () => {
  const app = setup();
  await app.run("off");
  const saved = await readFile(app.configPath, "utf8");
  await app.run("sessione voce Federica");
  await app.run("sessione on");
  assert.equal(await readFile(app.configPath, "utf8"), saved);
  await app.hooks.before_agent_start({}, app.ctx);
  await app.run("status");
  assert.match(app.notifications.at(-1).message, /automatica: attiva.*Federica/s);
  await app.run("velocita 210"); // persist just speed, not temporary voice/on
  const disk = JSON.parse(await readFile(app.configPath, "utf8"));
  assert.equal(disk.voice, "Alice"); assert.equal(disk.enabled, false); assert.equal(disk.rate, 210);
  assert.match(app.statuses.at(-1).text, /Federica.*210.*auto on.*sessione/);
  await app.run("ripristina");
  assert.match(app.statuses.at(-1).text, /Alice.*210.*auto off/);
  assert.doesNotMatch(app.statuses.at(-1).text, /sessione/);
});

test("save explicitly persists all current settings and a fresh runtime restores them", async () => {
  const dir = join(scratch, "temporary-saved");
  const first = setup({ directory: dir });
  await first.run("sessione voce Luca");
  await first.run("sessione velocita 250");
  await first.run("salva");
  assert.doesNotMatch(first.statuses.at(-1).text, /sessione/);
  const second = setup({ directory: dir });
  await second.hooks.session_start({}, second.ctx);
  assert.match(second.statuses.at(-1).text, /Luca.*250/);
  await second.run("sessione velocita 300");
  await second.hooks.session_shutdown({}, second.ctx);
  const reloaded = setup({ directory: dir });
  await reloaded.hooks.session_start({}, reloaded.ctx);
  assert.match(reloaded.statuses.at(-1).text, /250/);
  assert.doesNotMatch(reloaded.statuses.at(-1).text, /300/);
});

test("temporary config and text preferences never write disk, and nested completion keeps scope", async () => {
  const app = setup({ answers: ["it_IT", "Federica", "Continua", "Attiva", "Leggi", "Ometti", "Ometti"] });
  await app.run("off");
  const saved = await readFile(app.configPath, "utf8");
  await app.run("sessione config");
  await app.run("sessione testo");
  assert.equal(await readFile(app.configPath, "utf8"), saved);
  await app.run("status");
  assert.match(app.notifications.at(-1).message, /Codice: leggi/);
  const complete = app.commands.voce.getArgumentCompletions;
  assert.ok((await complete("sessione ")).every((item) => item.value.startsWith("sessione ")));
  assert.deepEqual((await complete("sessione voce it_IT F")).map((item) => item.value), ["sessione voce it_IT Federica"]);
  assert.equal(await complete("sessione salva"), null);
});

test("Escape stops playback without consuming Pi cancel or changing preferences; listener is cleaned up", async () => {
  const app = setup();
  await app.hooks.session_start({}, app.ctx);
  assert.equal(app.terminalHandlers.size, 1);
  await app.hooks.session_start({}, app.ctx);
  assert.equal(app.terminalHandlers.size, 1);
  await app.run("off");
  const saved = await readFile(app.configPath, "utf8");
  await app.run("anteprima");
  const child = processes.at(-1);
  assert.equal(app.shortcuts.escape, undefined);
  const handler = [...app.terminalHandlers][0];
  assert.equal(handler("\u001b[A"), undefined); // arrow, not Escape
  assert.equal(child.killed, false);
  assert.equal(handler("\u001b"), undefined); // keep forwarding to Pi
  await Promise.resolve();
  assert.equal(child.killed, true);
  assert.equal(await readFile(app.configPath, "utf8"), saved);
  assert.doesNotMatch(app.statuses.at(-1).text, /lettura in corso/);
  await app.hooks.session_shutdown({}, app.ctx);
  assert.equal(app.terminalHandlers.size, 0);
});

test("a custom stop key is registered, or can be disabled", () => {
  const custom = setup({ stopKey: "ctrl+esc" });
  assert.ok(custom.shortcuts["ctrl+escape"]);
  assert.equal(custom.shortcuts["ctrl+alt+s"], undefined);
  const disabled = setup({ stopKey: "off" });
  assert.equal(Object.keys(disabled.shortcuts).length, 0);
});

test("reply browser filters by prompt and identifies the current reading", async () => {
  const entries = [
    { type: "message", id: "u1", message: { role: "user", content: "Parlami di astronomia" } },
    { type: "message", id: "a1", timestamp: "2026-11-09T12:30:00Z", ...message("Le stelle") },
    { type: "message", id: "u2", message: { role: "user", content: "Parlami di ricette" } },
    { type: "message", id: "a2", timestamp: "2026-11-09T12:35:00Z", ...message("La pasta") },
  ];
  const app = setup({ entries, answers: [0] });
  await app.run("risposte astronomia");
  assert.equal(processes.at(-1).input, "Le stelle");
  assert.equal(app.dialogs.at(-1).items.length, 1);
  assert.match(app.dialogs.at(-1).items[0], /2026.*Parlami di astronomia.*Le stelle/);
  await app.run("risposte"); // cancel; currently playing item should be labelled
  assert.ok(app.dialogs.at(-1).items.some((label) => /in lettura.*astronomia/.test(label)));
  const before = processes.length;
  await app.run("risposte inesistente");
  assert.equal(processes.length, before);
  assert.match(app.notifications.at(-1).message, /Nessuna risposta corrisponde/);
  await app.run("stop");
  await app.run("risposte");
  assert.ok(app.dialogs.at(-1).items.every((label) => !label.includes("in lettura")));
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
