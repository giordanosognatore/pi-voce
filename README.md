# Pi Voce

Estensione per [Pi](https://pi.dev/) che legge ad alta voce le risposte finali tramite il comando `say` di macOS. La sintesi avviene sul Mac, senza servizi vocali esterni o modelli aggiuntivi.

## Requisiti

- macOS con `/usr/bin/say` e almeno una voce disponibile.
- Pi coding agent con supporto agli eventi `agent_settled` e `message_end`; provato con Pi 1.5.0.
- Un dispositivo di uscita audio funzionante.

Sviluppata su **macOS Monterey 12.7.6, Intel**. Altre configurazioni macOS non sono state verificate. L'estensione non supporta Linux o Windows: usa il comando `say` di macOS.

## Installazione da GitHub

```bash
pi install git:github.com/giordanosognatore/pi-voce
```

In una sessione Pi già aperta esegui `/reload`. Per aggiornare o rimuovere:

```bash
pi update git:github.com/giordanosognatore/pi-voce
pi remove git:github.com/giordanosognatore/pi-voce
```

Non installare contemporaneamente una copia manuale della stessa estensione: le due copie potrebbero registrare lo stesso comando e leggere le risposte due volte.

Per provarla senza installazione permanente, da una copia locale:

```bash
pi -e ./pi-voce
```

Il pacchetto non è ancora pubblicato su npm.

## Utilizzo

Dopo il caricamento, la lettura automatica è attiva con la voce **Alice**. Se quella voce non è presente sul tuo sistema, selezionane un'altra:

| Comando Pi | Effetto |
| --- | --- |
| `/voce` | Legge l'ultima risposta nel ramo corrente, anche se la lettura automatica è disattivata |
| `/voce status` | Mostra lo stato della lettura automatica e la voce corrente |
| `/voce config` | Seleziona lingua, voce e stato della lettura automatica |
| `/voce on` | Attiva la lettura automatica |
| `/voce off` | Disattiva la lettura e interrompe quella in corso |
| `/voce stop` | Interrompe la lettura corrente senza disattivare le successive |
| `/voce elenco` | Mostra le voci e permette di selezionarne una |
| `/voce elenco it_IT` | Filtra l'elenco per lingua o nome |
| `/voce voce` | Scegli prima la lingua e poi la voce |
| `/voce voce it_IT` | Mostra le voci della lingua indicata |
| `/voce voce it_IT Federica` | Imposta una voce della lingua indicata |
| `/voce voce Federica` | Imposta una voce per nome |

La completazione di Pi suggerisce i sottocomandi; dopo `/voce elenco ` propone i codici lingua disponibili e dopo `/voce voce ` prima i codici lingua e, dopo il codice e uno spazio, le voci di quella lingua. È anche possibile digitare direttamente il nome di una voce.

In `/voce config` premi Esc in qualsiasi passaggio per annullare senza modificare le impostazioni. `/voce` cerca nel ramo attivo anche dopo `/reload` o il ripristino di una sessione; ignora risposte incomplete e chiamate agli strumenti.

La voce e lo stato on/off sono **temporanei**: a ogni riavvio, `/reload` o sostituzione della sessione tornano i valori iniziali. L'elenco proviene da `say -v ?`; le voci elencate dipendono dal sistema e potrebbero richiedere un download di macOS.

## Comportamento e limiti

- Legge la risposta finale quando Pi ha terminato il lavoro, solo nella modalità interattiva TUI. Non legge risultati degli strumenti, ragionamenti o risposte interrotte.
- I blocchi di codice delimitati da tripli apici inversi vengono sostituiti con «blocco di codice omesso»; la conversione del Markdown è semplice e non copre ogni formato.
- Un nuovo prompt, `/voce stop`, `/voce off` o la chiusura della sessione interrompono la lettura in corso.
- Può funzionare in Pi eseguito dentro Herdr, purché l'audio sia disponibile sulla macchina che esegue Pi. Ogni sessione Pi interattiva carica l'estensione indipendentemente: sessioni parallele possono parlare contemporaneamente.
- La sintesi è locale; il testo della conversazione può comunque essere inviato al provider del modello configurato in Pi.

## Sviluppo e test

```bash
npm test
```

I test usano le API integrate di Node.js e simulano il processo `say`; non riproducono audio né richiedono dipendenze npm. Per eseguirli serve Node.js 24 o successivo con il supporto sperimentale al mocking dei moduli. Per una verifica completa dell'audio, provare anche una sessione Pi interattiva su macOS.

## Licenza

[BSD 3-Clause](LICENSE), copyright Giordano Sognatore.
