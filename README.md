# Pi Voce

[![CI](https://github.com/giordanosognatore/pi-voce/actions/workflows/ci.yml/badge.svg)](https://github.com/giordanosognatore/pi-voce/actions/workflows/ci.yml)

Estensione per [Pi](https://pi.dev/) che legge ad alta voce le risposte finali tramite `say` di macOS. Sintesi locale, senza servizi vocali esterni o modelli aggiuntivi.

## Requisiti

- macOS con `/usr/bin/say` e almeno una voce disponibile.
- Pi coding agent con gli eventi `agent_settled` e `message_end`; sviluppo e prove con Pi 1.5.0.
- Un dispositivo di uscita audio funzionante.

Sviluppata su **macOS Monterey 12.7.6, Intel**. Altre configurazioni macOS non sono state verificate. Linux e Windows non sono supportati.

## Installazione da GitHub

```bash
pi install git:github.com/giordanosognatore/pi-voce
```

Per fissare l'installazione alla release 0.5.0:

```bash
pi install git:github.com/giordanosognatore/pi-voce@v0.5.0
```

Un tag resta fisso: per passare a una versione successiva cambia esplicitamente il riferimento. La [pagina delle release](https://github.com/giordanosognatore/pi-voce/releases) contiene note e sorgenti.

In una sessione già aperta esegui `/reload`. Per aggiornare o rimuovere l'installazione non fissata a un tag:

```bash
pi update git:github.com/giordanosognatore/pi-voce
pi remove git:github.com/giordanosognatore/pi-voce
```

Non caricare contemporaneamente una copia manuale e una installata del pacchetto: potrebbero registrare lo stesso comando. Per una prova da una copia locale, dalla directory superiore:

```bash
pi -e ./pi-voce
```

Il pacchetto non è ancora pubblicato su npm.

## Utilizzo

**Al primo utilizzo la lettura automatica è disabilitata.** La voce preferita iniziale è Alice, lingua `it_IT`, velocità 180 parole/minuto. Le preferenze esistenti, incluso l'eventuale automatismo attivo delle versioni precedenti, vengono conservate.

| Comando Pi | Effetto |
| --- | --- |
| `/voce` | Legge l'ultima risposta del ramo corrente, anche con automatismo disattivato |
| `/voce aiuto` | Mostra comandi, esempi e regole di salvataggio e ripresa |
| `/voce riprendi` | Riparte dall'inizio del paragrafo interrotto |
| `/voce risposte [filtro]` | Cerca e sceglie una risposta completa del ramo corrente da ascoltare |
| `/voce status` | Confronta impostazioni correnti e salvate; mostra il percorso delle preferenze |
| `/voce sessione <comando>` | Applica un'impostazione solo alla sessione corrente |
| `/voce salva` | Salva tutte le impostazioni correnti come predefinite |
| `/voce ripristina` | Ricarica le impostazioni salvate, scartando le modifiche temporanee |
| `/voce config` | Configura lingua, voce, velocità, anteprima e lettura automatica |
| `/voce testo` | Sceglie se leggere blocchi di codice, indirizzi web e tabelle |
| `/voce anteprima` | Ascolta una frase di prova con voce e velocità correnti |
| `/voce velocita` | Mostra la velocità corrente |
| `/voce velocita 220` | Salva la velocità in parole/minuto (intero tra 80 e 400) |
| `/voce on` | Attiva e salva la lettura automatica |
| `/voce off` | Disattiva l'automatismo e interrompe la lettura di questa sessione |
| `/voce stop` | Interrompe solo questa sessione, senza modificare le preferenze |
| `/voce elenco` | Mostra le voci e permette di selezionarne una |
| `/voce elenco it_IT` | Filtra l'elenco per lingua o nome; funziona anche con `italiano` o `Federica` |
| `/voce voce` | Sceglie prima la lingua e poi la voce |
| `/voce voce it_IT` | Mostra le voci della lingua indicata |
| `/voce voce it_IT Federica` | Imposta una voce della lingua indicata |
| `/voce voce Federica` | Imposta direttamente una voce per nome |

I selettori mostrano il nome leggibile della lingua (es. **italiano (Italia)**), il codice e l'indicazione **✓ attuale**. Nella completazione, `/voce elenco ` e `/voce voce ` propongono prima le lingue; dopo `/voce voce it_IT ` compaiono solo le voci italiane. Il valore inserito resta il codice, così i comandi sono riproducibili.

In `/voce config` il campo velocità indica la predefinita (180 parole/minuto); Invio senza testo mantiene quella corrente. Puoi ascoltare l'anteprima più volte prima di continuare. Viene usata la frase dimostrativa della voce fornita da macOS, quando disponibile, altrimenti una frase italiana.

**Esc annulla senza modifiche parziali** sia `/voce config` sia `/voce testo`. Le opzioni del testo sono configurate separatamente per non allungare il percorso di selezione della voce.

### Indicatore nel footer

Nella modalità interattiva compare uno stato compatto, per esempio:

```text
Voce: Federica · 180 p/min · auto off · sessione
```

«sessione» indica che le impostazioni correnti differiscono da quelle salvate. Durante la riproduzione appare «lettura in corso» e, per le risposte, «paragrafo 2/5». Dopo lo stop compare «riprendi 2/5» se esiste un punto di ripresa; `/voce status` riporta anche questo avanzamento. Voce e velocità mostrate corrispondono alla riproduzione effettiva, anche per un'anteprima o una voce di ripiego. L'indicatore viene rimosso alla chiusura dell'estensione e non viene visualizzato in modalità RPC/print. La sua visibilità dipende dal footer in uso: un footer personalizzato deve includere gli stati delle estensioni.

### Scorciatoia per fermare la lettura

Dalla versione 0.4.1, **Esc** interrompe la lettura di questa sessione, senza modificare preferenze o testo nell'editor. L'estensione osserva il tasto senza consumarlo: Esc continua anche a interrompere il lavoro di Pi o ad annullare un dialogo, come di consueto. La release 0.4.0 usava invece Ctrl+Alt+S.

`/voce stop` resta sempre disponibile e `/voce status` mostra la combinazione configurata. Altre estensioni, Herdr o il terminale possono intercettare i tasti prima di Pi.

Per cambiarla, avvia Pi con la variabile d'ambiente `PI_VOCE_STOP_KEY`:

```bash
PI_VOCE_STOP_KEY=ctrl+esc pi
```

Puoi anche esportarla nella configurazione della tua shell prima di avviare Pi o i suoi processi figli. Per disabilitarla usa `PI_VOCE_STOP_KEY=off`. Sono accettati lettere, cifre, F1–F12 e tasti nominati comuni, con modificatori `ctrl`, `alt`, `shift`, `super`. Puoi usare `esc` o `escape`, anche con modificatori. Ctrl+Esc richiede un terminale che distingua questa combinazione da Esc semplice. Una combinazione non valida produce un avviso e ripristina Esc. Per cambiare l'ambiente di un Pi già aperto serve riavviarlo: `/reload` da solo non acquisisce nuove variabili dalla shell esterna. Evita combinazioni riservate al sistema o ai tuoi altri strumenti.

### Ripresa dal paragrafo interrotto

Dalla versione 0.5.0 le risposte sono lette per paragrafi, mantenendo il blocco audio per tutta la sequenza. Il punto avanza solo dopo la conclusione corretta del relativo processo `say`, non quando il testo è stato semplicemente inviato al lettore.

```text
/voce
# Premi Esc durante la lettura
/voce riprendi
```

- La ripresa parte **dall'inizio del paragrafo interrotto**, non dalla parola esatta. I paragrafi già conclusi non vengono ripetuti.
- I paragrafi sono separati da righe vuote **dopo la pulizia Markdown**; un semplice a capo non crea un nuovo paragrafo. L'avvio di un processo `say` per paragrafo può introdurre brevi pause tra i blocchi.
- Il testo ripulito rimane quello della lettura originale. Alla ripresa si usano invece **voce e velocità correnti**, con la consueta voce di ripiego se necessario. Le nuove opzioni per codice, URL e tabelle valgono dalla prossima lettura completa.
- Esc, `/voce stop`, `/voce off` e un nuovo prompt fermano il lettore conservando il punto. Una nuova lettura manuale o automatica effettivamente avviata lo sostituisce. Le anteprime non lo sostituiscono e da sole non creano un punto di ripresa.
- Dopo la conclusione completa il punto viene eliminato. Viene eliminato anche con `/tree`, `/reload`, chiusura o sostituzione della sessione. **Non è scritto su disco** e non sopravvive al riavvio.
- Se la risposta non è più nel ramo corrente non viene ripresa. Se un'altra sessione occupa l'audio, la ripresa non si accoda e il punto resta disponibile per un nuovo tentativo.
- Se una lettura è già in corso nella stessa sessione, `/voce riprendi` non la riavvia: fermala prima. `/voce` senza argomenti continua invece a leggere dall'inizio l'ultima risposta.

### Navigazione tra le risposte

`/voce risposte` apre un elenco con le risposte più recenti in alto, numerate in ordine cronologico. Ogni riga mostra **data/ora locale**, un'anteprima dell'**ultimo prompt utente precedente nel ramo** e un'anteprima della risposta. Un prompt con soli allegati viene indicato come tale; se i dati mancano compare un'etichetta di ripiego. La risposta attualmente riprodotta da questa sessione è contrassegnata con **▶ in lettura**, rilevato all'apertura dell'elenco.

La selezione avvia la lettura completa, con le opzioni correnti, senza cambiare ramo o conversazione. Esc annulla. La numerazione resta quella originale anche filtrando:

```text
/voce risposte astronomia
/voce risposte test sicurezza
```

Il filtro cerca nel prompt, nel testo completo della risposta e nella data/ora mostrata, ignorando maiuscole e accenti. Se inserisci più parole devono comparire tutte, anche in punti diversi. Il filtro non modifica la cronologia.

Vengono incluse solo le risposte complete del ramo corrente, anche dopo un ripristino della sessione: non ragionamenti, risultati di strumenti, risposte interrotte o rami abbandonati. La navigazione con `/tree` ferma la lettura del vecchio ramo. `/voce` senza argomenti continua a leggere l'ultima risposta.

### Voce non disponibile

Se la voce preferita manca, per quella lettura Pi Voce cerca nell'ordine:

1. un'altra voce della stessa lingua/regione;
2. una voce della stessa lingua in un'altra regione;
3. la prima voce restituita da macOS.

Mostra un avviso e **non sovrascrive la preferenza salvata**. Usa `/voce config` per modificarla definitivamente. Se il sistema non restituisce nessuna voce, la lettura non viene avviata. L'elenco di `say -v ?` dipende dal Mac; alcune voci elencate potrebbero richiedere un download di macOS o non essere effettivamente riproducibili: in quel caso viene segnalato l'errore di `say`.

## Testo da ascoltare

Valori iniziali:

- **Blocchi di codice: omessi**, con annuncio «Blocco di codice omesso». Gestisce delimitatori a backtick, tilde e codice indentato. I nomi tecnici nel codice inline vengono mantenuti.
- **Indirizzi web: omessi**. Per i link resta il testo descrittivo; gli URL isolati diventano «collegamento omesso».
- **Tabelle: lette** riga per riga con i nomi delle colonne, anziché leggere barre e separatori. Puoi ometterle con un singolo annuncio.

`/voce testo` cambia queste tre preferenze; valgono per la lettura manuale e automatica e vengono salvate insieme alle altre impostazioni. Intestazioni, elenchi, checkbox, formattazione comune, immagini e collegamenti vengono ripuliti. Le emoji vengono rimosse. I comandi vocali incorporati `[[...]]` non vengono eseguiti come istruzioni di `say`.

La conversione è intenzionalmente semplice, **non un parser Markdown completo**: tabelle complesse, annidamenti, LaTeX e codice tecnico possono non essere resi perfettamente. Il testo della risposta originale in Pi non viene modificato. Non vengono generati riassunti o richieste aggiuntive al modello.

## Una lettura alla volta tra sessioni

Le copie aggiornate di Pi Voce, in esecuzione sullo stesso Mac con lo stesso utente, condividono un blocco audio in `~/.pi/pi-voce-audio.lock`, anche se usano directory di configurazione Pi diverse.

- Se un'altra sessione sta leggendo, la richiesta non viene avviata e compare un avviso. **Non viene accodata**: per ascoltare la risposta in seguito, riprova con `/voce`.
- Un nuovo prompt, `/voce stop`, `/voce off` e la chiusura della sessione interrompono solo il lettore posseduto da quella sessione.
- Prima di liberare l'audio si attende la chiusura del processo `say`.
- Se il proprietario è terminato, il blocco viene recuperato alla richiesta successiva, purché non risulti ancora attivo il suo lettore. Metadati non validi sono trattati prudentemente come audio occupato.

Il coordinamento riguarda solo Pi Voce aggiornato, non altri programmi audio o comandi `say` eseguiti separatamente. Per test isolati si può impostare `PI_VOCE_LOCK_PATH` a un percorso diverso: tutte le sessioni che devono coordinarsi devono usare lo stesso percorso. Non cancellare manualmente il blocco mentre una sessione sta leggendo.

## Preferenze persistenti

Voce, lingua/regione, velocità, automatismo e opzioni del testo vengono salvati in `~/.pi/agent/pi-voce.json`. Con `PI_CODING_AGENT_DIR` il file risiede in quella directory. `/voce status` mostra il percorso effettivo.

I comandi esistenti (`/voce on`, `/voce off`, `/voce velocita`, `/voce voce`, `/voce elenco`, `/voce config` e `/voce testo`) continuano a salvare le modifiche. Per cambiare invece solo la sessione corrente, inserisci il prefisso **sessione**:

```text
/voce sessione off
/voce sessione velocita 220
/voce sessione voce Federica
/voce sessione config
/voce sessione testo
```

Queste modifiche non scrivono il file delle preferenze e restano attive durante i prompt e la navigazione nello stesso runtime. Vengono scartate con `/reload`, riavvio, nuova sessione, ripresa o fork che sostituisca il runtime. Non vengono ripristinate quando riapri in seguito la conversazione.

- **`/voce salva`** rende permanenti tutte le impostazioni correnti, incluse quelle temporanee.
- **`/voce ripristina`** ricarica le preferenze dal file senza scriverlo e annulla le modifiche temporanee.
- **`/voce status`** mostra impostazioni correnti e salvate in sezioni multilinea, con un'impostazione per riga e una sezione informativa per differenze, audio condiviso e percorso del file.

Un comando normale salva **solo i campi che modifica**. Ad esempio, dopo `/voce sessione voce Federica`, `/voce velocita 220` salva la velocità ma non Federica: la voce temporanea rimane attiva fino al ripristino, senza diventare il nuovo valore predefinito. `/voce config` salva lingua, voce, velocità e automatismo; `/voce testo` salva soltanto le tre opzioni del testo.

Le altre sessioni già aperte non si aggiornano in tempo reale: usa `/voce ripristina` o `/reload` per adottare i valori salvati altrove. Le anteprime, lo stop, la ripresa e l'aiuto non modificano le preferenze.

Dalla versione 0.5.0, i salvataggi tra copie aggiornate sono serializzati da un blocco accanto al file (`pi-voce.json.lock`). L'intera operazione di **lettura, fusione dei soli campi modificati e sostituzione atomica del file** avviene sotto lo stesso blocco: due sessioni che modificano contemporaneamente campi diversi non si perdono le rispettive modifiche. Se modificano lo stesso campo prevale l'ultimo salvataggio serializzato. `/voce salva` resta una sostituzione esplicita di **tutte** le preferenze con quelle della sessione che lo esegue, comprese le eventuali scelte meno recenti.

Il salvataggio attende al massimo circa cinque secondi se il blocco è occupato, poi segnala di riprovare senza applicare la modifica. Un blocco lasciato da un processo certamente terminato viene recuperato; metadati dubbi o un proprietario ancora vivo non vengono forzati. I file temporanei sono privati (permessi `0600`) e vengono rimossi in caso di errore. Non cancellare il blocco mentre una sessione sta salvando. Tutte le sessioni che scrivono sullo stesso file devono avere il codice aggiornato; le vecchie versioni non rispettano questo blocco.

I file di preferenze della versione 0.2 vengono letti conservando tutti i valori esistenti e aggiungendo i valori iniziali delle opzioni del testo. Un file non valido produce un avviso; un nuovo runtime usa le impostazioni iniziali senza riscrivere il file. `/voce salva` può sostituirlo esplicitamente con tutte le impostazioni correnti.

## Prova manuale in Pi

1. Esegui `/reload` e `/voce status`. Per provare la modalità manuale usa `/voce off` (le preferenze precedenti non vengono sovrascritte automaticamente).
2. Apri `/voce config`: scegli una lingua dal nome leggibile, poi una voce; quella corrente ha il segno ✓. Prova l'anteprima e salva con **Disattiva**.
3. Esegui `/reload` e verifica con `/voce status` che le scelte siano state mantenute.
4. Chiedi a Pi una breve risposta con un elenco, un link, una tabella e un blocco di codice. Esegui `/voce`: dovresti sentire la tabella con intestazioni, senza codice e senza l'URL.
5. Cambia le opzioni con `/voce testo` e ripeti `/voce` per confrontare. Prova anche Esc per controllare che non vengano salvate modifiche parziali.
6. Apri una seconda sessione Pi aggiornata. Avvia una risposta abbastanza lunga con `/voce` nella prima, poi `/voce anteprima` nella seconda: deve comparire «Audio occupato», senza voci sovrapposte.
7. `/voce stop` nella seconda non deve interrompere la prima. Dopo aver fermato la prima, l'anteprima della seconda deve funzionare.
8. Con `/voce on`, invia un breve prompt e verifica la lettura automatica. Con `/voce off` torna alla sola lettura manuale.
9. Prova `/voce risposte`: scegli una risposta precedente e controlla che venga letta quella selezionata.
10. Esegui `/voce sessione velocita 240`: il footer deve mostrare 240 e «sessione» se la velocità salvata è diversa. Con `/voce ripristina` torna al valore salvato.
11. Ripeti la modifica temporanea e usa `/voce salva`, poi `/reload`: questa volta la velocità deve restare 240.
12. Apri `/voce aiuto`: verifica il riepilogo e la scorciatoia effettivamente configurata.
13. Leggi una risposta con almeno tre paragrafi. Premi Esc nel secondo, poi `/voce riprendi`: deve ricominciare il secondo, non il primo. Dopo aver concluso, una nuova ripresa deve indicare che non ci sono letture interrotte.
14. Interrompi di nuovo una risposta, ascolta e ferma un'anteprima, poi usa `/voce riprendi`: deve riprendere la risposta, non la frase dimostrativa.
15. Da due sessioni aggiornate salva contemporaneamente velocità e voce diverse; verifica con `/voce status` che entrambe le modifiche compaiano nella sezione delle preferenze salvate.

## Privacy e limiti

La sintesi è locale; la conversazione può comunque essere inviata al provider configurato in Pi. L'estensione non legge risultati degli strumenti, ragionamenti o risposte interrotte e non esegue letture automatiche nelle modalità non interattive. `/voce` cerca la risposta nel ramo attivo anche dopo `/reload` o il ripristino di una sessione.

Con Herdr, l'audio viene riprodotto sulla macchina che esegue Pi. Non viene inoltrato via SSH al terminale locale.

## Sviluppo e test

```bash
npm test
npm run test:package
npm pack --dry-run --ignore-scripts
```

I test non riproducono audio: simulano `say`, verificano avanzamento, stop e ripresa dei paragrafi, usano directory temporanee e avviano processi Node separati per verificare l'esclusione del blocco audio e i salvataggi concorrenti delle preferenze. Non richiedono dipendenze npm. Serve Node.js 24 o successivo con supporto sperimentale al mocking dei moduli; l'avviso sperimentale è previsto. La riproduzione reale va provata anche in Pi su macOS.

`npm run test:package` crea il tarball, lo installa offline in una directory temporanea (senza scaricare i peer forniti da Pi), controlla manifest e file inclusi, poi carica il pacchetto installato con un loader TypeScript isolato. Verifica registrazione di comandi e scorciatoie, footer e modifiche temporanee senza audio o provider AI; non sostituisce una prova nell'interfaccia di Pi.

Il workflow GitHub Actions esegue test e verifica del pacchetto su **Ubuntu e macOS** con Node.js 24, a ogni push su `main`, tag `v*` e pull request. Questi controlli non provano l'uscita audio o le scorciatoie fisiche sui runner.

## Licenza

[BSD 3-Clause](LICENSE), copyright Giordano Sognatore.
