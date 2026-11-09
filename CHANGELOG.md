# Changelog

## 0.4.1

- Esc diventa il tasto predefinito di arresto della lettura, osservato senza sostituire l'interruzione o l'annullamento di Pi.
- Supporto dell'alias `esc` nella configurazione, ad esempio `PI_VOCE_STOP_KEY=ctrl+esc`.
- Rimozione del listener di input alla chiusura e test delle sequenze Escape standard/Kitty.

## 0.4.0

- CI su Ubuntu/macOS e verifica del tarball realmente installato in un ambiente temporaneo.
- Scorciatoia Ctrl+Alt+S per interrompere la lettura, configurabile con `PI_VOCE_STOP_KEY`.
- Elenco risposte con prompt associato, data/ora, indicatore della riproduzione e filtro `/voce risposte [filtro]`.
- Indicatore nel footer con voce, velocità, lettura automatica e stato della riproduzione.
- `/voce risposte` per scegliere una risposta completa del ramo corrente, più recenti in alto.
- `/voce sessione <comando>` per modifiche temporanee senza scrivere le preferenze salvate.
- `/voce salva` per salvare tutte le impostazioni correnti e `/voce ripristina` per ricaricare quelle persistenti.
- `/voce status` distingue impostazioni correnti e predefinite salvate in sezioni multilinea; il footer usa i colori del tema e indica le differenze con «sessione».
- I comandi persistenti salvano solo i campi modificati, senza rendere permanenti altri override temporanei.
- La navigazione nell'albero interrompe la lettura del vecchio ramo.

## 0.3.0

- Lettura automatica disabilitata al primo utilizzo; le preferenze precedenti sono conservate.
- Conversione Markdown migliorata: tabelle con intestazioni, elenchi, collegamenti, immagini, emoji e blocchi di codice.
- `/voce testo` per configurare lettura di codice, URL e tabelle.
- Coordinamento locale tra sessioni: una lettura alla volta, senza interrompere altre sessioni o accodare letture obsolete.
- Recupero dei blocchi lasciati da processi terminati; attesa dell'uscita del lettore prima di liberare l'audio.
- Lingue con nomi leggibili, voce corrente evidenziata, anteprime nella lingua della voce quando disponibili.
- Voce di ripiego se quella configurata non è disponibile, senza sovrascrivere la preferenza salvata.
- Test su processi separati per l'esclusione audio e test della conversione del testo.

## 0.2.0

- Preferenze persistenti per voce, lingua/regione, lettura automatica e velocità.
- Comando `/voce velocita [80–400]` in parole/minuto.
- Comando `/voce anteprima` e anteprima nella configurazione guidata.
- Configurazione guidata annullabile senza salvare modifiche parziali.
- Test isolati su directory temporanee per persistenza, validazione ed errori.

## 0.1.0

- Lettura locale delle risposte di Pi tramite `say` su macOS.
- Lettura manuale, selezione delle voci, configurazione e completamento.
- Manifest Pi, documentazione, licenza BSD-3-Clause e test automatici.
