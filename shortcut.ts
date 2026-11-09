import type { KeyId } from "@earendil-works/pi-tui";

export function stopShortcut(value = "ctrl+alt+s"): { key?: KeyId; warning?: string } {
  const key = value.trim().toLowerCase();
  if (key === "off") return {};
  // Common named keys plus letters, digits and function keys. Restrict the
  // setting to Pi's key syntax instead of accepting an arbitrary runtime value.
  if (/^(?:(?:ctrl|alt|shift|super)\+)*(?:[a-z0-9]|f(?:[1-9]|1[0-2])|escape|enter|tab|space|backspace|delete|insert|home|end|pageup|pagedown|up|down|left|right)$/.test(key)) {
    return { key: key.replace(/pageup|pagedown/g, (name) => name === "pageup" ? "pageUp" : "pageDown") as KeyId };
  }
  return { key: "ctrl+alt+s", warning: "PI_VOCE_STOP_KEY non valido: uso ctrl+alt+s. Usa off per disabilitare la scorciatoia." };
}
