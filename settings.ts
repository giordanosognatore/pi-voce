import { mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { acquireAudioLock } from "./audio-lock.ts";

export interface Settings {
  enabled: boolean;
  voice: string;
  locale: string;
  rate: number;
  readCode: boolean;
  readUrls: boolean;
  readTables: boolean;
}
export const defaults: Settings = {
  enabled: false, voice: "Alice", locale: "it_IT", rate: 180,
  readCode: false, readUrls: false, readTables: true,
};
export function validRate(rate: number): boolean {
  return Number.isInteger(rate) && rate >= 80 && rate <= 400;
}
export async function loadSettings(path: string): Promise<Settings> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaults };
    throw error;
  }
  const value = JSON.parse(raw);
  if (!value || typeof value.enabled !== "boolean" || typeof value.voice !== "string" || !value.voice.trim() ||
    typeof value.locale !== "string" || !value.locale.trim() || !validRate(value.rate)) {
    throw new Error("Formato delle preferenze non valido");
  }
  // Version 0.2 preferences lack text options: preserve all existing choices.
  for (const key of ["readCode", "readUrls", "readTables"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") throw new Error("Formato delle preferenze non valido");
  }
  return {
    enabled: value.enabled, voice: value.voice, locale: value.locale, rate: value.rate,
    readCode: value.readCode ?? defaults.readCode,
    readUrls: value.readUrls ?? defaults.readUrls,
    readTables: value.readTables ?? defaults.readTables,
  };
}
// The same atomic, dead-owner-recoverable lease protocol also protects settings.
// Unlike audio requests, saves wait briefly: the lock covers read + merge + rename,
// not merely the final write. Resolve directory aliases to share the same lock.
async function withSettingsLock<T>(path: string, operation: (target: string) => Promise<T>, timeoutMs: number): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const target = join(await realpath(dirname(path)), basename(path));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const lease = acquireAudioLock(`${target}.lock`);
    if (lease) {
      try { return await operation(target); }
      finally { lease.release(); }
    }
    if (Date.now() >= deadline) throw new Error("Preferenze occupate da un'altra sessione; riprova tra poco.");
    await delay(20);
  }
}

async function atomicSave(path: string, settings: Settings): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

// Explicit full replacement (/voce salva): the last serialized snapshot wins.
export async function saveSettings(path: string, settings: Settings): Promise<void> {
  await withSettingsLock(path, (target) => atomicSave(target, settings), 5000);
}

// Ordinary commands merge only their fields with the freshest saved preferences.
export async function updateSettings(path: string, patch: Partial<Settings>, options: { timeoutMs?: number } = {}): Promise<Settings> {
  return withSettingsLock(path, async (target) => {
    const next = { ...await loadSettings(target), ...patch };
    await atomicSave(target, next);
    return next;
  }, options.timeoutMs ?? 5000);
}
