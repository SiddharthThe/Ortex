import { useState } from "react"

type Platform = "auto" | "chatgpt" | "claude" | "gemini"

function IndexPopup() {
  const [source, setSource] = useState<Platform>("auto")
  const [destination, setDestination] = useState<Platform>("chatgpt")
  const [mode, setMode] = useState<"full" | "smart" | "summary">("smart")

  return (
    <div
      style={{
        width: "360px",
        minHeight: "500px",
        background: "#0f1117",
        color: "#ffffff",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        padding: "20px",
        boxSizing: "border-box"
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginBottom: "24px"
        }}
      >
        <div
          style={{
            width: "38px",
            height: "38px",
            borderRadius: "10px",
            background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "18px",
            fontWeight: 700
          }}
        >
          O
        </div>

        <div>
          <div
            style={{
              fontSize: "18px",
              fontWeight: 700,
              letterSpacing: "-0.3px"
            }}
          >
            Ortex
          </div>

          <div
            style={{
              fontSize: "11px",
              color: "#8b93a7",
              marginTop: "2px"
            }}
          >
            LLM Context Orchestrator
          </div>
        </div>
      </div>

      {/* Current Platform */}
      <div style={sectionStyle}>
        <label style={labelStyle}>CURRENT PLATFORM</label>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "#171a23",
            border: "1px solid #252938",
            borderRadius: "10px",
            padding: "12px"
          }}
        >
          <span
            style={{
              width: "9px",
              height: "9px",
              borderRadius: "50%",
              background: "#737373",
              display: "inline-block"
            }}
          />

          <span style={{ fontSize: "13px", color: "#c9ceda" }}>
            Detecting platform...
          </span>
        </div>
      </div>

      {/* Conversation */}
      <div style={sectionStyle}>
        <label style={labelStyle}>ACTIVE CONVERSATION</label>

        <div
          style={{
            background: "#171a23",
            border: "1px solid #252938",
            borderRadius: "10px",
            padding: "14px"
          }}
        >
          <div
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "#dce0e9"
            }}
          >
            No conversation detected
          </div>

          <div
            style={{
              fontSize: "11px",
              color: "#737b8e",
              marginTop: "5px",
              lineHeight: 1.5
            }}
          >
            Open a supported LLM conversation to begin capturing context.
          </div>
        </div>
      </div>

      {/* Transfer */}
      <div style={sectionStyle}>
        <label style={labelStyle}>TRANSFER CONTEXT</label>

        {/* Source */}
        <div style={fieldStyle}>
          <span style={fieldLabelStyle}>Source</span>

          <select
            value={source}
            onChange={(e) => setSource(e.target.value as Platform)}
            style={selectStyle}
          >
            <option value="auto">Auto Detect</option>
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>

        {/* Destination */}
        <div style={fieldStyle}>
          <span style={fieldLabelStyle}>Destination</span>

          <select
            value={destination}
            onChange={(e) =>
              setDestination(e.target.value as Platform)
            }
            style={selectStyle}
          >
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>
      </div>

      {/* Transfer Mode */}
      <div style={sectionStyle}>
        <label style={labelStyle}>CONTEXT MODE</label>

        <div
          style={{
            display: "flex",
            gap: "7px"
          }}
        >
          {[
            ["full", "Full"],
            ["smart", "Smart"],
            ["summary", "Summary"]
          ].map(([value, label]) => {
            const selected = mode === value

            return (
              <button
                key={value}
                onClick={() =>
                  setMode(value as "full" | "smart" | "summary")
                }
                style={{
                  flex: 1,
                  padding: "9px 5px",
                  borderRadius: "8px",
                  border: selected
                    ? "1px solid #6366f1"
                    : "1px solid #292d3a",
                  background: selected ? "#26234a" : "#171a23",
                  color: selected ? "#a5b4fc" : "#858da0",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Context Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px",
          marginBottom: "20px"
        }}
      >
        <Stat label="Messages" value="—" />
        <Stat label="Tokens" value="—" />
      </div>

      {/* Transfer Button */}
      <button
        onClick={() => {
          console.log({
            source,
            destination,
            mode
          })
        }}
        style={{
          width: "100%",
          padding: "12px",
          border: "none",
          borderRadius: "10px",
          background: "linear-gradient(135deg, #6366f1, #7c3aed)",
          color: "#ffffff",
          fontSize: "13px",
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 6px 20px rgba(99, 102, 241, 0.25)"
        }}
      >
        Transfer Context →
      </button>

      {/* Footer */}
      <div
        style={{
          textAlign: "center",
          fontSize: "10px",
          color: "#555d70",
          marginTop: "16px"
        }}
      >
        Local-first • No mandatory API keys
      </div>
    </div>
  )
}

function Stat({
  label,
  value
}: {
  label: string
  value: string
}) {
  return (
    <div
      style={{
        background: "#171a23",
        border: "1px solid #252938",
        borderRadius: "9px",
        padding: "10px 12px"
      }}
    >
      <div
        style={{
          fontSize: "10px",
          color: "#737b8e",
          marginBottom: "3px"
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: "13px",
          fontWeight: 600,
          color: "#dce0e9"
        }}
      >
        {value}
      </div>
    </div>
  )
}

const sectionStyle = {
  marginBottom: "18px"
}

const labelStyle = {
  display: "block",
  fontSize: "9px",
  fontWeight: 700,
  letterSpacing: "1px",
  color: "#6f778a",
  marginBottom: "7px"
}

const fieldStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: "#171a23",
  border: "1px solid #252938",
  borderRadius: "9px",
  padding: "9px 11px",
  marginBottom: "7px"
}

const fieldLabelStyle = {
  fontSize: "12px",
  color: "#9da5b7"
}

const selectStyle = {
  background: "#20232d",
  border: "1px solid #303444",
  borderRadius: "6px",
  color: "#dce0e9",
  padding: "5px 7px",
  fontSize: "11px",
  outline: "none",
  cursor: "pointer"
}

export default IndexPopup