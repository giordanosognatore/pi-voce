import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaults, loadSettings, saveSettings, validRate, type Settings } from "./settings.ts";
import { readable } from "./text.ts";
import { languageLabel, parseVoices, resolveVoice, voiceLabel, type Voice } from "./voices.ts";
import { SpeechPlayer } from "./playback.ts";

export default function (pi: ExtensionAPI) {
  let settings = { ...defaults };
  let pending = "";
  let request = 0;
  const configPath = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "pi-voce.json");
  // Shared by this user's sessions, including sessions with different agent dirs.
  const lockPath = process.env.PI_VOCE_LOCK_PATH || join(homedir(), ".pi", "pi-voce-audio.lock");
  const player = new SpeechPlayer(lockPath);

  async function stop() { request++; await player.stop(); }
  async function apply(next: Settings) {
    await saveSettings(configPath, next);
    settings = next;
    await stop();
  }
  async function listVoices() {
    const result = await pi.exec("/usr/bin/say", ["-v", "?"], { timeout: 10000 });
    if (result.code !== 0) throw new Error(result.stderr.trim() || `say è terminato con codice ${result.code}`);
    return parseVoices(result.stdout);
  }
  async function speak(text: string | undefined, ctx: ExtensionContext, preferred = settings) {
    const ticket = ++request;
    await player.stop();
    try {
      const voices = await listVoices();
      if (ticket !== request) return;
      const chosen = resolveVoice(voices, preferred);
      if (!chosen) { ctx.ui.notify("Nessuna voce disponibile: impossibile leggere.", "warning"); return; }
      if (chosen.name !== preferred.voice || chosen.locale !== preferred.locale) {
        ctx.ui.notify(`Voce ${preferred.voice} (${preferred.locale}) non disponibile: uso ${chosen.name} (${chosen.locale}) per questa lettura. Preferenza salvata invariata; usa /voce config per cambiarla.`, "warning");
      }
      const speech = text === undefined ? chosen.sample || "Questa è una prova della voce selezionata." : readable(text, preferred);
      if (!speech.trim()) { ctx.ui.notify("Nessun testo da leggere.", "info"); return; }
      await player.play(speech, chosen.name, preferred.rate, (message) => ctx.ui.notify(message, "warning"));
    } catch (error) {
      ctx.ui.notify(`Lettura vocale: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    try { settings = await loadSettings(configPath); }
    catch (error) { ctx.ui.notify(`Preferenze vocali non caricate: ${error instanceof Error ? error.message : String(error)}`, "warning"); }
  });
  pi.on("before_agent_start", async () => { pending = ""; await stop(); });
  pi.on("message_end", (event, ctx) => {
    if (ctx.mode !== "tui" || event.message.role !== "assistant") return;
    const message = event.message;
    pending = message.stopReason === "stop"
      ? message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : "";
  });
  pi.on("agent_settled", async (event, ctx) => {
    const text = pending;
    pending = "";
    if (ctx.mode === "tui" && settings.enabled && !event.aborted && text) await speak(text, ctx);
  });
  pi.on("session_shutdown", async () => { pending = ""; await stop(); });

  async function chooseLocale(ctx: ExtensionContext, voices: Voice[]) {
    const locales = [...new Set(voices.map((item) => item.locale))].sort();
    const label = (locale: string) => `${languageLabel(locale)}${locale === settings.locale ? " ✓ attuale" : ""}`;
    const selected = await ctx.ui.select("Scegli lingua e regione (Esc per annullare)", locales.map(label));
    return locales.find((locale) => label(locale) === selected);
  }
  async function chooseVoice(ctx: ExtensionContext, voices: Voice[]) {
    const selected = await ctx.ui.select("Scegli una voce (Esc per annullare)", voices.map((item) => voiceLabel(item, settings)));
    return voices.find((item) => voiceLabel(item, settings) === selected);
  }
  async function configureText(ctx: ExtensionContext) {
    const next = { ...settings };
    for (const [key, title] of [["readCode", "Blocchi di codice"], ["readUrls", "Indirizzi web"], ["readTables", "Tabelle"]] as const) {
      const selected = await ctx.ui.select(`${title} (attuale: ${next[key] ? "leggi" : "ometti"})`, ["Leggi", "Ometti"]);
      if (selected !== "Leggi" && selected !== "Ometti") return;
      next[key] = selected === "Leggi";
    }
    await apply(next);
    ctx.ui.notify("Preferenze del testo salvate.", "info");
  }

  pi.registerCommand("voce", {
    description: "Leggi l'ultima risposta; status, config, testo, on, off, stop, anteprima, velocita [80–400], elenco [lingua o nome], voce [lingua o nome]",
    getArgumentCompletions: async (prefix) => {
      const subcommands = [
        { value: "status", label: "status", description: "Mostra lo stato" },
        { value: "config", label: "config", description: "Configura lingua, voce, velocità e lettura automatica" },
        { value: "testo", label: "testo", description: "Scegli se leggere codice, URL e tabelle" },
        { value: "anteprima", label: "anteprima", description: "Ascolta una frase di prova" },
        { value: "velocita", label: "velocita [80–400]", description: "Imposta parole al minuto oppure mostra la velocità" },
        { value: "on", label: "on", description: "Attiva lettura automatica" },
        { value: "off", label: "off", description: "Disattiva lettura automatica" },
        { value: "stop", label: "stop", description: "Interrompi solo questa sessione" },
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
            return voices.filter((item) => item.locale.toLowerCase() === locale.toLowerCase() && item.name.toLowerCase().startsWith(partialName.toLowerCase()))
              .map((item) => ({ value: `${match[1]} ${locale} ${item.name}`, label: item.name, description: item.name === settings.voice && item.locale === settings.locale ? "Voce attuale" : "" }));
          }
          return [...new Set(voices.map((item) => item.locale))].sort()
            .filter((locale) => `${locale} ${languageLabel(locale)}`.toLowerCase().includes(query.toLowerCase()))
            .map((locale) => ({ value: `${match[1]} ${locale}`, label: languageLabel(locale) }));
        } catch { return null; }
      }
      const matches = subcommands.filter((item) => item.value.startsWith(prefix.toLowerCase()));
      return matches.length ? matches : null;
    },
    handler: async (args, ctx) => {
      try {
        const [action, ...rest] = args.trim().split(/\s+/);
        if (!action) {
          const last = [...ctx.sessionManager.getBranch()].reverse().find((entry) => entry.type === "message" &&
            entry.message.role === "assistant" && entry.message.stopReason === "stop" &&
            entry.message.content.some((part) => part.type === "text" && part.text.trim()));
          if (last?.type === "message" && last.message.role === "assistant") {
            await speak(last.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"), ctx);
          } else ctx.ui.notify("Nessuna risposta da leggere nel ramo corrente.", "info");
        } else if (action === "status") {
          ctx.ui.notify(`Lettura automatica ${settings.enabled ? "attiva" : "disattivata"}; voce: ${settings.voice}; lingua: ${languageLabel(settings.locale)}; velocità: ${settings.rate} parole/minuto. Codice: ${settings.readCode ? "leggi" : "ometti"}; URL: ${settings.readUrls ? "leggi" : "ometti"}; tabelle: ${settings.readTables ? "leggi" : "ometti"}. Audio condiviso: una lettura alla volta. Preferenze: ${configPath}`, "info");
        } else if (action === "anteprima") {
          await speak(undefined, ctx);
        } else if (action === "testo") {
          await configureText(ctx);
        } else if (action === "velocita") {
          if (!rest.length) { ctx.ui.notify(`Velocità: ${settings.rate} parole/minuto.`, "info"); return; }
          const rate = Number(rest.join(" "));
          if (!validRate(rate)) { ctx.ui.notify("Specifica un numero intero tra 80 e 400 parole/minuto.", "warning"); return; }
          await apply({ ...settings, rate });
          ctx.ui.notify(`Velocità salvata: ${settings.rate} parole/minuto.`, "info");
        } else if (action === "on" || action === "off") {
          if (action === "off") await stop();
          await apply({ ...settings, enabled: action === "on" });
          ctx.ui.notify(`Lettura automatica ${settings.enabled ? "attiva" : "disattivata"}; preferenza salvata.`, "info");
        } else if (action === "stop") {
          await stop();
          ctx.ui.notify("Lettura interrotta in questa sessione.", "info");
        } else if (action === "config") {
          const voices = await listVoices();
          if (!voices.length) { ctx.ui.notify("Nessuna voce disponibile.", "warning"); return; }
          const locale = await chooseLocale(ctx, voices);
          if (!locale) return;
          const chosen = await chooseVoice(ctx, voices.filter((item) => item.locale === locale));
          if (!chosen) return;
          const speed = await ctx.ui.input(`Velocità in parole/minuto (80–400; predefinita: ${defaults.rate}; Invio senza testo: ${settings.rate})`, String(settings.rate));
          if (speed === undefined) return;
          const rate = speed.trim() === "" ? settings.rate : Number(speed);
          if (!validRate(rate)) { ctx.ui.notify("Velocità non valida: usa un intero tra 80 e 400. Nessuna modifica applicata.", "warning"); return; }
          try {
            let next = await ctx.ui.select("Ascolta un'anteprima prima di continuare", ["Ascolta anteprima", "Continua"]);
            while (next === "Ascolta anteprima") {
              await speak(undefined, ctx, { ...settings, voice: chosen.name, locale, rate });
              next = await ctx.ui.select("Anteprima (Esc per annullare)", ["Ascolta anteprima", "Continua"]);
            }
            if (next !== "Continua") return;
          } finally { await stop(); }
          const state = await ctx.ui.select(`Lettura automatica delle risposte (attuale: ${settings.enabled ? "attiva" : "disattivata"}; predefinita: disattivata)`, ["Disattiva", "Attiva"]);
          if (state !== "Attiva" && state !== "Disattiva") return;
          await apply({ ...settings, voice: chosen.name, locale, rate, enabled: state === "Attiva" });
          ctx.ui.notify(`Preferenze salvate: ${settings.voice}, ${settings.rate} parole/minuto; lettura automatica ${settings.enabled ? "attiva" : "disattivata"}.`, "info");
        } else if (action === "elenco" || action === "voce") {
          const voices = await listVoices();
          if (!voices.length) { ctx.ui.notify("Nessuna voce disponibile.", "warning"); return; }
          const query = rest.join(" ").trim();
          let chosen: Voice | undefined;
          if (action === "elenco") {
            const choices = voices.filter((item) => `${item.name} ${item.locale} ${languageLabel(item.locale)}`.toLowerCase().includes(query.toLowerCase()));
            if (!choices.length) { ctx.ui.notify("Nessuna voce trovata per il filtro indicato.", "warning"); return; }
            chosen = await chooseVoice(ctx, choices);
          } else {
            const specifiedLocale = voices.find((item) => item.locale.toLowerCase() === (rest[0] ?? "").toLowerCase())?.locale;
            const name = specifiedLocale && rest.length > 1 ? rest.slice(1).join(" ") : query;
            chosen = voices.find((item) => item.name.toLowerCase() === name.toLowerCase() && (!specifiedLocale || item.locale === specifiedLocale));
            if (!chosen) {
              const locale = query ? voices.find((item) => item.locale.toLowerCase() === query.toLowerCase())?.locale : await chooseLocale(ctx, voices);
              if (!locale) {
                if (query) ctx.ui.notify(`Lingua o voce non trovata: ${query}.`, "warning");
                return;
              }
              chosen = await chooseVoice(ctx, voices.filter((item) => item.locale === locale));
            }
          }
          if (chosen) {
            await apply({ ...settings, voice: chosen.name, locale: chosen.locale });
            ctx.ui.notify(`Voce impostata: ${settings.voice}.`, "info");
          }
        } else {
          ctx.ui.notify("Comandi: /voce | status | config | testo | on | off | stop | anteprima | velocita [80–400] | elenco [lingua o nome] | voce [lingua o nome]", "info");
        }
      } catch (error) {
        ctx.ui.notify(`Operazione vocale non riuscita: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
}
