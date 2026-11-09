import type { SessionEntry } from "@earendil-works/pi-coding-agent";

const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const clip = (text: string, length: number) => text.length > length ? text.slice(0, length) + "…" : text;
const searchable = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function timeLabel(entry: SessionEntry & { type: "message" }): string {
  const date = new Date(entry.timestamp || entry.message.timestamp);
  if (!Number.isFinite(date.getTime())) return "ora non disponibile";
  return new Intl.DateTimeFormat("it-IT", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}

export function repliesInBranch(entries: readonly SessionEntry[], options: { playingId?: string; filter?: string } = {}) {
  let prompt = "Prompt non disponibile";
  const replies = entries.flatMap((entry, index) => {
    if (entry.type !== "message") return [];
    if (entry.message.role === "user") {
      const content = entry.message.content;
      const text = typeof content === "string" ? content : content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      prompt = clean(text) || "Prompt senza testo (allegati)";
    }
    if (entry.message.role !== "assistant" || entry.message.stopReason !== "stop") return [];
    const text = entry.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    if (!text.trim()) return [];
    return [{ id: entry.id ?? String(index), text, prompt, preview: clean(text), timestamp: timeLabel(entry) }];
  });
  const words = searchable(options.filter || "").split(/\s+/).filter(Boolean);
  return replies.map((reply, index) => ({
    ...reply,
    label: `${index + 1}.${reply.id === options.playingId ? " ▶ in lettura" : ""} [${reply.timestamp}] ${clip(reply.prompt, 55)} → ${clip(reply.preview, 65)}`,
  })).filter((reply) => words.every((word) => searchable(`${reply.prompt} ${reply.text} ${reply.timestamp}`).includes(word))).reverse();
}
