import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { acquireAudioLock } from "../audio-lock.ts";

const scratch = mkdtempSync(join(tmpdir(), "pi-voce-lock-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const moduleUrl = new URL("../audio-lock.ts", import.meta.url).href;

test("exclusive lease, idempotent release and late releases protect the next owner", () => {
  const path = join(scratch, "basic.lock");
  const first = acquireAudioLock(path);
  assert.ok(first);
  assert.equal(acquireAudioLock(path), undefined);
  first.release();
  const second = acquireAudioLock(path);
  assert.ok(second);
  first.release();
  assert.equal(acquireAudioLock(path), undefined);
  second.release();
});

test("real processes compete for one lease without overlapping", { timeout: 15000 }, async () => {
  const path = join(scratch, "process.lock");
  const code = `import {acquireAudioLock} from ${JSON.stringify(moduleUrl)};
    const lease=acquireAudioLock(${JSON.stringify(path)});
    if(lease){process.stdin.resume();process.stdin.on('end',()=>{lease.release();process.exit(0)});}
    console.log(lease?'acquired':'busy');`;
  const children = Array.from({ length: 5 }, () => spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["pipe", "pipe", "pipe"] }));
  try {
    const replies = await Promise.all(children.map(async (child) => (await once(child.stdout, "data"))[0].toString().trim()));
    assert.equal(replies.filter((reply) => reply === "acquired").length, 1);
    assert.equal(replies.filter((reply) => reply === "busy").length, 4);
  } finally {
    await Promise.all(children.map(async (child) => {
      if (child.exitCode !== null) return;
      const done = once(child, "close");
      child.stdin.end();
      await done;
    }));
  }
});

test("dead owner can be reclaimed, but its surviving player cannot be interrupted", () => {
  const path = join(scratch, "stale.lock");
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `import {acquireAudioLock} from ${JSON.stringify(moduleUrl)}; acquireAudioLock(${JSON.stringify(path)});`]);
  assert.equal(child.status, 0, child.stderr.toString());
  const ownerFile = join(path, readdirSync(path)[0]);
  writeFileSync(ownerFile, JSON.stringify({ pid: child.pid, player: process.pid }));
  assert.equal(acquireAudioLock(path), undefined);
  writeFileSync(ownerFile, JSON.stringify({ pid: child.pid, player: 0 }));
  const recovered = acquireAudioLock(path);
  assert.ok(recovered);
  recovered.release();
});
