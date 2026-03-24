import { useState, useCallback, useRef } from "react";

/* ─────────────────────────────────────────────
   SYSTEM PROMPT
───────────────────────────────────────────── */
const SYSTEM_PROMPT = `You are VERIFAI — an advanced AI fact-checking, misinformation detection, and link safety analysis system.

You have access to the web_search tool. Use it ACTIVELY to:
1. Fetch and read URL content when a link is provided
2. Cross-verify claims against live sources
3. Check domain reputation and safety
4. Find corroborating or contradicting evidence

For ANY URL provided:
- Search for the domain's reputation, ownership, history
- Search for known scam/phishing reports about it
- Search for the article/content on other sources
- Check if the URL has been flagged by security services

For ANY claim:
- Search for verification from credible sources
- Look for contradicting evidence
- Check dates, facts, statistics

After researching, output STRICT JSON ONLY (no markdown, no preamble):
{
  "truth_score": number (0-100),
  "ai_generated": "Likely AI-generated" | "Possibly AI-generated" | "Likely Human-written",
  "link_safety": {
    "is_url_analyzed": boolean,
    "safety_status": "Safe" | "Suspicious" | "Dangerous" | "Unknown",
    "domain_age": "string or Unknown",
    "https_secure": boolean | null,
    "flags": ["string"],
    "redirect_risk": "Low" | "Medium" | "High" | "Unknown",
    "category": "News" | "Social Media" | "Blog" | "Government" | "Unknown" | "Phishing" | "Spam" | "Malware" | "Shopping" | "Forum"
  },
  "web_verified_sources": [
    { "claim": "string", "verdict": "Confirmed" | "Contradicted" | "Unverified", "source": "string" }
  ],
  "propaganda_patterns": ["string"],
  "red_flags": ["string"],
  "source_credibility": "string",
  "account_reliability": { "score": number, "insight": "string" },
  "viral_risk": "Low" | "Medium" | "High",
  "crowd_verification": { "trust_percent": number, "doubt_percent": number },
  "final_verdict": "Likely True" | "Unverified" | "Misleading" | "Likely False",
  "confidence_note": "This analysis is probabilistic and not guaranteed. Users should verify with trusted sources.",
  "explanation": "Short clear reasoning summary including what web search revealed"
}`;

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
const verdictConfig = {
  "Likely True":  { color: "#00e676", bg: "rgba(0,230,118,0.10)", icon: "✓", label: "LIKELY TRUE" },
  "Unverified":   { color: "#ffb300", bg: "rgba(255,179,0,0.10)",  icon: "?", label: "UNVERIFIED" },
  "Misleading":   { color: "#ff6d00", bg: "rgba(255,109,0,0.10)",  icon: "!", label: "MISLEADING" },
  "Likely False": { color: "#ff1744", bg: "rgba(255,23,68,0.10)",  icon: "✗", label: "LIKELY FALSE" },
};
const safetyColor = { Safe: "#00e676", Suspicious: "#ffb300", Dangerous: "#ff1744", Unknown: "#607d8b" };
const safetyIcon  = { Safe: "🛡", Suspicious: "⚠", Dangerous: "☠", Unknown: "?" };
const viralColor  = { Low: "#00e676", Medium: "#ffb300", High: "#ff1744" };
const aiColor     = { "Likely AI-generated": "#ff6d00", "Possibly AI-generated": "#ffb300", "Likely Human-written": "#00e676" };
const claimColor  = { Confirmed: "#00e676", Contradicted: "#ff1744", Unverified: "#ffb300" };

function isValidUrl(str) {
  try { const u = new URL(str.trim()); return u.protocol === "http:" || u.protocol === "https:"; }
  catch { return false; }
}

/* ─────────────────────────────────────────────
   UI ATOMS
───────────────────────────────────────────── */
function ScoreRing({ value, color, size = 80, label }) {
  const r = (size - 14) / 2;
  const circ = 2 * Math.PI * r;
  const filled = (value / 100) * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)", position: "absolute" }}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={7} />
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={7}
            strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
            style={{ transition: "stroke-dasharray 1.2s cubic-bezier(.4,0,.2,1)", filter: `drop-shadow(0 0 8px ${color}88)` }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: size > 70 ? 18 : 13, fontWeight: 800, color, fontFamily: "'Space Mono',monospace", lineHeight: 1 }}>{value}</span>
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", lineHeight: 1 }}>%</span>
        </div>
      </div>
      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "'Space Mono',monospace" }}>{label}</span>
    </div>
  );
}

function Tag({ text, color = "#00e5ff" }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "3px 9px", margin: "2px 3px",
      borderRadius: 4, border: `1px solid ${color}30`, background: `${color}12`,
      color, fontSize: 11, fontFamily: "'Space Mono',monospace", letterSpacing: 0.4
    }}>{text}</span>
  );
}

function Panel({ title, icon, children, accent = "#00e5ff", style: s = {} }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 12, padding: "16px 18px", position: "relative", overflow: "hidden", ...s
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: accent, borderRadius: "3px 0 0 3px", opacity: 0.8 }} />
      <div style={{ fontSize: 10, color: accent, letterSpacing: 2, textTransform: "uppercase", fontFamily: "'Space Mono',monospace", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <span>{icon}</span>{title}
      </div>
      {children}
    </div>
  );
}

function ScanSteps({ steps, current }) {
  return (
    <div style={{ padding: "18px 0 4px" }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, opacity: i > current ? 0.3 : 1, transition: "opacity 0.4s" }}>
          <div style={{
            width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
            background: i < current ? "rgba(0,230,118,0.15)" : i === current ? "rgba(0,229,255,0.15)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${i < current ? "#00e676" : i === current ? "#00e5ff" : "rgba(255,255,255,0.1)"}`,
            fontSize: 11, flexShrink: 0
          }}>
            {i < current ? <span style={{ color: "#00e676" }}>✓</span> : i === current ? <span style={{ color: "#00e5ff" }} className="pulse">⬡</span> : <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 9 }}>{i+1}</span>}
          </div>
          <span style={{ fontSize: 12, color: i === current ? "#e8eaf6" : "rgba(255,255,255,0.45)", fontFamily: "'Space Mono',monospace" }}>{s}</span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────
   MAIN APP
───────────────────────────────────────────── */
export default function VerifaiPro() {
  const [input, setInput] = useState("");
  const [inputMode, setInputMode] = useState("paste");
  const [loading, setLoading] = useState(false);
  const [scanStep, setScanStep] = useState(-1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const fileRef = useRef();

  const SCAN_STEPS = [
    "Parsing input & extracting content…",
    "Fetching URL / page content via web…",
    "Running domain & link safety checks…",
    "Cross-verifying claims with live sources…",
    "Analyzing propaganda & manipulation patterns…",
    "Generating final verdict & report…",
  ];

  const analyze = useCallback(async () => {
    if (!input.trim() && !imageBase64) return;
    setLoading(true); setError(null); setResult(null); setScanStep(0);

    const stepInterval = setInterval(() => {
      setScanStep(p => (p < SCAN_STEPS.length - 1 ? p + 1 : p));
    }, 1800);

    try {
      const hasUrl = isValidUrl(input.trim());
      const userMsg = hasUrl
        ? `Analyze this URL for safety, content accuracy, and misinformation. Use web search to: 1) Fetch and read the page content, 2) Check domain reputation and safety, 3) Verify claims found on the page, 4) Search for any known scam/phishing reports about this domain. URL: ${input.trim()}`
        : imageBase64
          ? `Extract and analyze this image content for misinformation. Also use web search to verify any claims or text found.`
          : `Use web search to verify claims in this content and check any URLs mentioned. Analyze for misinformation:\n\n${input}`;

      const messages = imageBase64
        ? [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
            { type: "text", text: userMsg }
          ]}]
        : [{ role: "user", content: userMsg }];

      // 🔒 Calls our secure Netlify Function proxy instead of Anthropic directly
      const res = await fetch("/api/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages,
        }),
      });

      const data = await res.json();
      const fullText = data.content?.map(b => b.type === "text" ? b.text : "").filter(Boolean).join("");
      const cleaned = fullText.replace(/```json[\s\S]*?```|```[\s\S]*?```/g, m =>
        m.replace(/```json|```/g, "").trim()
      ).trim();

      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");
      const parsed = JSON.parse(jsonMatch[0]);

      clearInterval(stepInterval);
      setScanStep(SCAN_STEPS.length);
      setResult(parsed);
    } catch (e) {
      clearInterval(stepInterval);
      setError("Analysis failed. The content may be too complex or an API error occurred.");
    } finally {
      setLoading(false);
    }
  }, [input, imageBase64]);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setImagePreview(ev.target.result); setImageBase64(ev.target.result.split(",")[1]); };
    reader.readAsDataURL(file);
  };

  const handlePaste = useCallback((e) => {
    for (const item of (e.clipboardData?.items || [])) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = ev => { setImagePreview(ev.target.result); setImageBase64(ev.target.result.split(",")[1]); };
        reader.readAsDataURL(file);
        return;
      }
    }
  }, []);

  const reset = () => { setInput(""); setImageBase64(null); setImagePreview(null); setResult(null); setError(null); setScanStep(-1); };

  const verdict = result ? (verdictConfig[result.final_verdict] || verdictConfig["Unverified"]) : null;
  const ls = result?.link_safety;
  const detectedUrl = isValidUrl(input.trim());

  const modes = [
    { id: "paste", icon: "✎", label: "Paste Text" },
    { id: "url",   icon: "⌁", label: "Analyze URL" },
    { id: "image", icon: "⊞", label: "Upload Image" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#07090f", color: "#e8eaf6", fontFamily: "'DM Sans', sans-serif", paddingBottom: 60 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#1a2535}
        textarea,input{resize:none;outline:none}button{cursor:pointer;border:none;outline:none}
        .scan-btn:hover:not(:disabled){background:linear-gradient(135deg,#00c8e0,#0097a7)!important;transform:translateY(-2px);box-shadow:0 10px 40px rgba(0,229,255,0.25)!important}
        .mode-btn:hover{border-color:rgba(0,229,255,0.35)!important;color:rgba(0,229,255,0.8)!important}
        .pulse{animation:pulse 1.4s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        .fade-up{animation:fadeUp 0.5s ease forwards}
      `}</style>

      <header style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,0.015)", backdropFilter: "blur(10px)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#00e5ff,#0097a7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, color: "#000", fontFamily: "'Space Mono',monospace" }}>V</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1, fontFamily: "'Space Mono',monospace", color: "#e8eaf6" }}>VERIFAI <span style={{ color: "#00e5ff" }}>PRO</span></div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", letterSpacing: 2 }}>AI-POWERED FACT-CHECK ENGINE</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[["🌐","Web Search ON"],["🛡","Link Scanner"],["🤖","AI Detection"]].map(([ic,lb]) => (
            <div key={lb} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20 }}>
              <span style={{ fontSize: 11 }}>{ic}</span>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: 1, fontFamily: "'Space Mono',monospace" }}>{lb}</span>
            </div>
          ))}
        </div>
      </header>

      <div style={{ maxWidth: 920, margin: "0 auto", padding: "30px 24px 0", position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {modes.map(m => (
            <button key={m.id} className="mode-btn" onClick={() => { setInputMode(m.id); reset(); }} style={{
              padding: "8px 18px", borderRadius: 8, fontSize: 11, fontFamily: "'Space Mono',monospace",
              background: inputMode === m.id ? "rgba(0,229,255,0.09)" : "rgba(255,255,255,0.025)",
              border: `1px solid ${inputMode === m.id ? "rgba(0,229,255,0.45)" : "rgba(255,255,255,0.07)"}`,
              color: inputMode === m.id ? "#00e5ff" : "rgba(255,255,255,0.35)",
              transition: "all 0.2s", display: "flex", alignItems: "center", gap: 6, letterSpacing: 0.8
            }}><span>{m.icon}</span>{m.label}</button>
          ))}
        </div>

        <div style={{ background: "rgba(255,255,255,0.022)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, overflow: "hidden", marginBottom: 14 }}>
          {inputMode === "image" ? (
            <div style={{ padding: 20 }}>
              <div onClick={() => fileRef.current.click()} style={{
                border: `2px dashed ${imagePreview ? "rgba(0,229,255,0.3)" : "rgba(255,255,255,0.1)"}`,
                borderRadius: 10, padding: imagePreview ? 12 : "36px 20px",
                textAlign: "center", cursor: "pointer", transition: "all 0.2s",
                background: imagePreview ? "rgba(0,229,255,0.04)" : "transparent"
              }}>
                {imagePreview
                  ? <img src={imagePreview} alt="preview" style={{ maxHeight: 180, borderRadius: 8, maxWidth: "100%", display: "block", margin: "0 auto" }} />
                  : <>
                    <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.4 }}>⊞</div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Click or drag to upload screenshot / image</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 4 }}>PNG · JPG · WEBP · GIF</div>
                  </>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
            </div>
          ) : inputMode === "url" ? (
            <div style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 10, color: "rgba(0,229,255,0.5)", letterSpacing: 2, marginBottom: 8, fontFamily: "'Space Mono',monospace" }}>⌁ URL TO ANALYZE</div>
              <input value={input} onChange={e => setInput(e.target.value)}
                placeholder="https://example.com/article"
                style={{ width: "100%", background: "transparent", border: "none", fontSize: 14, color: "#e8eaf6", fontFamily: "'DM Sans',sans-serif", lineHeight: 1.6 }} />
              {input && (
                <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: isValidUrl(input) ? "rgba(0,229,255,0.06)" : "rgba(255,109,0,0.06)", border: `1px solid ${isValidUrl(input) ? "rgba(0,229,255,0.2)" : "rgba(255,109,0,0.2)"}`, fontSize: 11, color: isValidUrl(input) ? "#00e5ff" : "#ff6d00", fontFamily: "'Space Mono',monospace" }}>
                  {isValidUrl(input) ? "✓ Valid URL detected — will fetch & analyze content + run safety scan" : "⚠ Enter a valid URL starting with http:// or https://"}
                </div>
              )}
            </div>
          ) : (
            <textarea value={input} onChange={e => setInput(e.target.value)} onPaste={handlePaste}
              placeholder={"Paste social media post, news, article, or any text…\n\nURLs inside text will also be scanned automatically.\nYou can also paste a screenshot (Ctrl+V)."}
              rows={8} style={{ width: "100%", background: "transparent", border: "none", padding: "18px 20px", fontSize: 14, color: "#e8eaf6", lineHeight: 1.75, fontFamily: "'DM Sans',sans-serif" }} />
          )}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: "9px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {imageBase64 && <span style={{ fontSize: 10, color: "#00e5ff", fontFamily: "'Space Mono',monospace" }}>📎 IMAGE READY</span>}
              {detectedUrl && inputMode === "paste" && <span style={{ fontSize: 10, color: "#ffb300", fontFamily: "'Space Mono',monospace" }}>⌁ URL DETECTED</span>}
              {!imageBase64 && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.18)", fontFamily: "'Space Mono',monospace" }}>{input.length} CHARS</span>}
            </div>
            {(input || imageBase64) && (
              <button onClick={reset} style={{ fontSize: 10, color: "rgba(255,80,80,0.5)", background: "none", fontFamily: "'Space Mono',monospace", letterSpacing: 0.5 }}>CLEAR ✕</button>
            )}
          </div>
        </div>

        <button onClick={analyze} disabled={loading || (!input.trim() && !imageBase64)} className="scan-btn" style={{
          width: "100%", padding: "16px 24px", borderRadius: 12, fontSize: 12, fontWeight: 700,
          fontFamily: "'Space Mono',monospace", letterSpacing: 2, transition: "all 0.25s",
          background: loading || (!input.trim() && !imageBase64) ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg,#00e5ff 0%,#00acc1 100%)",
          color: loading || (!input.trim() && !imageBase64) ? "rgba(255,255,255,0.15)" : "#000",
          boxShadow: "0 4px 24px rgba(0,229,255,0.12)", border: "none",
        }}>
          {loading
            ? <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}><span className="pulse" style={{ fontSize: 16 }}>⬡</span> SCANNING…</span>
            : "⚡  LAUNCH FULL SCAN"}
        </button>

        {loading && (
          <div className="fade-up" style={{ marginTop: 16, background: "rgba(0,229,255,0.04)", border: "1px solid rgba(0,229,255,0.1)", borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 10, color: "#00e5ff", letterSpacing: 2, fontFamily: "'Space Mono',monospace", marginBottom: 2 }}>SCAN IN PROGRESS</div>
            <ScanSteps steps={SCAN_STEPS} current={scanStep} />
          </div>
        )}

        {error && (
          <div style={{ marginTop: 14, padding: "13px 16px", background: "rgba(255,23,68,0.07)", border: "1px solid rgba(255,23,68,0.18)", borderRadius: 8, color: "#ff6b6b", fontSize: 13 }}>⚠ {error}</div>
        )}

        {result && (
          <div className="fade-up" style={{ marginTop: 28 }}>
            <div style={{ padding: "22px 26px", borderRadius: 16, marginBottom: 18, background: verdict.bg, border: `1px solid ${verdict.color}25`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", boxShadow: `0 0 60px ${verdict.color}0e` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: `${verdict.color}18`, border: `2px solid ${verdict.color}50`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, color: verdict.color, flexShrink: 0 }}>{verdict.icon}</div>
                <div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: 2.5, marginBottom: 3, fontFamily: "'Space Mono',monospace" }}>FINAL VERDICT</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: verdict.color, fontFamily: "'Space Mono',monospace", letterSpacing: 1 }}>{verdict.label}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                <ScoreRing value={result.truth_score} color={verdict.color} size={78} label="Truth" />
                <ScoreRing value={result.account_reliability.score} color="#b388ff" size={78} label="Reliability" />
              </div>
            </div>

            {ls?.is_url_analyzed && (
              <div style={{ marginBottom: 14 }}>
                <Panel title="Link Safety Analysis" icon={safetyIcon[ls.safety_status] || "?"} accent={safetyColor[ls.safety_status] || "#607d8b"}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 14 }}>
                    {[
                      { label: "SAFETY STATUS", val: ls.safety_status, color: safetyColor[ls.safety_status] },
                      { label: "REDIRECT RISK", val: ls.redirect_risk, color: viralColor[ls.redirect_risk] || "#607d8b" },
                      { label: "HTTPS SECURE", val: ls.https_secure === null ? "Unknown" : ls.https_secure ? "Yes ✓" : "No ✗", color: ls.https_secure ? "#00e676" : ls.https_secure === false ? "#ff1744" : "#607d8b" },
                      { label: "CATEGORY", val: ls.category, color: "#00e5ff" },
                      { label: "DOMAIN AGE", val: ls.domain_age, color: "#b388ff" },
                    ].map(x => (
                      <div key={x.label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "10px 12px" }}>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: 1.5, marginBottom: 4, fontFamily: "'Space Mono',monospace" }}>{x.label}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: x.color, fontFamily: "'Space Mono',monospace" }}>{x.val}</div>
                      </div>
                    ))}
                  </div>
                  {ls.flags?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: 1.5, marginBottom: 6, fontFamily: "'Space Mono',monospace" }}>SECURITY FLAGS</div>
                      <div>{ls.flags.map((f, i) => <Tag key={i} text={f} color={safetyColor[ls.safety_status] || "#ff6d00"} />)}</div>
                    </div>
                  )}
                </Panel>
              </div>
            )}

            {result.web_verified_sources?.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <Panel title="Web-Verified Claims" icon="🌐" accent="#00e5ff">
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {result.web_verified_sources.map((item, i) => (
                      <div key={i} style={{ display: "flex", gap: 12, padding: "10px 12px", borderRadius: 8, background: `${claimColor[item.verdict]}0c`, border: `1px solid ${claimColor[item.verdict]}20` }}>
                        <div style={{ flexShrink: 0, width: 20, height: 20, borderRadius: "50%", background: `${claimColor[item.verdict]}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: claimColor[item.verdict], marginTop: 1 }}>
                          {item.verdict === "Confirmed" ? "✓" : item.verdict === "Contradicted" ? "✗" : "?"}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", lineHeight: 1.5, marginBottom: 3 }}>{item.claim}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <Tag text={item.verdict} color={claimColor[item.verdict]} />
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono',monospace" }}>via {item.source}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <Panel title="Analysis Summary" icon="◈" accent="#00e5ff">
                <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.65)", lineHeight: 1.75 }}>{result.explanation}</p>
              </Panel>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <Panel title="AI Content Detection" icon="⬡" accent={aiColor[result.ai_generated] || "#ffb300"}>
                <div style={{ fontSize: 13, fontWeight: 700, color: aiColor[result.ai_generated] || "#ffb300", fontFamily: "'Space Mono',monospace", letterSpacing: 0.5 }}>{result.ai_generated}</div>
              </Panel>
              <Panel title="Viral Spread Risk" icon="⟳" accent={viralColor[result.viral_risk]}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: viralColor[result.viral_risk], fontFamily: "'Space Mono',monospace" }}>{result.viral_risk}</span>
                </div>
                <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 3, background: viralColor[result.viral_risk], width: result.viral_risk === "Low" ? "22%" : result.viral_risk === "Medium" ? "58%" : "100%", transition: "width 1.2s ease" }} />
                </div>
              </Panel>
            </div>

            <div style={{ marginBottom: 14 }}>
              <Panel title="Crowd Verification Simulation" icon="👥" accent="#7c4dff">
                <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", height: 32, marginBottom: 8 }}>
                  <div style={{ width: `${result.crowd_verification.trust_percent}%`, background: "linear-gradient(90deg,#00e676,#00bfa5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#001a10", fontFamily: "'Space Mono',monospace", transition: "width 1.2s ease" }}>{result.crowd_verification.trust_percent > 8 ? `${result.crowd_verification.trust_percent}%` : ""}</div>
                  <div style={{ width: `${result.crowd_verification.doubt_percent}%`, background: "linear-gradient(90deg,#d50000,#ff1744)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", fontFamily: "'Space Mono',monospace", transition: "width 1.2s ease" }}>{result.crowd_verification.doubt_percent > 8 ? `${result.crowd_verification.doubt_percent}%` : ""}</div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "'Space Mono',monospace" }}>
                  <span>✓ TRUST — {result.crowd_verification.trust_percent}%</span>
                  <span>DOUBT — {result.crowd_verification.doubt_percent}% ✗</span>
                </div>
              </Panel>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <Panel title="Propaganda Patterns" icon="⚠" accent="#ff6d00">
                {(result.propaganda_patterns || []).length === 0
                  ? <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>None detected</span>
                  : result.propaganda_patterns.map((p, i) => <Tag key={i} text={p} color="#ff6d00" />)}
              </Panel>
              <Panel title="Red Flags" icon="🚨" accent="#ff1744">
                {(result.red_flags || []).length === 0
                  ? <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>None detected</span>
                  : result.red_flags.map((f, i) => <Tag key={i} text={f} color="#ff1744" />)}
              </Panel>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14, marginBottom: 14 }}>
              <Panel title="Source Credibility" icon="◉" accent="#00e676">
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.65 }}>{result.source_credibility}</p>
              </Panel>
              <Panel title="Account Reliability" icon="◈" accent="#b388ff">
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <ScoreRing value={result.account_reliability.score} color="#b388ff" size={66} label="Score" />
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>{result.account_reliability.insight}</p>
                </div>
              </Panel>
            </div>

            <div style={{ padding: "12px 16px", background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 10, display: "flex", gap: 10 }}>
              <span style={{ opacity: 0.4, fontSize: 14, marginTop: 1 }}>⚠</span>
              <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.28)", lineHeight: 1.65, fontFamily: "'Space Mono',monospace" }}>{result.confidence_note}</span>
            </div>

            <button onClick={reset} style={{ marginTop: 18, width: "100%", padding: "12px", borderRadius: 10, fontSize: 11, fontFamily: "'Space Mono',monospace", letterSpacing: 1.5, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.3)", transition: "all 0.2s" }}>
              ↺  SCAN NEW CONTENT
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
