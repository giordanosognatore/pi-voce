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

  async function listVoices() {
    const result = await pi.exec("/usr/bin/say", ["-v", "?"], { timeout: 10000 });
    if (result.code !== 0) throw new Error(result.stderr.trim() || `say è terminato con codice ${result.code}`);
    return result.stdout.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*(.+?)\s{2,}([a-z]{2,3}[_-][A-Za-z0-9_-]+)\s*(?:#.*)?$/);
      if (!match) return [];
      const [, name, locale] = match;
      return [{ name, locale, label: `${name} — ${locale}` }];
    });
  }

  pi.registerCommand("voce", {
    description: "Leggi l'ultima risposta; status, config, on, off, stop, elenco [lingua o nome], voce [lingua o nome]",
    getArgumentCompletions: async (prefix) => {
      const subcommands = [
        { value: "status", label: "status", description: "Mostra lo stato" },
        { value: "config", label: "config", description: "Configura lingua, voce e lettura automatica" },
        { value: "on", label: "on", description: "Attiva lettura automatica" },
        { value: "off", label: "off", description: "Disattiva lettura automatica" },
        { value: "stop", label: "stop", description: "Interrompi la lettura" },
        { value: "elenco", label: "elenco [lingua o nome]", description: "Mostra le voci; filtro opzionale, es. it_IT" },
        { value: "voce", label: "voce [lingua o nome]", description: "Scegli lingua e voce oppure specifica lingua o nome" },
      ];
      const match = prefix.match(/^(elenco|voce)\s+(.*)$/i);
      if (match) {
        try {
          const voices = await listVoices();
          const query = match[2];
          const localeAndName = match[1].toLowerCase() === "voce" ? query.match(/^(\S+)\s+(.*)$/) : null;
          if (localeAndName) {
            const [, locale, partialName] = localeAndName;
            const names = [...new Set(voices.filter((item) => item.locale.toLowerCase() === locale.toLowerCase())
              .map((item) => item.name))].sort();
            return names.filter((name) => name.toLowerCase().startsWith(partialName.toLowerCase()))
              .map((name) => ({ value: `${match[1]} ${locale} ${name}`, label: name }));
          }
          const locales = [...new Set(voices.map((item) => item.locale))].sort();
          const matches = locales.filter((value) => value.toLowerCase().startsWith(query.toLowerCase()));
          return matches.map((value) => ({ value: `${match[1]} ${value}`, label: value }));
        } catch {
          return null;
        }
      }
      const matches = subcommands.filter((item) => item.value.startsWith(prefix.toLowerCase()));
      return matches.length ? matches : null;
    },
    handler: async (args, ctx) => {
      const [action, ...rest] = args.trim().split(/\s+/);
      if (!action) {
        const entries = ctx.sessionManager.getBranch();
        const last = [...entries].reverse().find((entry) =>
          entry.type === "message" && entry.message.role === "assistant" &&
          entry.message.stopReason === "stop" && entry.message.content.some((part) => part.type === "text" && part.text.trim()),
        );
        if (last?.type === "message" && last.message.role === "assistant") {
          const text = last.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
          speak(readable(text), ctx);
        } else {
          ctx.ui.notify("Nessuna risposta da leggere nel ramo corrente.", "info");
        }
      } else if (action === "status") {
        ctx.ui.notify(`Lettura automatica ${enabled ? "attiva" : "disattivata"}; voce: ${voice}.`, "info");
      } else if (action === "config") {
        try {
          const voices = await listVoices();
          const locales = [...new Set(voices.map((item) => item.locale))].sort();
          if (!locales.length) {
            ctx.ui.notify("Nessuna voce disponibile.", "warning");
            return;
          }
          const locale = await ctx.ui.select("Scegli lingua e regione (Esc per annullare)", locales);
          if (!locale) return;
          const choices = voices.filter((item) => item.locale === locale);
          const selected = await ctx.ui.select("Scegli una voce (Esc per annullare)", choices.map((item) => item.label));
          const chosen = choices.find((item) => item.label === selected);
          if (!chosen) return;
          const state = await ctx.ui.select("Lettura automatica delle risposte", ["Attiva", "Disattiva"]);
          if (state !== "Attiva" && state !== "Disattiva") return;
          voice = chosen.name;
          enabled = state === "Attiva";
          if (!enabled) stop();
          ctx.ui.notify(`Voce: ${voice}; lettura automatica ${enabled ? "attiva" : "disattivata"}.`, "info");
        } catch (error) {
          ctx.ui.notify(`Impossibile configurare la voce: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      } else if (action === "on") {
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
          const filter = rest.join(" ").toLowerCase();
          const voices = (await listVoices()).filter((item) => `${item.name} ${item.locale}`.toLowerCase().includes(filter));
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
      } else if (action === "voce") {
        try {
          const voices = await listVoices();
          if (!voices.length) {
            ctx.ui.notify("Nessuna voce disponibile.", "warning");
            return;
          }
          const query = rest.join(" ").trim();
          const specifiedLocale = voices.find((item) => item.locale.toLowerCase() === (rest[0] ?? "").toLowerCase())?.locale;
          const requestedName = specifiedLocale && rest.length > 1 ? rest.slice(1).join(" ") : query;
          const direct = voices.find((item) => item.name.toLowerCase() === requestedName.toLowerCase() &&
            (!specifiedLocale || item.locale === specifiedLocale));
          if (direct) {
            voice = direct.name;
            ctx.ui.notify(`Voce impostata: ${voice}.`, "info");
            return;
          }
          const locales = [...new Set(voices.map((item) => item.locale))].sort();
          const locale = query
            ? locales.find((item) => item.toLowerCase() === query.toLowerCase())
            : await ctx.ui.select("Scegli lingua e regione (Esc per annullare)", locales);
          if (!locale) {
            if (query) ctx.ui.notify(`Lingua o voce non trovata: ${query}.`, "warning");
            return;
          }
          const choices = voices.filter((item) => item.locale === locale);
          const selected = await ctx.ui.select("Scegli una voce (Esc per annullare)", choices.map((item) => item.label));
          const chosen = choices.find((item) => item.label === selected);
          if (chosen) {
            voice = chosen.name;
            ctx.ui.notify(`Voce impostata: ${voice}.`, "info");
          }
        } catch (error) {
          ctx.ui.notify(`Impossibile scegliere la voce: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      } else {
        ctx.ui.notify("Comandi: /voce | status | config | on | off | stop | elenco [lingua o nome] | voce [lingua o nome]", "info");
      }
    },
  });
}
