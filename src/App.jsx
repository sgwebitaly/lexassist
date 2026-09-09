import { useState, useRef, useEffect } from "react";
import mammoth from "mammoth";

const STAGES = {
  UPLOAD: "upload",
  ANALYZING: "analyzing",
  PROFILE: "profile",
  GENERATING: "generating",
  RESULT: "result",
};

const MODES = {
  BANDO: "bando",
  MODELLO: "modello",
};

const initialProfile = {
  studioNome: "",
  avvocatoNome: "",
  dataNascita: "",
  luogoNascita: "",
  piva: "",
  cf: "",
  indirizzo: "",
  citta: "",
  cap: "",
  telefono: "",
  email: "",
  pec: "",
  anniEsperienza: "",
  settoriSpecializzazione: "",
  iscrizioneOrdine: "",
  ordineAppartenenza: "",
};

export default function App() {
  const [stage, setStage] = useState(STAGES.UPLOAD);
  const [mode, setMode] = useState(null);
  const [file, setFile] = useState(null);
  const [bandoUrl, setBandoUrl] = useState(null);
  const [bandoAnalysis, setBandoAnalysis] = useState(null);
  const [modelloText, setModelloText] = useState("");
  const [profile, setProfile] = useState(initialProfile);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);
  const fileInputRef = useRef();

  // Legge il parametro ?bando= dall'URL e avvia l'analisi automatica
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const bando = params.get("bando");
    if (bando) {
      setBandoUrl(bando);
      setMode(MODES.BANDO);
      fetchAndAnalyzeBandoFromUrl(bando);
    }
  }, []);

  const fetchAndAnalyzeBandoFromUrl = async (url) => {
    setAutoLoading(true);
    setStage(STAGES.ANALYZING);
    setError("");
    try {
      const proxyUrl = `/api/fetch-bando?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Impossibile scaricare il bando");
      }
      const blob = await response.blob();
      const fileName = url.split("/").pop() || "bando.pdf";
      const f = new File([blob], fileName.endsWith(".pdf") ? fileName : fileName + ".pdf", { type: "application/pdf" });
      setFile(f);

      // Converti in base64 e manda direttamente a Claude come documento
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(f);
      });

      const prompt = `Analizza questo bando ed estrai TUTTE le informazioni chiave senza omettere nulla. Rispondi SOLO con un oggetto JSON valido, senza markdown, senza backtick. Struttura:
{
  "titoloBando": "string",
  "enteEmittente": "string",
  "scadenza": "string",
  "oggetto": "string",
  "requisitiPrincipali": ["elenca TUTTI i requisiti uno per uno"],
  "documentiRichiesti": ["elenca TUTTI i documenti uno per uno"],
  "dichiarazioni": ["elenca TUTTE le dichiarazioni una per una, inclusi sottopunti"],
  "modalitaInvio": "string",
  "noteImportanti": "string"
}`;

      const messages = [{
        role: "user",
        content: [
          { 
            type: "document", 
            source: { type: "base64", media_type: "application/pdf", data: base64Data },
            cache_control: { type: "ephemeral" }
          },
          { type: "text", text: prompt }
        ]
      }];

      const text = await callClaude(
        "Sei un assistente specializzato nell'analisi di bandi pubblici italiani. Rispondi solo con JSON valido, nessun testo aggiuntivo. Sii sintetico: massimo 15 parole per ogni elemento degli array, massimo 5 elementi per array tranne dichiarazioni (max 10). Estrai le informazioni essenziali senza copiare testo verbatim.",
        messages
      );
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Nessun JSON trovato nella risposta");
      setBandoAnalysis(JSON.parse(jsonMatch[0]));
      setStage(STAGES.PROFILE);
    } catch (err) {
      setError("Errore nel caricamento automatico del bando: " + (err.message || "riprova."));
      setStage(STAGES.UPLOAD);
      setMode(MODES.BANDO);
    } finally {
      setAutoLoading(false);
    }
  };

  const handleFile = (f) => {
    if (!f) return;
    if (!f.name.match(/\.(pdf|doc|docx|html|txt)$/i)) {
      setError("Formato non supportato. Carica un file PDF, DOC, DOCX o HTML.");
      return;
    }
    setError("");
    setFile(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const readFileAsText = (f) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(f);
  });

  const readFileAsBase64 = (f) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(f);
  });

  const readFileAsArrayBuffer = (f) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(f);
  });

  const buildFileMessages = async (f, promptText) => {
    const isPDF = f.name.match(/\.pdf$/i);
    const isDOCX = f.name.match(/\.docx$/i);
    if (isPDF) {
      const base64Data = await readFileAsBase64(f);
      return [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } },
        { type: "text", text: promptText }
      ]}];
    } else if (isDOCX) {
      const arrayBuffer = await readFileAsArrayBuffer(f);
      const { value: docText } = await mammoth.extractRawText({ arrayBuffer });
      return [{ role: "user", content: `${promptText}\n\nTesto del documento:\n${docText.slice(0, 20000)}` }];
    } else {
      const fileText = await readFileAsText(f);
      return [{ role: "user", content: `${promptText}\n\nTesto del documento:\n${fileText.slice(0, 20000)}` }];
    }
  };

  const callClaude = async (system, messages, maxTokens = 4000) => {
    const response = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, system, messages }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.content?.map(i => i.text || "").join("") || "";
  };

  // PERCORSO A — analisi bando
  const analyzeBandoFile = async (f) => {
    try {
      const prompt = `Analizza questo bando ed estrai TUTTE le informazioni chiave senza omettere nulla. Rispondi SOLO con un oggetto JSON valido, senza markdown, senza backtick. Struttura:
{
  "titoloBando": "string",
  "enteEmittente": "string",
  "scadenza": "string",
  "oggetto": "string",
  "requisitiPrincipali": ["elenca TUTTI i requisiti uno per uno"],
  "documentiRichiesti": ["elenca TUTTI i documenti uno per uno"],
  "dichiarazioni": ["elenca TUTTE le dichiarazioni una per una, inclusi sottopunti"],
  "modalitaInvio": "string",
  "noteImportanti": "string"
}`;
      const messages = await buildFileMessages(f, prompt);
      const text = await callClaude(
        "Sei un assistente specializzato nell'analisi di bandi pubblici italiani. Rispondi solo con JSON valido, nessun testo aggiuntivo. Sii sintetico: massimo 15 parole per ogni elemento degli array, massimo 5 elementi per array tranne dichiarazioni (max 10). Estrai le informazioni essenziali senza copiare testo verbatim.",
        messages
      );
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Nessun JSON trovato nella risposta");
      setBandoAnalysis(JSON.parse(jsonMatch[0]));
      setStage(STAGES.PROFILE);
    } catch (err) {
      setError("Errore nell'analisi del bando: " + (err.message || "riprova."));
      setStage(STAGES.UPLOAD);
      setMode(MODES.BANDO);
    }
  };

  const analyzeBando = async () => {
    if (!file) return;
    setStage(STAGES.ANALYZING);
    setError("");
    await analyzeBandoFile(file);
  };

  // PERCORSO B — estrai testo dal modello
  const analyzeModello = async () => {
    if (!file) return;
    setStage(STAGES.ANALYZING);
    setError("");
    try {
      const prompt = "Estrai il testo completo di questo modello di domanda esattamente come appare, mantenendo tutta la struttura, i campi vuoti, le caselle da compilare e i riferimenti normativi. Non modificare nulla.";
      const messages = await buildFileMessages(file, prompt);
      const text = await callClaude(
        "Sei un assistente specializzato nell'analisi di documenti della pubblica amministrazione italiana. Estrai il testo del documento fedelmente.",
        messages
      );
      setModelloText(text);
      setStage(STAGES.PROFILE);
    } catch (err) {
      setError("Errore nell'analisi del modello: " + (err.message || "riprova."));
      setStage(STAGES.UPLOAD);
    }
  };

  const handleAnalyze = () => {
    if (mode === MODES.BANDO) analyzeBando();
    else analyzeModello();
  };

  const profileData = () => `
- Studio: ${profile.studioNome}
- Avvocato: ${profile.avvocatoNome}
- Nato/a a: ${profile.luogoNascita || "___"} il ${profile.dataNascita || "___"}
- P.IVA: ${profile.piva}
- C.F.: ${profile.cf}
- Indirizzo: ${profile.indirizzo}, ${profile.cap} ${profile.citta}
- Tel: ${profile.telefono}
- Email: ${profile.email}
- PEC: ${profile.pec}
- Iscrizione Ordine n.: ${profile.iscrizioneOrdine} - Ordine di ${profile.ordineAppartenenza}
- Anni di esperienza: ${profile.anniEsperienza}
- Settori di specializzazione: ${profile.settoriSpecializzazione}`.trim();

  const systemLegal = `Sei un assistente legale specializzato nella redazione di domande di iscrizione a short list per avvocati italiani.
Genera documenti formali, professionali e completi seguendo le convenzioni della pubblica amministrazione italiana.

REGOLE FONDAMENTALI:
- Usa sempre "Il/La sottoscritto/a [Nome Cognome]" come apertura
- Includi sempre: nato/a a, il, codice fiscale, iscrizione ordine
- Le dichiarazioni devono citare il D.P.R. 28 dicembre 2000 n. 445
- Usa "CHIEDE" in maiuscolo come snodo centrale
- Usa "A tal fine DICHIARA" prima dell'elenco dichiarazioni
- Chiudi con "Si allega alla presente:" + elenco documenti
- Firma: "[Luogo], lì ___" e "In fede," + nome
- Nessun placeholder generico: usa i dati forniti o trattini (___) dove mancano`;

  // GENERAZIONE PERCORSO A
  const generateFromBando = async () => {
    setStage(STAGES.GENERATING);
    setError("");
    try {
      const text = await callClaude(systemLegal, [{
        role: "user",
        content: `Genera una domanda di iscrizione alla short list basandoti su questi dati:

BANDO:
- Titolo: ${bandoAnalysis?.titoloBando}
- Ente: ${bandoAnalysis?.enteEmittente}
- Oggetto: ${bandoAnalysis?.oggetto}
- Scadenza: ${bandoAnalysis?.scadenza}
- Requisiti: ${bandoAnalysis?.requisitiPrincipali?.join("\n  * ")}
- Documenti richiesti: ${bandoAnalysis?.documentiRichiesti?.join("\n  * ")}
- Dichiarazioni richieste: ${bandoAnalysis?.dichiarazioni?.join("\n  * ")}
- Modalità di invio: ${bandoAnalysis?.modalitaInvio || "non specificata"}
- Note: ${bandoAnalysis?.noteImportanti || "nessuna"}

DATI AVVOCATO:
${profileData()}

Struttura richiesta:
1. Intestazione mittente (in alto sx): nome, studio, indirizzo, tel, email, pec
2. Destinatario (in alto dx): ente
3. OGGETTO in grassetto
4. Apertura con "Il/La sottoscritto/a [nome], nato/a a ___ il ___, C.F. [cf], iscritto/a all'Ordine degli Avvocati di [ordine] al n. [numero], con studio in [indirizzo],"
5. CHIEDE (maiuscolo)
6. Corpo della richiesta riferita al bando
7. A tal fine DICHIARA: tutte le dichiarazioni numerate con riferimento DPR 445/2000
8. Si allega alla presente: elenco numerato documenti
9. Data e firma`
      }]);
      setResult(text);
      setStage(STAGES.RESULT);
      // Log utilizzo in background
      logUtilizzo("bando");
    } catch (err) {
      setError("Errore nella generazione: " + (err.message || "riprova."));
      setStage(STAGES.PROFILE);
    }
  };

  // GENERAZIONE PERCORSO B
  const generateFromModello = async () => {
    setStage(STAGES.GENERATING);
    setError("");
    try {
      const text = await callClaude(systemLegal, [{
        role: "user",
        content: `Compila questo modello di domanda ufficiale con i dati dell'avvocato indicati di seguito.
Rispetta fedelmente la struttura originale del modello: non aggiungere, non rimuovere sezioni.
Compila TUTTI i campi vuoti, le caselle, gli spazi da riempire con i dati forniti.
Dove i dati non sono disponibili usa trattini (___).
Mantieni tutto il testo fisso del modello esattamente com'è.

MODELLO ORIGINALE:
${modelloText}

DATI AVVOCATO:
${profileData()}`
      }]);
      setResult(text);
      setStage(STAGES.RESULT);
      // Log utilizzo in background
      logUtilizzo("modello");
    } catch (err) {
      setError("Errore nella compilazione: " + (err.message || "riprova."));
      setStage(STAGES.PROFILE);
    }
  };

  const logUtilizzo = (modalita) => {
    fetch("/api/log-utilizzo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        avvocato: profile.avvocatoNome,
        email: profile.email,
        pec: profile.pec,
        ordine: profile.ordineAppartenenza,
        iscrizione: profile.iscrizioneOrdine,
        studio: profile.studioNome,
        bando: bandoAnalysis?.titoloBando || modelloText.slice(0, 80) || "",
        modalita,
      }),
    }).catch(() => {}); // silenzioso — non blocca l'utente
  };

  const generateDomanda = () => {
    if (mode === MODES.BANDO) generateFromBando();
    else generateFromModello();
  };

  const updateProfile = (k, v) => setProfile(p => ({ ...p, [k]: v }));

  const reset = () => {
    setStage(STAGES.UPLOAD);
    setMode(null);
    setFile(null);
    setBandoAnalysis(null);
    setModelloText("");
    setResult("");
    setError("");
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", fontFamily: "'Georgia', 'Times New Roman', serif", color: "#e8e0d0" }}>
      <header style={{ borderBottom: "1px solid #2a2535", padding: "24px 40px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,0.02)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{ width: 36, height: 36, background: "linear-gradient(135deg, #c9a96e, #8b6914)", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>⚖</div>
          <div>
            <div style={{ fontSize: "17px", fontWeight: "600", letterSpacing: "0.02em", color: "#f0e8d8" }}>LexAssist</div>
            <div style={{ fontSize: "11px", color: "#6b6070", letterSpacing: "0.08em", textTransform: "uppercase" }}>Assistente Bandi per Avvocati</div>
          </div>
        </div>
        <StepIndicator stage={stage} />
      </header>

      <main style={{ maxWidth: "760px", margin: "0 auto", padding: "48px 24px" }}>
        {error && (
          <div style={{ background: "rgba(180,60,60,0.12)", border: "1px solid rgba(180,60,60,0.3)", borderRadius: "8px", padding: "12px 16px", marginBottom: "24px", color: "#e08080", fontSize: "14px" }}>{error}</div>
        )}
        {stage === STAGES.UPLOAD && (
          <UploadStage
            mode={mode} setMode={setMode}
            file={file} dragOver={dragOver}
            setDragOver={setDragOver} handleDrop={handleDrop}
            handleFile={handleFile} fileInputRef={fileInputRef}
            onAnalyze={handleAnalyze}
          />
        )}
        {stage === STAGES.ANALYZING && <LoadingStage message={autoLoading ? "Caricamento bando da albocollaboratori..." : mode === MODES.MODELLO ? "Lettura del modello in corso..." : "Analisi del bando in corso..."} sub={autoLoading ? "Il bando viene scaricato e analizzato automaticamente" : mode === MODES.MODELLO ? "Estrazione della struttura del modello ufficiale" : "L'AI sta estraendo requisiti, scadenze e dichiarazioni"} />}
        {stage === STAGES.GENERATING && <LoadingStage message="Generazione del documento in corso..." sub={mode === MODES.MODELLO ? "L'AI sta compilando il modello con i tuoi dati" : "L'AI sta redigendo la domanda personalizzata"} />}
        {stage === STAGES.PROFILE && (
          <ProfileStage
            mode={mode}
            bandoAnalysis={bandoAnalysis}
            modelloText={modelloText}
            profile={profile}
            updateProfile={updateProfile}
            onGenerate={generateDomanda}
            onBack={reset}
          />
        )}
        {stage === STAGES.RESULT && (
          <ResultStage result={result} onReset={reset} onCopy={() => navigator.clipboard.writeText(result)} />
        )}
      </main>
    </div>
  );
}

function StepIndicator({ stage }) {
  const order = ["upload", "analyzing", "profile", "generating", "result"];
  const labels = ["Carica", "Analisi", "Profilo", "Genera", "Risultato"];
  const current = order.indexOf(stage);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      {labels.map((label, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", opacity: i <= current ? 1 : 0.3 }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: i < current ? "#c9a96e" : "transparent", border: i === current ? "2px solid #c9a96e" : i < current ? "none" : "2px solid #3a3545", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: i < current ? "#0a0a0f" : "#c9a96e", fontWeight: "700" }}>
              {i < current ? "✓" : i + 1}
            </div>
            <span style={{ fontSize: "11px", color: i === current ? "#c9a96e" : "#6b6070", letterSpacing: "0.05em" }}>{label}</span>
          </div>
          {i < labels.length - 1 && <div style={{ width: 16, height: 1, background: i < current ? "#c9a96e" : "#2a2535" }} />}
        </div>
      ))}
    </div>
  );
}

function UploadStage({ mode, setMode, file, dragOver, setDragOver, handleDrop, handleFile, fileInputRef, onAnalyze }) {
  const modeSelected = mode !== null;

  return (
    <div>
      <div style={{ background: "rgba(201,169,110,0.08)", border: "1px solid rgba(201,169,110,0.25)", borderRadius: "8px", padding: "10px 16px", marginBottom: "28px", display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ fontSize: "13px", color: "#c9a96e", fontWeight: "600", letterSpacing: "0.05em" }}>BETA</span>
        <span style={{ fontSize: "13px", color: "#8a8070", lineHeight: 1.5 }}>In questa versione beta i dati del profilo non vengono salvati. Dovrai reinserirli ad ogni elaborazione.</span>
      </div>

      <div style={{ marginBottom: "36px" }}>
        <h1 style={{ fontSize: "32px", fontWeight: "400", color: "#f0e8d8", marginBottom: "10px" }}>Come vuoi procedere?</h1>
        <p style={{ color: "#7a7080", fontSize: "15px", lineHeight: 1.6 }}>Scegli il tipo di documento che hai a disposizione.</p>
      </div>

      {/* Scelta modalità */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "36px" }}>
        {[
          { id: "bando", label: "Ho il bando", icon: "📋", desc: "Carica l'avviso o bando di gara. LexAssist lo analizza e genera la domanda da zero." },
          { id: "modello", label: "Ho il modello dell'ente", icon: "📝", desc: "L'ente ha già fornito il modulo di domanda. LexAssist lo compila con i tuoi dati." },
        ].map(opt => (
          <div
            key={opt.id}
            onClick={() => setMode(opt.id)}
            style={{
              border: `2px solid ${mode === opt.id ? "#c9a96e" : "#2a2535"}`,
              borderRadius: "10px", padding: "20px",
              cursor: "pointer",
              background: mode === opt.id ? "rgba(201,169,110,0.06)" : "rgba(255,255,255,0.01)",
              transition: "all 0.2s",
            }}
          >
            <div style={{ fontSize: "28px", marginBottom: "10px" }}>{opt.icon}</div>
            <div style={{ fontSize: "15px", fontWeight: "600", color: mode === opt.id ? "#c9a96e" : "#f0e8d8", marginBottom: "6px" }}>{opt.label}</div>
            <div style={{ fontSize: "12px", color: "#6b6070", lineHeight: 1.5 }}>{opt.desc}</div>
          </div>
        ))}
      </div>

      {/* Upload area — visibile solo dopo scelta modalità */}
      {modeSelected && (
        <>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? "#c9a96e" : file ? "#5a4f3e" : "#2a2535"}`,
              borderRadius: "12px", padding: "48px 32px", textAlign: "center", cursor: "pointer",
              background: dragOver ? "rgba(201,169,110,0.05)" : file ? "rgba(201,169,110,0.03)" : "rgba(255,255,255,0.01)",
              transition: "all 0.2s",
            }}
          >
            <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.html,.txt" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
            {file ? (
              <>
                <div style={{ fontSize: "36px", marginBottom: "10px" }}>📄</div>
                <div style={{ color: "#c9a96e", fontSize: "15px", fontWeight: "500", marginBottom: "4px" }}>{file.name}</div>
                <div style={{ color: "#5a5060", fontSize: "12px" }}>{(file.size / 1024).toFixed(0)} KB — clicca per cambiare</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "36px", marginBottom: "12px", opacity: 0.4 }}>⬆</div>
                <div style={{ color: "#9a9098", fontSize: "14px", marginBottom: "4px" }}>
                  {mode === "bando" ? "Carica il bando (PDF, DOC, DOCX)" : "Carica il modello dell'ente (PDF, DOC, DOCX)"}
                </div>
                <div style={{ color: "#4a4555", fontSize: "11px", letterSpacing: "0.05em" }}>Trascina qui o clicca per selezionare</div>
              </>
            )}
          </div>

          {file && (
            <button
              onClick={onAnalyze}
              style={{
                marginTop: "20px", width: "100%",
                background: "linear-gradient(135deg, #c9a96e, #8b6914)",
                border: "none", borderRadius: "8px", padding: "16px",
                color: "#0a0a0f", fontSize: "15px", fontWeight: "600",
                cursor: "pointer", letterSpacing: "0.04em", fontFamily: "inherit",
              }}
            >
              {mode === "bando" ? "Analizza Bando →" : "Leggi Modello →"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function LoadingStage({ message, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "80px 0" }}>
      <div style={{ width: 56, height: 56, border: "2px solid #2a2535", borderTop: "2px solid #c9a96e", borderRadius: "50%", margin: "0 auto 28px", animation: "spin 1s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ fontSize: "20px", color: "#f0e8d8", marginBottom: "10px" }}>{message}</div>
      <div style={{ color: "#6b6070", fontSize: "14px", maxWidth: "380px", margin: "0 auto", lineHeight: 1.6 }}>{sub}</div>
    </div>
  );
}

function ProfileStage({ mode, bandoAnalysis, modelloText, profile, updateProfile, onGenerate, onBack }) {
  const inputStyle = { width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid #2a2535", borderRadius: "6px", padding: "10px 14px", color: "#e8e0d0", fontSize: "14px", fontFamily: "inherit", outline: "none", boxSizing: "border-box" };
  const labelStyle = { fontSize: "11px", color: "#7a7080", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: "6px", display: "block" };
  const isComplete = profile.avvocatoNome && profile.email && profile.pec && profile.iscrizioneOrdine;

  return (
    <div>
      {/* Riepilogo documento */}
      <div style={{ background: "rgba(201,169,110,0.06)", border: "1px solid rgba(201,169,110,0.2)", borderRadius: "10px", padding: "20px 24px", marginBottom: "36px" }}>
        <div style={{ fontSize: "11px", color: "#c9a96e", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "10px" }}>
          {mode === "bando" ? "Bando Analizzato" : "Modello Rilevato"}
        </div>
        {mode === "bando" ? (
          <>
            <div style={{ fontSize: "17px", color: "#f0e8d8", fontWeight: "500", marginBottom: "4px" }}>{bandoAnalysis?.titoloBando || "—"}</div>
            <div style={{ fontSize: "13px", color: "#8a8090", marginBottom: "10px" }}>{bandoAnalysis?.enteEmittente} · Scadenza: {bandoAnalysis?.scadenza}</div>
            <div style={{ fontSize: "13px", color: "#7a7080", lineHeight: 1.5 }}>{bandoAnalysis?.oggetto}</div>
            {bandoAnalysis?.requisitiPrincipali?.length > 0 && (
              <div style={{ marginTop: "12px" }}>
                <div style={{ fontSize: "11px", color: "#6a6070", marginBottom: "6px", letterSpacing: "0.05em" }}>REQUISITI</div>
                {bandoAnalysis.requisitiPrincipali.map((r, i) => <div key={i} style={{ fontSize: "12px", color: "#8a8090", padding: "2px 0" }}>· {r}</div>)}
              </div>
            )}
            {bandoAnalysis?.dichiarazioni?.length > 0 && (
              <div style={{ marginTop: "12px" }}>
                <div style={{ fontSize: "11px", color: "#6a6070", marginBottom: "6px", letterSpacing: "0.05em" }}>DICHIARAZIONI RICHIESTE</div>
                {bandoAnalysis.dichiarazioni.map((d, i) => <div key={i} style={{ fontSize: "12px", color: "#8a8090", padding: "2px 0" }}>· {d}</div>)}
              </div>
            )}
            {bandoAnalysis?.documentiRichiesti?.length > 0 && (
              <div style={{ marginTop: "12px" }}>
                <div style={{ fontSize: "11px", color: "#6a6070", marginBottom: "6px", letterSpacing: "0.05em" }}>DOCUMENTI RICHIESTI</div>
                {bandoAnalysis.documentiRichiesti.map((d, i) => <div key={i} style={{ fontSize: "12px", color: "#8a8090", padding: "2px 0" }}>· {d}</div>)}
              </div>
            )}
            {bandoAnalysis?.modalitaInvio && (
              <div style={{ marginTop: "12px" }}>
                <div style={{ fontSize: "11px", color: "#6a6070", marginBottom: "4px", letterSpacing: "0.05em" }}>MODALITÀ DI INVIO</div>
                <div style={{ fontSize: "12px", color: "#8a8090" }}>{bandoAnalysis.modalitaInvio}</div>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize: "15px", color: "#f0e8d8", marginBottom: "8px" }}>Modello caricato correttamente ✓</div>
            <div style={{ fontSize: "12px", color: "#7a7080", lineHeight: 1.6, maxHeight: "120px", overflowY: "auto", whiteSpace: "pre-wrap" }}>{modelloText.slice(0, 400)}…</div>
          </>
        )}
      </div>

      <h2 style={{ fontSize: "22px", fontWeight: "400", color: "#f0e8d8", marginBottom: "6px" }}>Dati del tuo studio</h2>
      <p style={{ color: "#6b6070", fontSize: "13px", marginBottom: "28px" }}>I campi con * sono obbligatori.</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <div style={{ gridColumn: "1/-1" }}>
          <label style={labelStyle}>Nome Studio Legale</label>
          <input style={inputStyle} placeholder="Studio Legale Rossi & Associati" value={profile.studioNome} onChange={e => updateProfile("studioNome", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Nome Avvocato *</label>
          <input style={inputStyle} placeholder="Mario Rossi" value={profile.avvocatoNome} onChange={e => updateProfile("avvocatoNome", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Luogo di Nascita</label>
          <input style={inputStyle} placeholder="Roma" value={profile.luogoNascita} onChange={e => updateProfile("luogoNascita", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Data di Nascita</label>
          <input style={inputStyle} placeholder="01/01/1980" value={profile.dataNascita} onChange={e => updateProfile("dataNascita", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Codice Fiscale</label>
          <input style={inputStyle} placeholder="RSSMRA80A01H501Z" value={profile.cf} onChange={e => updateProfile("cf", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>P.IVA</label>
          <input style={inputStyle} placeholder="01234567890" value={profile.piva} onChange={e => updateProfile("piva", e.target.value)} />
        </div>
        <div style={{ gridColumn: "1/-1" }}>
          <label style={labelStyle}>Indirizzo Studio</label>
          <input style={inputStyle} placeholder="Via Roma 1" value={profile.indirizzo} onChange={e => updateProfile("indirizzo", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Città</label>
          <input style={inputStyle} placeholder="Roma" value={profile.citta} onChange={e => updateProfile("citta", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>CAP</label>
          <input style={inputStyle} placeholder="00100" value={profile.cap} onChange={e => updateProfile("cap", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Telefono</label>
          <input style={inputStyle} placeholder="+39 06 1234567" value={profile.telefono} onChange={e => updateProfile("telefono", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Email *</label>
          <input style={inputStyle} placeholder="studio@esempio.it" value={profile.email} onChange={e => updateProfile("email", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>PEC *</label>
          <input style={inputStyle} placeholder="studio@pec.it" value={profile.pec} onChange={e => updateProfile("pec", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>N. Iscrizione Albo *</label>
          <input style={inputStyle} placeholder="12345" value={profile.iscrizioneOrdine} onChange={e => updateProfile("iscrizioneOrdine", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Ordine di Appartenenza</label>
          <input style={inputStyle} placeholder="Roma" value={profile.ordineAppartenenza} onChange={e => updateProfile("ordineAppartenenza", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Anni di Esperienza</label>
          <input style={inputStyle} placeholder="15" value={profile.anniEsperienza} onChange={e => updateProfile("anniEsperienza", e.target.value)} />
        </div>
        <div style={{ gridColumn: "1/-1" }}>
          <label style={labelStyle}>Settori di Specializzazione</label>
          <input style={inputStyle} placeholder="Diritto amministrativo, appalti pubblici, diritto civile" value={profile.settoriSpecializzazione} onChange={e => updateProfile("settoriSpecializzazione", e.target.value)} />
        </div>
      </div>

      <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
        <button onClick={onBack} style={{ flex: "0 0 auto", background: "transparent", border: "1px solid #2a2535", borderRadius: "8px", padding: "14px 24px", color: "#7a7080", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>← Indietro</button>
        <button
          onClick={onGenerate}
          disabled={!isComplete}
          style={{
            flex: 1,
            background: isComplete ? "linear-gradient(135deg, #c9a96e, #8b6914)" : "#1a1825",
            border: "none", borderRadius: "8px", padding: "14px",
            color: isComplete ? "#0a0a0f" : "#3a3545",
            fontSize: "15px", fontWeight: "600",
            cursor: isComplete ? "pointer" : "not-allowed",
            fontFamily: "inherit", letterSpacing: "0.04em",
          }}
        >
          {isComplete ? (mode === "bando" ? "Genera Domanda →" : "Compila Modello →") : "Completa i campi obbligatori *"}
        </button>
      </div>
    </div>
  );
}

function ResultStage({ result, onReset, onCopy }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => { onCopy(); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "28px" }}>
        <div>
          <h2 style={{ fontSize: "24px", fontWeight: "400", color: "#f0e8d8", marginBottom: "4px" }}>Documento Generato</h2>
          <p style={{ color: "#6b6070", fontSize: "13px" }}>Revisiona e apporta le modifiche necessarie prima dell'invio.</p>
        </div>
        <div style={{ background: "rgba(80,160,80,0.1)", border: "1px solid rgba(80,160,80,0.3)", borderRadius: "20px", padding: "6px 14px", color: "#70c870", fontSize: "12px" }}>✓ Pronto</div>
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid #2a2535", borderRadius: "10px", padding: "28px 32px", fontFamily: "'Georgia', serif", fontSize: "14px", lineHeight: "1.8", color: "#d8d0c0", whiteSpace: "pre-wrap", maxHeight: "480px", overflowY: "auto", marginBottom: "20px" }}>
        {result}
      </div>

      <div style={{ display: "flex", gap: "12px" }}>
        <button onClick={onReset} style={{ flex: "0 0 auto", background: "transparent", border: "1px solid #2a2535", borderRadius: "8px", padding: "14px 24px", color: "#7a7080", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>← Nuovo documento</button>
        <button onClick={handleCopy} style={{ flex: 1, background: copied ? "rgba(80,160,80,0.15)" : "linear-gradient(135deg, #c9a96e, #8b6914)", border: copied ? "1px solid rgba(80,160,80,0.4)" : "none", borderRadius: "8px", padding: "14px", color: copied ? "#70c870" : "#0a0a0f", fontSize: "15px", fontWeight: "600", cursor: "pointer", fontFamily: "inherit", transition: "all 0.2s" }}>
          {copied ? "✓ Copiato negli appunti!" : "Copia Documento"}
        </button>
      </div>
    </div>
  );
}
