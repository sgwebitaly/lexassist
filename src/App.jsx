import { useState, useRef } from "react";
import mammoth from "mammoth";

const STAGES = {
  UPLOAD: "upload",
  ANALYZING: "analyzing",
  PROFILE: "profile",
  GENERATING: "generating",
  RESULT: "result",
};

const initialProfile = {
  studioNome: "",
  avvocatoNome: "",
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
  const [file, setFile] = useState(null);
  const [bandoAnalysis, setBandoAnalysis] = useState(null);
  const [profile, setProfile] = useState(initialProfile);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef();

  const handleFile = (f) => {
    if (!f) return;
    const allowed = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/html", "text/plain"];
    if (!allowed.some(t => f.type.includes(t.split("/")[1])) && !f.name.match(/\.(pdf|doc|docx|html|txt)$/i)) {
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

  const analyzeBando = async () => {
    if (!file) return;
    setStage(STAGES.ANALYZING);
    setError("");

    try {
      const isPDF = file.type === "application/pdf" || file.name.match(/\.pdf$/i);
      const isDOCX = file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.name.match(/\.docx$/i);

      let messages;

      if (isPDF) {
        // Send PDF as base64 document to Claude
        const base64Data = await readFileAsBase64(file);
        messages = [{
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64Data }
            },
            {
              type: "text",
              text: `Analizza questo bando ed estrai TUTTE le informazioni chiave senza omettere nulla. Rispondi SOLO con un oggetto JSON valido, senza markdown, senza backtick, senza testo aggiuntivo. Il JSON deve avere questa struttura:
{
  "titoloBando": "string",
  "enteEmittente": "string",
  "scadenza": "string",
  "oggetto": "string",
  "requisitiPrincipali": ["string - elenca TUTTI i requisiti uno per uno"],
  "documentiRichiesti": ["string - elenca TUTTI i documenti richiesti uno per uno"],
  "dichiarazioni": ["string - elenca TUTTE le dichiarazioni richieste una per una, inclusi tutti i sottopunti"],
  "modalitaInvio": "string",
  "noteImportanti": "string"
}`
            }
          ]
        }];
      } else if (isDOCX) {
        // Extract text from DOCX using mammoth
        const arrayBuffer = await readFileAsArrayBuffer(file);
        const { value: docText } = await mammoth.extractRawText({ arrayBuffer });
        messages = [{
          role: "user",
          content: `Analizza questo bando ed estrai TUTTE le informazioni chiave senza omettere nulla. Rispondi SOLO con un oggetto JSON valido, senza markdown, senza backtick, senza testo aggiuntivo. Il JSON deve avere questa struttura:
{
  "titoloBando": "string",
  "enteEmittente": "string",
  "scadenza": "string",
  "oggetto": "string",
  "requisitiPrincipali": ["string - elenca TUTTI i requisiti uno per uno"],
  "documentiRichiesti": ["string - elenca TUTTI i documenti richiesti uno per uno"],
  "dichiarazioni": ["string - elenca TUTTE le dichiarazioni richieste una per una, inclusi tutti i sottopunti"],
  "modalitaInvio": "string",
  "noteImportanti": "string"
}

Testo del bando:
${docText.slice(0, 20000)}`
        }];
      } else {
        // Plain text / HTML
        const fileText = await readFileAsText(file);
        messages = [{
          role: "user",
          content: `Analizza questo bando ed estrai TUTTE le informazioni chiave senza omettere nulla. Rispondi SOLO con un oggetto JSON valido, senza markdown, senza backtick, senza testo aggiuntivo. Il JSON deve avere questa struttura:
{
  "titoloBando": "string",
  "enteEmittente": "string",
  "scadenza": "string",
  "oggetto": "string",
  "requisitiPrincipali": ["string - elenca TUTTI i requisiti uno per uno"],
  "documentiRichiesti": ["string - elenca TUTTI i documenti richiesti uno per uno"],
  "dichiarazioni": ["string - elenca TUTTE le dichiarazioni richieste una per una, inclusi tutti i sottopunti"],
  "modalitaInvio": "string",
  "noteImportanti": "string"
}

Testo del bando:
${fileText.slice(0, 20000)}`
        }];
      }

      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4000,
          system: "Sei un assistente specializzato nell'analisi di bandi pubblici per avvocati italiani. Rispondi sempre e solo con JSON valido, nessun testo aggiuntivo. Estrai TUTTE le informazioni presenti nel documento senza omettere nulla.",
          messages,
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.content?.map(i => i.text || "").join("") || "";
      // Try to extract JSON even if there's surrounding text
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Nessun JSON trovato nella risposta");
      const parsed = JSON.parse(jsonMatch[0]);
      setBandoAnalysis(parsed);
      setStage(STAGES.PROFILE);
    } catch (err) {
      setError("Errore nell'analisi del bando: " + (err.message || "riprova."));
      setStage(STAGES.UPLOAD);
    }
  };

  const generateDomanda = async () => {
    setStage(STAGES.GENERATING);
    setError("");

    try {
      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4000,
          system: `Sei un assistente legale specializzato nella redazione di domande di iscrizione a short list per avvocati italiani. 
Genera documenti formali, professionali e completi in italiano. 
Usa un linguaggio giuridico appropriato. Includi TUTTE le dichiarazioni richieste dal bando.`,
          messages: [{
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
- Note importanti: ${bandoAnalysis?.noteImportanti || "nessuna"}

DATI STUDIO LEGALE:
- Studio: ${profile.studioNome}
- Avvocato: ${profile.avvocatoNome}
- P.IVA: ${profile.piva}
- C.F.: ${profile.cf}
- Indirizzo: ${profile.indirizzo}, ${profile.cap} ${profile.citta}
- Tel: ${profile.telefono}
- Email: ${profile.email}
- PEC: ${profile.pec}
- Iscrizione Ordine n.: ${profile.iscrizioneOrdine} - Ordine di ${profile.ordineAppartenenza}
- Anni di esperienza: ${profile.anniEsperienza}
- Settori di specializzazione: ${profile.settoriSpecializzazione}

Genera la domanda formale completa con:
1. Intestazione con dati del mittente
2. Dati del destinatario
3. Oggetto
4. Corpo della lettera con tutte le dichiarazioni richieste, ognuna numerata
5. Elenco documenti allegati
6. Data e firma`
          }],
        }),
      });

      const data = await response.json();
      const text = data.content?.map(i => i.text || "").join("") || "";
      setResult(text);
      setStage(STAGES.RESULT);
    } catch (err) {
      setError("Errore nella generazione della domanda. Riprova.");
      setStage(STAGES.PROFILE);
    }
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

  const updateProfile = (k, v) => setProfile(p => ({ ...p, [k]: v }));

  const reset = () => {
    setStage(STAGES.UPLOAD);
    setFile(null);
    setBandoAnalysis(null);
    setResult("");
    setError("");
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(result);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      fontFamily: "'Georgia', 'Times New Roman', serif",
      color: "#e8e0d0",
      padding: "0",
    }}>
      {/* Header */}
      <header style={{
        borderBottom: "1px solid #2a2535",
        padding: "24px 40px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(255,255,255,0.02)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{
            width: 36, height: 36,
            background: "linear-gradient(135deg, #c9a96e, #8b6914)",
            borderRadius: "6px",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "16px",
          }}>⚖</div>
          <div>
            <div style={{ fontSize: "17px", fontWeight: "600", letterSpacing: "0.02em", color: "#f0e8d8" }}>LexAssist</div>
            <div style={{ fontSize: "11px", color: "#6b6070", letterSpacing: "0.08em", textTransform: "uppercase" }}>Assistente Bandi per Avvocati</div>
          </div>
        </div>
        <StepIndicator stage={stage} />
      </header>

      <main style={{ maxWidth: "760px", margin: "0 auto", padding: "48px 24px" }}>
        {error && (
          <div style={{
            background: "rgba(180,60,60,0.12)", border: "1px solid rgba(180,60,60,0.3)",
            borderRadius: "8px", padding: "12px 16px", marginBottom: "24px",
            color: "#e08080", fontSize: "14px",
          }}>{error}</div>
        )}

        {stage === STAGES.UPLOAD && (
          <UploadStage
            file={file}
            dragOver={dragOver}
            setDragOver={setDragOver}
            handleDrop={handleDrop}
            handleFile={handleFile}
            fileInputRef={fileInputRef}
            onAnalyze={analyzeBando}
          />
        )}

        {stage === STAGES.ANALYZING && <LoadingStage message="Analisi del bando in corso..." sub="L'AI sta estraendo requisiti, scadenze e documenti necessari" />}
        {stage === STAGES.GENERATING && <LoadingStage message="Generazione della domanda in corso..." sub="L'AI sta redigendo il documento personalizzato per il tuo studio" />}

        {stage === STAGES.PROFILE && (
          <ProfileStage
            bandoAnalysis={bandoAnalysis}
            profile={profile}
            updateProfile={updateProfile}
            onGenerate={generateDomanda}
            onBack={reset}
          />
        )}

        {stage === STAGES.RESULT && (
          <ResultStage result={result} onReset={reset} onCopy={copyToClipboard} />
        )}
      </main>
    </div>
  );
}

function StepIndicator({ stage }) {
  const steps = [
    { id: STAGES.UPLOAD, label: "Carica" },
    { id: STAGES.ANALYZING, label: "Analisi" },
    { id: STAGES.PROFILE, label: "Profilo" },
    { id: STAGES.GENERATING, label: "Genera" },
    { id: STAGES.RESULT, label: "Risultato" },
  ];
  const order = [STAGES.UPLOAD, STAGES.ANALYZING, STAGES.PROFILE, STAGES.GENERATING, STAGES.RESULT];
  const current = order.indexOf(stage);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      {steps.map((s, i) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: "6px",
            opacity: i <= current ? 1 : 0.3,
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: "50%",
              background: i < current ? "#c9a96e" : i === current ? "transparent" : "transparent",
              border: i === current ? "2px solid #c9a96e" : i < current ? "none" : "2px solid #3a3545",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "10px", color: i < current ? "#0a0a0f" : "#c9a96e",
              fontWeight: "700",
            }}>
              {i < current ? "✓" : i + 1}
            </div>
            <span style={{ fontSize: "11px", color: i === current ? "#c9a96e" : "#6b6070", letterSpacing: "0.05em" }}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div style={{ width: 16, height: 1, background: i < current ? "#c9a96e" : "#2a2535" }} />
          )}
        </div>
      ))}
    </div>
  );
}

function UploadStage({ file, dragOver, setDragOver, handleDrop, handleFile, fileInputRef, onAnalyze }) {
  return (
    <div>
      <div style={{ marginBottom: "40px" }}>
        <h1 style={{ fontSize: "32px", fontWeight: "400", color: "#f0e8d8", marginBottom: "10px", lineHeight: 1.2 }}>
          Carica il bando
        </h1>
        <p style={{ color: "#7a7080", fontSize: "15px", lineHeight: 1.6 }}>
          Carica il documento del bando di gara. L'AI analizzerà automaticamente requisiti, scadenze e documentazione richiesta.
        </p>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "#c9a96e" : file ? "#5a4f3e" : "#2a2535"}`,
          borderRadius: "12px",
          padding: "56px 32px",
          textAlign: "center",
          cursor: "pointer",
          background: dragOver ? "rgba(201,169,110,0.05)" : file ? "rgba(201,169,110,0.03)" : "rgba(255,255,255,0.01)",
          transition: "all 0.2s ease",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.html,.txt"
          style={{ display: "none" }}
          onChange={e => handleFile(e.target.files[0])}
        />
        {file ? (
          <>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>📄</div>
            <div style={{ color: "#c9a96e", fontSize: "16px", fontWeight: "500", marginBottom: "4px" }}>{file.name}</div>
            <div style={{ color: "#5a5060", fontSize: "13px" }}>{(file.size / 1024).toFixed(0)} KB — clicca per cambiare</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: "40px", marginBottom: "16px", opacity: 0.5 }}>⬆</div>
            <div style={{ color: "#9a9098", fontSize: "15px", marginBottom: "6px" }}>Trascina il file qui o clicca per selezionare</div>
            <div style={{ color: "#4a4555", fontSize: "12px", letterSpacing: "0.05em" }}>PDF · DOC · DOCX · HTML</div>
          </>
        )}
      </div>

      {file && (
        <button
          onClick={onAnalyze}
          style={{
            marginTop: "24px", width: "100%",
            background: "linear-gradient(135deg, #c9a96e, #8b6914)",
            border: "none", borderRadius: "8px",
            padding: "16px", color: "#0a0a0f",
            fontSize: "15px", fontWeight: "600",
            cursor: "pointer", letterSpacing: "0.04em",
            fontFamily: "inherit",
          }}
        >
          Analizza Bando →
        </button>
      )}
    </div>
  );
}

function LoadingStage({ message, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "80px 0" }}>
      <div style={{
        width: 56, height: 56,
        border: "2px solid #2a2535",
        borderTop: "2px solid #c9a96e",
        borderRadius: "50%",
        margin: "0 auto 28px",
        animation: "spin 1s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ fontSize: "20px", color: "#f0e8d8", marginBottom: "10px" }}>{message}</div>
      <div style={{ color: "#6b6070", fontSize: "14px", maxWidth: "380px", margin: "0 auto", lineHeight: 1.6 }}>{sub}</div>
    </div>
  );
}

function ProfileStage({ bandoAnalysis, profile, updateProfile, onGenerate, onBack }) {
  const inputStyle = {
    width: "100%", background: "rgba(255,255,255,0.03)",
    border: "1px solid #2a2535", borderRadius: "6px",
    padding: "10px 14px", color: "#e8e0d0",
    fontSize: "14px", fontFamily: "inherit",
    outline: "none", boxSizing: "border-box",
  };

  const labelStyle = { fontSize: "11px", color: "#7a7080", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: "6px", display: "block" };

  const isComplete = profile.avvocatoNome && profile.email && profile.pec && profile.iscrizioneOrdine;

  return (
    <div>
      {/* Riepilogo bando */}
      <div style={{
        background: "rgba(201,169,110,0.06)", border: "1px solid rgba(201,169,110,0.2)",
        borderRadius: "10px", padding: "20px 24px", marginBottom: "36px",
      }}>
        <div style={{ fontSize: "11px", color: "#c9a96e", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "12px" }}>Bando Analizzato</div>
        <div style={{ fontSize: "17px", color: "#f0e8d8", fontWeight: "500", marginBottom: "6px" }}>{bandoAnalysis?.titoloBando || "—"}</div>
        <div style={{ fontSize: "13px", color: "#8a8090", marginBottom: "12px" }}>{bandoAnalysis?.enteEmittente} · Scadenza: {bandoAnalysis?.scadenza}</div>
        <div style={{ fontSize: "13px", color: "#7a7080", lineHeight: 1.5 }}>{bandoAnalysis?.oggetto}</div>
        {bandoAnalysis?.requisitiPrincipali?.length > 0 && (
          <div style={{ marginTop: "12px" }}>
            <div style={{ fontSize: "11px", color: "#6a6070", marginBottom: "6px", letterSpacing: "0.05em" }}>REQUISITI RILEVATI</div>
            {bandoAnalysis.requisitiPrincipali.map((r, i) => (
              <div key={i} style={{ fontSize: "12px", color: "#8a8090", padding: "2px 0" }}>· {r}</div>
            ))}
          </div>
        )}
        {bandoAnalysis?.dichiarazioni?.length > 0 && (
          <div style={{ marginTop: "12px" }}>
            <div style={{ fontSize: "11px", color: "#6a6070", marginBottom: "6px", letterSpacing: "0.05em" }}>DICHIARAZIONI RICHIESTE</div>
            {bandoAnalysis.dichiarazioni.map((d, i) => (
              <div key={i} style={{ fontSize: "12px", color: "#8a8090", padding: "2px 0" }}>· {d}</div>
            ))}
          </div>
        )}
        {bandoAnalysis?.documentiRichiesti?.length > 0 && (
          <div style={{ marginTop: "12px" }}>
            <div style={{ fontSize: "11px", color: "#6a6070", marginBottom: "6px", letterSpacing: "0.05em" }}>DOCUMENTI RICHIESTI</div>
            {bandoAnalysis.documentiRichiesti.map((d, i) => (
              <div key={i} style={{ fontSize: "12px", color: "#8a8090", padding: "2px 0" }}>· {d}</div>
            ))}
          </div>
        )}
        {bandoAnalysis?.modalitaInvio && (
          <div style={{ marginTop: "12px" }}>
            <div style={{ fontSize: "11px", color: "#6a6070", marginBottom: "4px", letterSpacing: "0.05em" }}>MODALITÀ DI INVIO</div>
            <div style={{ fontSize: "12px", color: "#8a8090" }}>{bandoAnalysis.modalitaInvio}</div>
          </div>
        )}
      </div>

      <h2 style={{ fontSize: "22px", fontWeight: "400", color: "#f0e8d8", marginBottom: "6px" }}>Dati del tuo studio</h2>
      <p style={{ color: "#6b6070", fontSize: "13px", marginBottom: "28px" }}>Questi dati verranno usati per compilare la domanda. I campi con * sono obbligatori.</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
        <div style={{ gridColumn: "1/-1" }}>
          <label style={labelStyle}>Nome Studio Legale</label>
          <input style={inputStyle} placeholder="Studio Legale Rossi & Associati" value={profile.studioNome} onChange={e => updateProfile("studioNome", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Nome Avvocato *</label>
          <input style={inputStyle} placeholder="Avv. Mario Rossi" value={profile.avvocatoNome} onChange={e => updateProfile("avvocatoNome", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>P.IVA</label>
          <input style={inputStyle} placeholder="01234567890" value={profile.piva} onChange={e => updateProfile("piva", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Codice Fiscale</label>
          <input style={inputStyle} placeholder="RSSMRA80A01H501Z" value={profile.cf} onChange={e => updateProfile("cf", e.target.value)} />
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
        <div style={{ gridColumn: "1/-1" }}>
          <label style={labelStyle}>Indirizzo</label>
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
        <button onClick={onBack} style={{
          flex: "0 0 auto", background: "transparent",
          border: "1px solid #2a2535", borderRadius: "8px",
          padding: "14px 24px", color: "#7a7080",
          fontSize: "14px", cursor: "pointer", fontFamily: "inherit",
        }}>← Indietro</button>
        <button
          onClick={onGenerate}
          disabled={!isComplete}
          style={{
            flex: 1,
            background: isComplete ? "linear-gradient(135deg, #c9a96e, #8b6914)" : "#1a1825",
            border: "none", borderRadius: "8px",
            padding: "14px", color: isComplete ? "#0a0a0f" : "#3a3545",
            fontSize: "15px", fontWeight: "600",
            cursor: isComplete ? "pointer" : "not-allowed",
            fontFamily: "inherit", letterSpacing: "0.04em",
          }}
        >
          {isComplete ? "Genera Domanda →" : "Completa i campi obbligatori *"}
        </button>
      </div>
    </div>
  );
}

function ResultStage({ result, onReset, onCopy }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "28px" }}>
        <div>
          <h2 style={{ fontSize: "24px", fontWeight: "400", color: "#f0e8d8", marginBottom: "4px" }}>Domanda Generata</h2>
          <p style={{ color: "#6b6070", fontSize: "13px" }}>Revisiona il documento e apporta le modifiche necessarie prima dell'invio.</p>
        </div>
        <div style={{
          background: "rgba(80,160,80,0.1)", border: "1px solid rgba(80,160,80,0.3)",
          borderRadius: "20px", padding: "6px 14px",
          color: "#70c870", fontSize: "12px",
        }}>✓ Generata</div>
      </div>

      <div style={{
        background: "rgba(255,255,255,0.02)", border: "1px solid #2a2535",
        borderRadius: "10px", padding: "28px 32px",
        fontFamily: "'Georgia', serif", fontSize: "14px",
        lineHeight: "1.8", color: "#d8d0c0",
        whiteSpace: "pre-wrap", maxHeight: "480px",
        overflowY: "auto", marginBottom: "20px",
      }}>
        {result}
      </div>

      <div style={{ display: "flex", gap: "12px" }}>
        <button onClick={onReset} style={{
          flex: "0 0 auto", background: "transparent",
          border: "1px solid #2a2535", borderRadius: "8px",
          padding: "14px 24px", color: "#7a7080",
          fontSize: "14px", cursor: "pointer", fontFamily: "inherit",
        }}>← Nuovo Bando</button>
        <button onClick={handleCopy} style={{
          flex: 1,
          background: copied ? "rgba(80,160,80,0.15)" : "linear-gradient(135deg, #c9a96e, #8b6914)",
          border: copied ? "1px solid rgba(80,160,80,0.4)" : "none",
          borderRadius: "8px", padding: "14px",
          color: copied ? "#70c870" : "#0a0a0f",
          fontSize: "15px", fontWeight: "600",
          cursor: "pointer", fontFamily: "inherit",
          transition: "all 0.2s",
        }}>
          {copied ? "✓ Copiato negli appunti!" : "Copia Documento"}
        </button>
      </div>
    </div>
  );
}
