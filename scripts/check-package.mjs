import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), "pi-voce-package-"));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 60000, ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
try {
  const [packed] = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch], { cwd: root }));
  assert.ok(!packed.files.some(({ path }) => /^(test|scripts|\.github|\.git|node_modules)\//.test(path)));
  const sandbox = join(scratch, "installation");
  run("npm", ["install", "--prefix", sandbox, "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund", "--package-lock=false", "--offline", join(scratch, packed.filename)]);
  const installed = join(sandbox, "node_modules", "pi-voce");
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.equal(manifest.version, JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
  assert.ok(manifest.keywords.includes("pi-package"));
  assert.equal(manifest.license, "BSD-3-Clause");
  for (const entry of manifest.pi.extensions) assert.ok(existsSync(join(installed, entry)));
  console.log(run(process.execPath, [join(root, "scripts", "smoke-installed.mjs"), installed, scratch], {
    env: { ...process.env, PI_CODING_AGENT_DIR: join(scratch, "agent"), PI_VOCE_LOCK_PATH: join(scratch, "audio.lock"), PI_VOCE_STOP_KEY: "escape" },
  }).trim());
  console.log(`Pacchetto ${manifest.name}@${manifest.version}: creazione, installazione offline e caricamento verificati.`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
