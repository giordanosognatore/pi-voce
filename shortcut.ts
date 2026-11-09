import type { KeyId } from "@earendil-works/pi-tui";

// Standalone Escape, including unmodified Kitty/CSI-u key presses. Do not
// mistake Alt sequences, arrows, bracketed paste or key-release events for Esc.
export function isEscapeInput(data: string): boolean {
  return data === "\x1b" || /^\x1b\[27(?:;1(?::[12])?)?u$/.test(data);
}

export function stopShortcut(value = "escape"): { key?: KeyId; warning?: string } {
  const key = value.trim().toLowerCase().replace(/(^|\+)esc$/, "$1escape");
  if (key === "off") return {};
  // Common named keys plus letters, digits and function keys. Restrict the
  // setting to Pi's key syntax instead of accepting an arbitrary runtime value.
  if (/^(?:(?:ctrl|alt|shift|super)\+)*(?:[a-z0-9]|f(?:[1-9]|1[0-2])|escape|enter|tab|space|backspace|delete|insert|home|end|pageup|pagedown|up|down|left|right)$/.test(key)) {
    return { key: key.replace(/pageup|pagedown/g, (name) => name === "pageup" ? "pageUp" : "pageDown") as KeyId };
  }
  return { key: "escape", warning: "PI_VOCE_STOP_KEY non valido: uso Esc. Usa off per disabilitare la scorciatoia." };
}
