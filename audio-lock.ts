import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

function alive(pid: unknown): boolean {
  if (!Number.isInteger(pid) || (pid as number) <= 0) return false;
  try { process.kill(pid as number, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

export interface AudioLease { setPlayer(pid: number): void; release(): void }

// Publish a NON-EMPTY directory atomically. A contender cannot replace an active
// lease with rename, and stale cleanup cannot remove a new non-empty lease.
export function acquireAudioLock(path: string): AudioLease | undefined {
  mkdirSync(dirname(path), { recursive: true });
  const staging = mkdtempSync(join(dirname(path), ".pi-voce-lock-"));
  const token = `${randomUUID()}.json`;
  const owner = { pid: process.pid, player: 0 };
  writeFileSync(join(staging, token), JSON.stringify(owner), { mode: 0o600 });
  let acquired = false;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { renameSync(staging, path); acquired = true; break; }
      catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code || "")) throw error;
      }
      // Missing, malformed or changing metadata is treated as occupied, never
      // as permission to interrupt another process. Only reap a known dead owner.
      try {
        const files = readdirSync(path);
        if (files.length !== 1 || !files[0].endsWith(".json")) return undefined;
        const previous = JSON.parse(readFileSync(join(path, files[0]), "utf8"));
        if (!Number.isInteger(previous.pid) || previous.pid <= 0 || alive(previous.pid) || alive(previous.player)) return undefined;
        unlinkSync(join(path, files[0]));
        try { rmdirSync(path); }
        catch (error) {
          if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code || "")) throw error;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
      }
    }
    if (!acquired) return undefined;
    let released = false;
    return {
      setPlayer(pid) {
        const temporary = join(dirname(path), `.pi-voce-player-${randomUUID()}`);
        try {
          writeFileSync(temporary, JSON.stringify({ ...owner, player: pid }), { mode: 0o600 });
          renameSync(temporary, join(path, token));
        } finally { try { unlinkSync(temporary); } catch {} }
      },
      release() {
        if (released) return;
        released = true;
        // The unique token prevents a late release from deleting another lease.
        try { unlinkSync(join(path, token)); } catch { return; }
        try { rmdirSync(path); } catch {}
      },
    };
  } finally {
    if (!acquired) {
      try { unlinkSync(join(staging, token)); } catch {}
      try { rmdirSync(staging); } catch {}
    }
  }
}
