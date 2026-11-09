import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface Settings {
  enabled: boolean;
  voice: string;
  locale: string;
  rate: number;
}
export const defaults: Settings = { enabled: true, voice: "Alice", locale: "it_IT", rate: 180 };
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
  return { enabled: value.enabled, voice: value.voice, locale: value.locale, rate: value.rate };
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
