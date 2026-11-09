import assert from "node:assert/strict";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// Pi loads TypeScript packages with its own loader. For this isolated smoke
// test, strip types in the installed tarball without adding a runtime dependency.
registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".ts")) return {
    format: "module", shortCircuit: true,
    source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8")),
  };
  return nextLoad(url, context);
}});
const { default: extension } = await import(pathToFileURL(join(process.argv[2], "index.ts")).href);
const hooks = {}, commands = {}, shortcuts = {}, statuses = [], notifications = [];
extension({
  on: (name, handler) => { hooks[name] = handler; },
  registerCommand: (name, command) => { commands[name] = command; },
  registerShortcut: (key, shortcut) => { shortcuts[key] = shortcut; },
});
assert.ok(commands.voce); assert.equal(shortcuts.escape, undefined);
let inputHandler;
const ctx = { mode: "tui", ui: { theme: { fg: (_color, text) => text }, setStatus: (_key, text) => statuses.push(text), notify: (text) => notifications.push(text), onTerminalInput: (handler) => { inputHandler = handler; return () => { inputHandler = undefined; }; } } };
await hooks.session_start({}, ctx);
assert.equal(typeof inputHandler, "function");
assert.equal(inputHandler("\u001b"), undefined);
assert.match(statuses.at(-1), /auto off/);
await commands.voce.handler("sessione velocita 210", ctx);
assert.match(statuses.at(-1), /210.*sessione/);
const configPath = join(process.env.PI_CODING_AGENT_DIR, "pi-voce.json");
assert.equal(existsSync(configPath), false);
await commands.voce.handler("aiuto", ctx);
assert.match(notifications.at(-1), /PI VOCE — AIUTO/);
assert.match(notifications.at(-1), /\/voce riprendi/);
await commands.voce.handler("riprendi", ctx);
assert.match(notifications.at(-1), /Nessuna lettura da riprendere/);
await commands.voce.handler("velocita 230", ctx);
assert.equal(JSON.parse(readFileSync(configPath, "utf8")).rate, 230);
assert.equal(existsSync(`${configPath}.lock`), false);
await hooks.session_shutdown({}, ctx);
assert.equal(statuses.at(-1), undefined);
assert.equal(inputHandler, undefined);
console.log("Smoke test del pacchetto installato superato (nessun audio o provider AI).");
