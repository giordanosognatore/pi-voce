# Changelog

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
