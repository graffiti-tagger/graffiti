import React from 'react'
import { TopNav, StatusBar } from '../components/shell.jsx'

const ArtView = ({ onAddMusic }) => {
  const [variant, setVariant] = React.useState(0)

  const variants = [
    { type: "Front cover", res: "1500×1500", size: "312 KB", accent: "var(--pink)" },
    { type: "Back cover",  res: "1500×1500", size: "248 KB", accent: "var(--cyan)" },
    { type: "Leaflet 1",   res: "1200×1200", size: "188 KB", accent: "var(--yellow)" },
  ]

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-0)" }}>
      <TopNav active="art" pendingCount={0} onAddMusic={onAddMusic} />

      <div style={{ padding: "20px 28px", borderBottom: "1.5px solid var(--line)", background: "var(--bg-1)", flex: "0 0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
          <div style={{ flex: 1 }}>
            <div className="label">Bad Brains · Bad Brains (1982)</div>
            <h1 style={{ margin: "4px 0 0", fontFamily: "var(--f-display)", fontSize: 28 }}>COVER ART</h1>
            <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>Will embed into 6 tracks</div>
          </div>
          <button className="btn">Fetch from MusicBrainz</button>
          <button className="btn primary">Embed 6 files</button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Preview */}
        <div style={{ flex: 1, padding: 36, display: "flex", justifyContent: "center", alignItems: "flex-start", overflow: "auto" }}>
          <div>
            <div style={{
              width: 380, height: 380,
              background: "linear-gradient(135deg, oklch(0.32 0.08 350), oklch(0.15 0.02 270))",
              border: "2px solid var(--ink)",
              position: "relative", overflow: "hidden",
              boxShadow: "8px 8px 0 var(--pink)",
            }}>
              <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(45deg, transparent 0 32px, oklch(0 0 0 / 0.4) 32px 36px)" }} />
              <div style={{
                position: "absolute", left: 22, right: 22, top: "26%",
                fontFamily: "var(--f-marker)", fontSize: 80, lineHeight: 0.85,
                color: "var(--green)", textShadow: "4px 4px 0 oklch(0 0 0)",
                transform: "rotate(-3deg)",
              }}>BAD<br/>BRAINS</div>
              <div style={{ position: "absolute", left: 22, bottom: 22, fontFamily: "var(--f-mono)", fontSize: 13, color: "var(--ink)" }}>1982 · ROIR</div>
            </div>
            <div style={{ marginTop: 12, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-3)", display: "flex", gap: 14, justifyContent: "center" }}>
              <span><span style={{ color: "var(--green)" }}>JPEG</span> 1500×1500</span>
              <span>sRGB</span>
              <span>312 KB</span>
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div style={{ width: 320, flex: "0 0 320px", borderLeft: "1.5px solid var(--line)", background: "var(--bg-1)", padding: 18, overflow: "auto" }}>
          <div className="label" style={{ marginBottom: 10 }}>Picture blocks</div>
          {variants.map((v, i) => (
            <div key={i} onClick={() => setVariant(i)} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 10px",
              background: variant === i ? "color-mix(in oklch, var(--green) 12%, transparent)" : "var(--bg-2)",
              border: variant === i ? "1.5px solid var(--green)" : "1.5px solid var(--line)",
              marginBottom: 6, cursor: "pointer",
            }}>
              <div style={{ width: 36, height: 36, background: v.accent, border: "1.5px solid var(--ink)" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{v.type}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{v.res} · {v.size}</div>
              </div>
            </div>
          ))}
          <button className="btn sm" style={{ width: "100%", marginTop: 4 }}>+ Add picture block</button>

          <div style={{ borderTop: "1px dashed var(--line)", marginTop: 22, paddingTop: 16 }}>
            <div className="label" style={{ marginBottom: 10 }}>Resize on embed</div>
            <select className="field" defaultValue="1500" style={{ marginBottom: 8 }}>
              <option>3000 px</option>
              <option>1500 px</option>
              <option>1000 px</option>
              <option>600 px</option>
            </select>
            <select className="field">
              <option>JPEG q92</option>
              <option>JPEG q80</option>
              <option>PNG</option>
            </select>
          </div>
        </div>
      </div>

      <StatusBar left="6 tracks targeted" right="metaflac --import-picture-from=cover.jpg" />
    </div>
  )
}

export default ArtView
