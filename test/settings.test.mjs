import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readdirSync, symlinkSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { defaults, loadSettings, saveSettings, updateSettings } from "../settings.ts";
import { acquireAudioLock } from "../audio-lock.ts";

const scratch = mkdtempSync(join(tmpdir(), "pi-voce-settings-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const moduleUrl = new URL("../settings.ts", import.meta.url).href;
const lockUrl = new URL("../audio-lock.ts", import.meta.url).href;

test("simultaneous patches in one process preserve unrelated fields and use private atomic files", async () => {
  const path = join(scratch, "same-process", "pi-voce.json");
  await Promise.all([
    updateSettings(path, { rate: 240 }),
    updateSettings(path, { voice: "Luca", locale: "it_IT" }),
    updateSettings(path, { enabled: true }),
    updateSettings(path, { readUrls: true }),
  ]);
  assert.deepEqual(await loadSettings(path), { ...defaults, rate: 240, voice: "Luca", enabled: true, readUrls: true });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(join(scratch, "same-process")), ["pi-voce.json"]);
});

test("real processes save disjoint patches concurrently without lost updates", { timeout: 15000 }, async () => {
  const path = join(scratch, "processes", "pi-voce.json");
  await saveSettings(path, defaults);
  const patches = [{ enabled: true }, { voice: "Samantha", locale: "en_US" }, { rate: 247 }, { readCode: true }, { readUrls: true }, { readTables: false }];
  const children = patches.map((patch) => {
    const code = `import {updateSettings} from ${JSON.stringify(moduleUrl)};
      import {once} from 'node:events';
      process.send('ready'); await once(process, 'message');
      for(let i=0;i<3;i++) await updateSettings(${JSON.stringify(path)}, ${JSON.stringify(patch)});
      process.disconnect();`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let stderr = "";
    child.stderr.on("data", (data) => { stderr += data; });
    return { child, ready: once(child, "message"), done: new Promise((resolve) => child.once("close", (code) => resolve({ code, stderr }))) };
  });
  try {
    await Promise.all(children.map(({ ready }) => ready));
    for (const { child } of children) child.send("go");
    for (const result of await Promise.all(children.map(({ done }) => done))) assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(await loadSettings(path), Object.assign({}, defaults, ...patches));
    assert.equal(existsSync(`${path}.lock`), false);
  } finally {
    for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.all(children.map(({ done }) => done));
  }
});

test("a live owner is respected, waiting saves reread after acquisition and timeout changes nothing", async () => {
  const path = join(scratch, "waiting.json");
  await saveSettings(path, defaults);
  const lease = acquireAudioLock(`${path}.lock`);
  assert.ok(lease);
  try {
    await assert.rejects(updateSettings(path, { rate: 300 }, { timeoutMs: 0 }), /Preferenze occupate/);
    const waiting = updateSettings(path, { readUrls: true });
    // The lock owner makes its change before the waiting transaction may read.
    await writeFile(path, JSON.stringify({ ...defaults, rate: 220 }));
    lease.release();
    assert.deepEqual(await waiting, { ...defaults, rate: 220, readUrls: true });
  } finally { lease.release(); }
  assert.equal(existsSync(`${path}.lock`), false);
});

test("directory aliases coordinate through the same canonical lock", async () => {
  const real = join(scratch, "canonical"), alias = join(scratch, "alias");
  await mkdir(real);
  symlinkSync(real, alias, "dir");
  await Promise.all([
    updateSettings(join(real, "config.json"), { rate: 230 }),
    updateSettings(join(alias, "config.json"), { readCode: true }),
  ]);
  assert.deepEqual(await loadSettings(join(real, "config.json")), { ...defaults, rate: 230, readCode: true });
});

test("an exited settings owner is recovered without manual lock deletion", async () => {
  const path = join(scratch, "stale.json");
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `import {acquireAudioLock} from ${JSON.stringify(lockUrl)}; acquireAudioLock(${JSON.stringify(`${path}.lock`)});`]);
  assert.equal(child.status, 0, child.stderr.toString());
  assert.equal((await updateSettings(path, { rate: 215 })).rate, 215);
  assert.equal(existsSync(`${path}.lock`), false);
});

test("corrupt preferences release the lock unchanged; explicit save can repair them", async () => {
  const path = join(scratch, "corrupt.json");
  await writeFile(path, "not json");
  await assert.rejects(updateSettings(path, { rate: 220 }));
  assert.equal(await readFile(path, "utf8"), "not json");
  assert.equal(existsSync(`${path}.lock`), false);
  await saveSettings(path, { ...defaults, voice: "Luca" });
  assert.equal((await loadSettings(path)).voice, "Luca");
});

test("failed replacement removes temporary files and the settings lease", async () => {
  const directory = join(scratch, "failure"), target = join(directory, "config.json");
  await mkdir(target, { recursive: true });
  await assert.rejects(saveSettings(target, defaults));
  assert.deepEqual(readdirSync(directory), ["config.json"]);
});

test("readers always observe complete JSON during concurrent atomic updates", async () => {
  const path = join(scratch, "readers.json");
  await saveSettings(path, defaults);
  const updates = Promise.all(Array.from({ length: 12 }, (_, index) => updateSettings(path, { rate: 180 + index })));
  for (let i = 0; i < 20; i++) assert.ok((await loadSettings(path)).rate >= 180);
  await updates;
  assert.equal(existsSync(`${path}.lock`), false);
});
