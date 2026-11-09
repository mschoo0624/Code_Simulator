import { presets, type Preset } from "../examples/presets";

interface Props {
  language: "c" | "cpp";
  onLanguage: (lang: "c" | "cpp") => void;
  onPreset: (p: Preset) => void;
  onIllustrate: () => void;
  busy: boolean;
}

export function TopBar({ language, onLanguage, onPreset, onIllustrate, busy }: Props) {
  return (
    <header
      className="flex items-center gap-3 px-4 py-2 border-b"
      style={{ borderColor: "var(--border)", background: "var(--bg-soft)" }}
    >
      <h1 className="font-bold text-base mr-2">CodeLens-C</h1>

      <div
        role="group"
        aria-label="Language"
        className="flex rounded overflow-hidden border"
        style={{ borderColor: "var(--border)" }}
      >
        {(["c", "cpp"] as const).map((lang) => (
          <button
            key={lang}
            onClick={() => onLanguage(lang)}
            aria-pressed={language === lang}
            className="px-3 py-1 text-sm"
            style={{
              background: language === lang ? "var(--accent)" : "var(--bg)",
              color: language === lang ? "#fff" : "var(--fg)",
            }}
          >
            {lang === "c" ? "C" : "C++"}
          </button>
        ))}
      </div>

      <label className="text-sm" style={{ color: "var(--fg-soft)" }}>
        Examples{" "}
        <select
          className="border rounded px-2 py-1 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--fg)" }}
          defaultValue=""
          onChange={(e) => {
            const p = presets.find((x) => x.id === e.target.value);
            if (p) onPreset(p);
            e.target.value = "";
          }}
        >
          <option value="" disabled>
            choose…
          </option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex-1" />

      <button
        onClick={onIllustrate}
        disabled={busy}
        className="px-4 py-1.5 rounded font-semibold text-sm"
        style={{
          background: busy ? "var(--border)" : "var(--accent)",
          color: "#fff",
          cursor: busy ? "wait" : "pointer",
        }}
      >
        {busy ? "Tracing…" : "Illustrate"}
      </button>
    </header>
  );
}
