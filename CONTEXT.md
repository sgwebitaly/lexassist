# LexAssist — Contesto del Progetto

## Cos'è LexAssist
Assistente AI per avvocati italiani che analizza bandi pubblici (short list PA) e genera automaticamente le domande di iscrizione. È integrato con albocollaboratori.it, piattaforma di proprietà di Guiz (SGWEB) che aggrega avvisi di short list per avvocati.

## Stack Tecnico
- **Frontend:** React + Vite
- **Deploy:** Vercel (team: SGWEB's projects)
- **Dominio:** lexassist.albocollaboratori.it
- **Repo GitHub:** github.com/sgwebitaly/lexassist
- **AI:** Claude API (claude-sonnet-4-6) via proxy serverless
- **Dipendenze:** mammoth (lettura DOCX)

## Struttura File
```
lexassist/
├── api/
│   ├── claude.js         # Proxy serverless Anthropic API (nasconde la API key)
│   └── fetch-bando.js    # Proxy per scaricare PDF esterni (evita CORS)
├── src/
│   ├── App.jsx           # App React principale
│   └── main.jsx          # Entry point
├── index.html
├── package.json
├── vite.config.js
└── vercel.json
```

## Funzionalità Attuali
1. **Doppio percorso:**
   - Percorso A: carica il bando → AI analizza → genera domanda da zero
   - Percorso B: carica il modello dell'ente → AI lo compila con i dati del profilo
2. **Link diretto con parametro URL:** `?bando=URL_PDF` carica e analizza automaticamente il bando
3. **Prompt caching** attivo sui bandi caricati via URL (risparmio ~90% token input)
4. **Banner beta** in testa all'app

## API Anthropic
- Modello: `claude-sonnet-4-6`
- max_tokens analisi: 4000
- max_tokens generazione: 4000
- Prompt caching: attivo (`cache_control: ephemeral` sul documento)
- Header proxy: `anthropic-beta: prompt-caching-2024-07-31`
- **Guiz è sensibile ai costi — suggerire sempre opportunità di risparmio token**

## Dati di Utilizzo (giugno 2026)
- Costo medio: ~$1-2/giorno durante utilizzo attivo
- Il caching ha ridotto il costo dei token input da $0.31 a $0.03 sui bandi condivisi
- ~60 abbonati attivi su albocollaboratori

## Integrazioni
- **albocollaboratori.it:** WordPress, post standard. Link fisso LexAssist in fondo a ogni avviso (aggiunto via functions.php con filtro `the_content`)
- **Vercel:** deploy automatico da push GitHub su branch main

## Decisioni Architetturali Importanti
- PDF inviati a Claude come base64 (document API), non come testo
- DOCX letti con libreria mammoth prima dell'invio
- Il proxy `fetch-bando.js` accetta qualsiasi dominio `.it` per i PDF PA
- Analisi JSON sintetica (max 15 parole per elemento) per risparmiare token
- Generazione domanda con struttura PA italiana standard (DPR 445/2000, "il sottoscritto", "CHIEDE", ecc.)

## Prossimi Sviluppi Possibili
- Salvataggio profilo utente (localStorage o DB)
- Integrazione login abbonati albocollaboratori (WordPress REST API + JWT)
- Export domanda in PDF/DOCX
- Pre-compilazione profilo con dati abbonato da WordPress
