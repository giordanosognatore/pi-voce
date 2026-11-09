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
const hooks = {}, commands = {}, shortcuts = {}, statuses = [];
extension({
  on: (name, handler) => { hooks[name] = handler; },
  registerCommand: (name, command) => { commands[name] = command; },
  registerShortcut: (key, shortcut) => { shortcuts[key] = shortcut; },
});
assert.ok(commands.voce); assert.ok(shortcuts["ctrl+alt+s"]);
const ctx = { mode: "tui", ui: { theme: { fg: (_color, text) => text }, setStatus: (_key, text) => statuses.push(text), notify: () => {} } };
await hooks.session_start({}, ctx);
assert.match(statuses.at(-1), /auto off/);
await commands.voce.handler("sessione velocita 210", ctx);
assert.match(statuses.at(-1), /210.*sessione/);
assert.equal(existsSync(join(process.env.PI_CODING_AGENT_DIR, "pi-voce.json")), false);
await hooks.session_shutdown({}, ctx);
assert.equal(statuses.at(-1), undefined);
console.log("Smoke test del pacchetto installato superato (nessun audio o provider AI).");
