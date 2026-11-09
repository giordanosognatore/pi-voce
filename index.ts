import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaults, loadSettings, saveSettings, updateSettings, validRate, type Settings } from "./settings.ts";
import { readable, speechParagraphs } from "./text.ts";
import { languageLabel, parseVoices, resolveVoice, voiceLabel, type Voice } from "./voices.ts";
import { SpeechPlayer } from "./playback.ts";
import { repliesInBranch } from "./history.ts";
import { isEscapeInput, stopShortcut } from "./shortcut.ts";
import { helpText } from "./help.ts";

interface Reading { paragraphs: string[]; next: number; replyId?: string }

export default function (pi: ExtensionAPI) {
  let settings = { ...defaults };
  let saved = { ...defaults };
  let uiContext: ExtensionContext | undefined;
  let playingVoice: string | undefined;
  let playingRate: number | undefined;
  let readingReplyId: string | undefined;
  let resumable: Reading | undefined;
  let activeReading: Reading | undefined;
  let unsubscribeInput: (() => void) | undefined;
  const shortcut = stopShortcut(process.env.PI_VOCE_STOP_KEY);
  const mutableCommands = ["on", "off", "velocita", "voce", "elenco", "config", "testo"];
  const isTemporary = () => (Object.keys(defaults) as (keyof Settings)[]).some((key) => settings[key] !== saved[key]);
  function updateFooter() {
    if (uiContext?.mode !== "tui") return;
    const progress = activeReading ? ` · paragrafo ${activeReading.next + 1}/${activeReading.paragraphs.length}`
      : !playingVoice && resumable ? ` · riprendi ${resumable.next + 1}/${resumable.paragraphs.length}` : "";
    const text = `Voce: ${playingVoice || settings.voice} · ${playingRate ?? settings.rate} p/min · auto ${settings.enabled ? "on" : "off"}${isTemporary() ? " · sessione" : ""}${playingVoice ? " · lettura in corso" : ""}${progress}`;
    uiContext.ui.setStatus("pi-voce", uiContext.ui.theme.fg("dim", text));
  }
  let pending = "";
  let request = 0;
  const configPath = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "pi-voce.json");
  // Shared by this user's sessions, including sessions with different agent dirs.
  const lockPath = process.env.PI_VOCE_LOCK_PATH || join(homedir(), ".pi", "pi-voce-audio.lock");
  const player = new SpeechPlayer(lockPath, (voice, rate) => {
    playingVoice = voice; playingRate = rate;
    if (!voice) { readingReplyId = undefined; activeReading = undefined; }
    updateFooter();
  });

  async function stop() {
    const ticket = ++request;
    await player.stop();
    if (ticket !== request) return;
    readingReplyId = undefined;
    activeReading = undefined;
    updateFooter();
  }
  // Escape is already Pi's interrupt/cancel key. Observe it without consuming
  // the event, rather than competing with Pi's reserved shortcut handling.
  if (shortcut.key && shortcut.key !== "escape") pi.registerShortcut(shortcut.key, {
    description: "Pi Voce: interrompi la lettura di questa sessione",
    handler: async (ctx) => { uiContext = ctx; await stop(); },
  });
  async function apply(patch: Partial<Settings>, temporary = false) {
    if (!temporary) {
      // Persist only the requested fields: unrelated temporary overrides stay local.
      saved = await updateSettings(configPath, patch);
    }
    settings = { ...settings, ...patch };
    await stop();
    updateFooter();
  }
  async function listVoices() {
    const result = await pi.exec("/usr/bin/say", ["-v", "?"], { timeout: 10000 });
    if (result.code !== 0) throw new Error(result.stderr.trim() || `say è terminato con codice ${result.code}`);
    return parseVoices(result.stdout);
  }
  async function speak(text: string | undefined, ctx: ExtensionContext, preferred = settings, replyId?: string, resume?: Reading) {
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
      const paragraphs = resume ? resume.paragraphs.slice(resume.next) : speechParagraphs(
        text === undefined ? chosen.sample || "Questa è una prova della voce selezionata." : readable(text, preferred),
      );
      if (!paragraphs.length) { ctx.ui.notify("Nessun testo da leggere.", "info"); return; }
      const reading = resume ?? (text === undefined ? undefined : { paragraphs, next: 0, replyId });
      const offset = resume?.next ?? 0;
      const started = await player.play(paragraphs, chosen.name, preferred.rate, (message) => ctx.ui.notify(message, "warning"), reading ? (completed) => {
        if (ticket !== request) return;
        reading.next = offset + completed;
        resumable = reading.next < reading.paragraphs.length ? reading : undefined;
        activeReading = resumable;
        readingReplyId = resumable?.replyId;
        updateFooter();
      } : undefined);
      if (!started && ticket === request) readingReplyId = undefined;
    } catch (error) {
      if (ticket !== request) return;
      readingReplyId = undefined;
      ctx.ui.notify(`Lettura vocale: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    uiContext = ctx;
    unsubscribeInput?.();
    unsubscribeInput = undefined;
    if (ctx.mode === "tui" && shortcut.key === "escape") {
      unsubscribeInput = ctx.ui.onTerminalInput((data) => {
        if (isEscapeInput(data)) void stop().catch((error) => {
          ctx.ui.notify(`Impossibile fermare la lettura: ${error instanceof Error ? error.message : String(error)}`, "error");
        });
        return undefined; // Preserve Pi's own Escape behavior, including dialogs.
      });
    }
    if (shortcut.warning) ctx.ui.notify(shortcut.warning, "warning");
    try { settings = await loadSettings(configPath); saved = { ...settings }; }
    catch (error) { ctx.ui.notify(`Preferenze vocali non caricate: ${error instanceof Error ? error.message : String(error)}`, "warning"); }
    updateFooter();
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
    if (ctx.mode === "tui" && settings.enabled && !event.aborted && text) {
      const last = repliesInBranch(ctx.sessionManager.getBranch())[0];
      await speak(text, ctx, settings, last?.text === text ? last.id : undefined);
    }
  });
  pi.on("session_tree", async () => { pending = ""; resumable = undefined; await stop(); });
  pi.on("session_shutdown", async () => {
    unsubscribeInput?.();
    unsubscribeInput = undefined;
    pending = "";
    resumable = undefined;
    await stop();
    if (uiContext?.mode === "tui") uiContext.ui.setStatus("pi-voce", undefined);
    uiContext = undefined;
  });

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
  async function configureText(ctx: ExtensionContext, temporary: boolean) {
    const next = { readCode: settings.readCode, readUrls: settings.readUrls, readTables: settings.readTables };
    for (const [key, title] of [["readCode", "Blocchi di codice"], ["readUrls", "Indirizzi web"], ["readTables", "Tabelle"]] as const) {
      const selected = await ctx.ui.select(`${title} (attuale: ${next[key] ? "leggi" : "ometti"})`, ["Leggi", "Ometti"]);
      if (selected !== "Leggi" && selected !== "Ometti") return;
      next[key] = selected === "Leggi";
    }
    await apply(next, temporary);
    ctx.ui.notify(temporary ? "Preferenze del testo applicate solo a questa sessione." : "Preferenze del testo salvate.", "info");
  }

  pi.registerCommand("voce", {
    description: "Leggi l'ultima risposta; aiuto, riprendi, risposte, status, config, sessione <comando>, salva, ripristina, testo, on, off, stop, anteprima, velocita [80–400], elenco [lingua o nome], voce [lingua o nome]",
    getArgumentCompletions: async (prefix) => {
      const scope = prefix.startsWith("sessione ") ? "sessione " : "";
      if (scope) prefix = prefix.slice(scope.length);
      const subcommands = [
        { value: "aiuto", label: "aiuto", description: "Riepilogo dei comandi con esempi e regole di salvataggio e ripresa" },
        { value: "riprendi", label: "riprendi", description: "Riparti dall'inizio del paragrafo interrotto" },
        { value: "risposte", label: "risposte [filtro]", description: "Cerca per prompt, risposta o data e scegli cosa ascoltare" },
        { value: "sessione", label: "sessione <comando>", description: "Modifica temporanea, senza salvare" },
        { value: "salva", label: "salva", description: "Salva tutte le impostazioni correnti come predefinite" },
        { value: "ripristina", label: "ripristina", description: "Ricarica le preferenze salvate e scarta le modifiche temporanee" },
        { value: "status", label: "status", description: "Mostra impostazioni correnti e salvate" },
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
              .map((item) => ({ value: `${scope}${match[1]} ${locale} ${item.name}`, label: item.name, description: item.name === settings.voice && item.locale === settings.locale ? "Voce attuale" : "" }));
          }
          return [...new Set(voices.map((item) => item.locale))].sort()
            .filter((locale) => `${locale} ${languageLabel(locale)}`.toLowerCase().includes(query.toLowerCase()))
            .map((locale) => ({ value: `${scope}${match[1]} ${locale}`, label: languageLabel(locale) }));
        } catch { return null; }
      }
      const matches = subcommands.filter((item) => (!scope || mutableCommands.includes(item.value)) && item.value.startsWith(prefix.toLowerCase()))
        .map((item) => ({ ...item, value: scope + item.value }));
      return matches.length ? matches : null;
    },
    handler: async (args, ctx) => {
      try {
        uiContext = ctx;
        updateFooter();
        let [action, ...rest] = args.trim().split(/\s+/);
        const temporary = action === "sessione";
        if (temporary) {
          [action, ...rest] = rest;
          if (!mutableCommands.includes(action)) {
            ctx.ui.notify("Uso: /voce sessione on | off | velocita <numero> | voce [lingua o nome] | elenco [filtro] | config | testo", "info");
            return;
          }
        }
        if (!action) {
          const last = repliesInBranch(ctx.sessionManager.getBranch())[0];
          if (last) await speak(last.text, ctx, settings, last.id);
          else ctx.ui.notify("Nessuna risposta da leggere nel ramo corrente.", "info");
        } else if (action === "aiuto") {
          ctx.ui.notify(helpText(shortcut.key), "info");
        } else if (action === "riprendi") {
          if (playingVoice) { ctx.ui.notify("Una lettura è già in corso in questa sessione. Usa Esc o /voce stop prima di riprendere.", "info"); return; }
          const reading = resumable;
          if (!reading) { ctx.ui.notify("Nessuna lettura da riprendere in questa sessione.", "info"); return; }
          if (reading.replyId && !repliesInBranch(ctx.sessionManager.getBranch()).some((reply) => reply.id === reading.replyId)) {
            resumable = undefined;
            updateFooter();
            ctx.ui.notify("La risposta interrotta non è più nel ramo corrente.", "warning");
            return;
          }
          await speak(undefined, ctx, settings, undefined, reading);
        } else if (action === "risposte") {
          const filter = rest.join(" ");
          const replies = repliesInBranch(ctx.sessionManager.getBranch(), { filter, playingId: readingReplyId });
          if (!replies.length) { ctx.ui.notify(filter ? "Nessuna risposta corrisponde al filtro nel ramo corrente." : "Nessuna risposta da leggere nel ramo corrente.", "info"); return; }
          const selected = await ctx.ui.select(`Scegli una risposta da ascoltare (più recenti in alto)${filter ? ` — filtro: ${filter}` : ""}`, replies.map((reply) => reply.label));
          const chosen = replies.find((reply) => reply.label === selected);
          if (!chosen) return;
          const current = repliesInBranch(ctx.sessionManager.getBranch()).find((reply) => reply.id === chosen.id);
          if (current) await speak(current.text, ctx, settings, current.id);
          else ctx.ui.notify("La risposta selezionata non è più nel ramo corrente.", "warning");
        } else if (action === "salva") {
          await saveSettings(configPath, settings);
          saved = { ...settings };
          await stop();
          updateFooter();
          ctx.ui.notify("Tutte le impostazioni correnti sono state salvate come predefinite.", "info");
        } else if (action === "ripristina") {
          const restored = await loadSettings(configPath);
          await stop();
          settings = restored;
          saved = { ...restored };
          updateFooter();
          ctx.ui.notify("Preferenze salvate ripristinate; modifiche temporanee scartate.", "info");
        } else if (action === "status") {
          saved = await loadSettings(configPath);
          updateFooter();
          const section = (title: string, values: Settings) => [
            title,
            `  Lettura automatica: ${values.enabled ? "attiva" : "disattivata"}`,
            `  Voce: ${values.voice}`,
            `  Lingua: ${languageLabel(values.locale)}`,
            `  Velocità: ${values.rate} parole/minuto`,
            `  Codice: ${values.readCode ? "leggi" : "ometti"}`,
            `  URL: ${values.readUrls ? "leggi" : "ometti"}`,
            `  Tabelle: ${values.readTables ? "leggi" : "ometti"}`,
          ].join("\n");
          ctx.ui.notify([
            section("SESSIONE CORRENTE", settings),
            section("PREDEFINITE SALVATE", saved),
            [
              "INFORMAZIONI",
              `  Modifiche rispetto alle salvate: ${isTemporary() ? "sì (solo sessione)" : "nessuna"}`,
              "  Audio condiviso: una lettura alla volta",
              `  Scorciatoia stop: ${shortcut.key || "disabilitata"}`,
              `  Ripresa: ${resumable ? `paragrafo ${resumable.next + 1} di ${resumable.paragraphs.length} (solo in memoria)` : "nessuna lettura interrotta"}`,
              `  File preferenze:\n    ${configPath}`,
            ].join("\n"),
          ].join("\n\n"), "info");
        } else if (action === "anteprima") {
          await speak(undefined, ctx);
        } else if (action === "testo") {
          await configureText(ctx, temporary);
        } else if (action === "velocita") {
          if (!rest.length) { ctx.ui.notify(`Velocità: ${settings.rate} parole/minuto.`, "info"); return; }
          const rate = Number(rest.join(" "));
          if (!validRate(rate)) { ctx.ui.notify("Specifica un numero intero tra 80 e 400 parole/minuto.", "warning"); return; }
          await apply({ rate }, temporary);
          ctx.ui.notify(`Velocità ${temporary ? "per questa sessione" : "salvata"}: ${settings.rate} parole/minuto.`, "info");
        } else if (action === "on" || action === "off") {
          if (action === "off") await stop();
          await apply({ enabled: action === "on" }, temporary);
          ctx.ui.notify(`Lettura automatica ${settings.enabled ? "attiva" : "disattivata"}; ${temporary ? "solo per questa sessione" : "preferenza salvata"}.`, "info");
        } else if (action === "stop") {
          await stop();
          ctx.ui.notify(`Lettura interrotta in questa sessione.${resumable ? ` /voce riprendi dal paragrafo ${resumable.next + 1} di ${resumable.paragraphs.length}.` : ""}`, "info");
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
          await apply({ voice: chosen.name, locale, rate, enabled: state === "Attiva" }, temporary);
          ctx.ui.notify(`Preferenze ${temporary ? "per questa sessione" : "salvate"}: ${settings.voice}, ${settings.rate} parole/minuto; lettura automatica ${settings.enabled ? "attiva" : "disattivata"}.`, "info");
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
            await apply({ voice: chosen.name, locale: chosen.locale }, temporary);
            ctx.ui.notify(`Voce impostata: ${settings.voice}${temporary ? " (solo questa sessione)" : ""}.`, "info");
          }
        } else {
          ctx.ui.notify("Comando non riconosciuto. Usa /voce aiuto per comandi, esempi e regole di salvataggio.", "info");
        }
      } catch (error) {
        ctx.ui.notify(`Operazione vocale non riuscita: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
}
