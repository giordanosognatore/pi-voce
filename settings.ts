import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

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
export async function saveSettings(path: string, settings: Settings): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
