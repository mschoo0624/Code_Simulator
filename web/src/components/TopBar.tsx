import { customTemplates, presets, type Preset } from "../examples/presets";

interface Props {
  language: "c" | "cpp";
  onLanguage: (lang: "c" | "cpp") => void;
  onPreset: (p: Preset) => void;
  onIllustrate: () => void;
  busy: boolean;
}

export function TopBar({ language, onLanguage, onPreset, onIllustrate, busy }: Props) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">&lt;/&gt;</span>
        <div>
          <h1>CodeLens<span>-C</span></h1>
          <p>SEE YOUR CODE COME TO LIFE</p>
        </div>
      </div>

      <div
        role="group"
        aria-label="Language"
        className="language-switch"
      >
        {(["c", "cpp"] as const).map((lang) => (
          <button
            key={lang}
            onClick={() => onLanguage(lang)}
            aria-pressed={language === lang}
            className="language-button"
          >
            {lang === "c" ? "C" : "C++"}
          </button>
        ))}
      </div>

      <label className="topbar-examples">
        <span>Examples</span>
        <select
          className="select-control"
          defaultValue=""
          onChange={(e) => {
            const p = [...customTemplates, ...presets].find((x) => x.id === e.target.value);
            if (p) onPreset(p);
            e.target.value = "";
          }}
        >
          <option value="" disabled>
            choose…
          </option>
          <optgroup label="Write your own (any C/C++ code)">
            {customTemplates.map((p) => (
              <option key={p.id} value={p.id}>
                ✏️ {p.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Examples">
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      <div className="topbar-spacer" />

      <button
        onClick={onIllustrate}
        disabled={busy}
        className="primary-button illustrate-button"
      >
        <span aria-hidden="true">✦</span> {busy ? "Tracing…" : "Illustrate"}
      </button>
    </header>
  );
}
