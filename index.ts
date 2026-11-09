import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// macOS speech stays local. Settings last for this Pi runtime, not across /reload.
export default function (pi: ExtensionAPI) {
  let enabled = true;
  let voice = "Alice";
  let pending = "";
  let speaker: ChildProcessWithoutNullStreams | undefined;

  function stop() {
    const current = speaker;
    speaker = undefined;
    if (current && !current.killed) current.kill();
  }

  function speak(text: string, ctx: ExtensionContext) {
    stop();
    if (!text.trim()) return;
    const child = spawn("/usr/bin/say", ["-v", voice], { stdio: ["pipe", "pipe", "pipe"] });
    speaker = child;
    let error = "";
    child.stderr.on("data", (data) => { error += String(data).slice(0, 1000); });
    child.stdout.resume();
    child.stdin.on("error", () => {});
    child.on("error", (err) => {
      if (speaker === child) speaker = undefined;
      ctx.ui.notify(`Lettura vocale: ${err.message}`, "error");
    });
    child.on("close", (code, signal) => {
      if (speaker === child) speaker = undefined;
      if (!signal && code !== 0) ctx.ui.notify(`Lettura vocale: ${error.trim() || `say è terminato con codice ${code}`}`, "warning");
    });
    child.stdin.end(text);
  }

  function readable(text: string): string {
    return text
      .replace(/```[^\n]*\n[\s\S]*?```/g, " blocco di codice omesso. ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/[*~]/g, "")
      .trim();
  }

  pi.on("before_agent_start", () => { pending = ""; stop(); });
  pi.on("message_end", (event, ctx) => {
    if (ctx.mode !== "tui" || event.message.role !== "assistant") return;
    const message = event.message;
    // Intermediate tool calls and failed/incomplete responses aren't final answers.
    pending = message.stopReason === "stop"
      ? message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")
      : "";
  });
  pi.on("agent_settled", (event, ctx) => {
    if (ctx.mode === "tui" && enabled && !event.aborted && pending) speak(readable(pending), ctx);
    pending = "";
  });
  pi.on("session_shutdown", () => { pending = ""; stop(); });

  pi.registerCommand("voce", {
    description: "Lettura vocale: on, off, stop, elenco [lingua], voce <nome>",
    handler: async (args, ctx) => {
      const [action, ...rest] = args.trim().split(/\s+/);
      if (action === "on") {
        enabled = true;
        ctx.ui.notify(`Lettura vocale attiva (${voice}).`, "info");
      } else if (action === "off") {
        enabled = false;
        stop();
        ctx.ui.notify("Lettura vocale disattivata per questa sessione.", "info");
      } else if (action === "stop") {
        stop();
        ctx.ui.notify("Lettura interrotta.", "info");
      } else if (action === "elenco") {
        try {
          const result = await pi.exec("/usr/bin/say", ["-v", "?"], { timeout: 10000 });
          if (result.code !== 0) throw new Error(result.stderr.trim() || `say è terminato con codice ${result.code}`);
          const filter = rest.join(" ").toLowerCase();
          const voices = result.stdout.split(/\r?\n/).flatMap((line) => {
            const match = line.match(/^\s*(.+?)\s{2,}([a-z]{2,3}[_-][A-Za-z0-9_-]+)\s*(?:#.*)?$/);
            if (!match) return [];
            const [, name, locale] = match;
            if (filter && !`${name} ${locale}`.toLowerCase().includes(filter)) return [];
            return [{ name, label: `${name} — ${locale}` }];
          });
          if (!voices.length) {
            ctx.ui.notify("Nessuna voce trovata per il filtro indicato.", "warning");
          } else {
            const selected = await ctx.ui.select("Voci disponibili — seleziona una voce (Esc per annullare)", voices.map((item) => item.label));
            const chosen = voices.find((item) => item.label === selected);
            if (chosen) {
              voice = chosen.name;
              ctx.ui.notify(`Voce impostata: ${voice}.`, "info");
            }
          }
        } catch (error) {
          ctx.ui.notify(`Impossibile elencare le voci: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      } else if (action === "voce" && rest.length) {
        voice = rest.join(" ");
        ctx.ui.notify(`Voce impostata: ${voice}.`, "info");
      } else {
        ctx.ui.notify(`Lettura ${enabled ? "attiva" : "disattivata"}; voce: ${voice}. /voce on | off | stop | elenco [lingua] | voce <nome>`, "info");
      }
    },
  });
}
