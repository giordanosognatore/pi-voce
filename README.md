# Pi Voce

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

In una sessione già aperta esegui `/reload`. Per aggiornare o rimuovere:

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
| `/voce status` | Mostra voce, lingua, velocità, automatismo, opzioni del testo e percorso delle preferenze |
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

Le modifiche valgono subito nella sessione corrente e sono ripristinate al riavvio o con `/reload`. Le altre sessioni già aperte non si aggiornano in tempo reale; se più sessioni salvano, prevale l'ultimo salvataggio. Le anteprime e `/voce stop` non modificano le preferenze.

I file di preferenze della versione 0.2 vengono letti conservando tutti i valori esistenti e aggiungendo i valori iniziali delle opzioni del testo. Un file non valido produce un avviso; un nuovo runtime usa le impostazioni iniziali e non riscrive il file finché non salvi nuove scelte.

## Prova manuale in Pi

1. Esegui `/reload` e `/voce status`. Per provare la modalità manuale usa `/voce off` (le preferenze precedenti non vengono sovrascritte automaticamente).
2. Apri `/voce config`: scegli una lingua dal nome leggibile, poi una voce; quella corrente ha il segno ✓. Prova l'anteprima e salva con **Disattiva**.
3. Esegui `/reload` e verifica con `/voce status` che le scelte siano state mantenute.
4. Chiedi a Pi una breve risposta con un elenco, un link, una tabella e un blocco di codice. Esegui `/voce`: dovresti sentire la tabella con intestazioni, senza codice e senza l'URL.
5. Cambia le opzioni con `/voce testo` e ripeti `/voce` per confrontare. Prova anche Esc per controllare che non vengano salvate modifiche parziali.
6. Apri una seconda sessione Pi aggiornata. Avvia una risposta abbastanza lunga con `/voce` nella prima, poi `/voce anteprima` nella seconda: deve comparire «Audio occupato», senza voci sovrapposte.
7. `/voce stop` nella seconda non deve interrompere la prima. Dopo aver fermato la prima, l'anteprima della seconda deve funzionare.
8. Con `/voce on`, invia un breve prompt e verifica la lettura automatica. Con `/voce off` torna alla sola lettura manuale.

## Privacy e limiti

La sintesi è locale; la conversazione può comunque essere inviata al provider configurato in Pi. L'estensione non legge risultati degli strumenti, ragionamenti o risposte interrotte e non esegue letture automatiche nelle modalità non interattive. `/voce` cerca la risposta nel ramo attivo anche dopo `/reload` o il ripristino di una sessione.

Con Herdr, l'audio viene riprodotto sulla macchina che esegue Pi. Non viene inoltrato via SSH al terminale locale.

## Sviluppo e test

```bash
npm test
npm pack --dry-run --ignore-scripts
```

I test non riproducono audio: simulano `say`, usano directory temporanee e avviano processi Node separati per verificare l'esclusione del blocco audio. Non richiedono dipendenze npm. Serve Node.js 24 o successivo con supporto sperimentale al mocking dei moduli; l'avviso sperimentale è previsto. La riproduzione reale va provata anche in Pi su macOS.

## Licenza

[BSD 3-Clause](LICENSE), copyright Giordano Sognatore.
