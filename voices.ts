export interface Voice { name: string; locale: string; sample: string }

export function parseVoices(output: string): Voice[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(.+?)\s{2,}([a-z]{2,3}[_-][A-Za-z0-9_-]+)\s*(?:#\s*(.*))?$/);
    return match ? [{ name: match[1], locale: match[2], sample: match[3]?.trim() ?? "" }] : [];
  });
}

export function languageLabel(locale: string): string {
  try {
    const language = new Intl.DisplayNames(["it"], { type: "language" }).of(locale.replaceAll("_", "-"));
    return `${language || locale} (${locale})`;
  } catch { return locale; }
}

export function voiceLabel(voice: Voice, current: { voice: string; locale: string }): string {
  return `${voice.name} — ${voice.locale}${voice.name === current.voice && voice.locale === current.locale ? " ✓ attuale" : ""}`;
}

export function resolveVoice(voices: Voice[], preferred: { voice: string; locale: string }): Voice | undefined {
  return voices.find((voice) => voice.name === preferred.voice && voice.locale === preferred.locale)
    ?? voices.find((voice) => voice.locale === preferred.locale)
    ?? voices.find((voice) => voice.locale.split(/[_-]/)[0] === preferred.locale.split(/[_-]/)[0])
    ?? voices[0];
}
