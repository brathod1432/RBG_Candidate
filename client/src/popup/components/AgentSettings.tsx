// client/src/popup/components/AgentSettings.tsx
import { useEffect, useState } from "react";
import {
  DEFAULT_FILL_PREFS,
  MAX_AGENTS,
  MIN_AGENTS,
  clampAgents,
  personasFor,
  type FillPrefs,
  type TypingSpeed,
} from "../../agents/palette";
import { getFillPrefs, saveFillPrefs } from "../../utils/storage";

const SPEEDS: Array<{ key: TypingSpeed; label: string }> = [
  { key: "slow", label: "Slow" },
  { key: "normal", label: "Normal" },
  { key: "fast", label: "Fast" },
];

/** Typing agents: on/off, crew size, typing speed. Saved immediately. */
export default function AgentSettings(): JSX.Element {
  const [prefs, setPrefs] = useState<FillPrefs>(DEFAULT_FILL_PREFS);

  useEffect(() => {
    let cancelled = false;
    getFillPrefs()
      .then((p) => {
        if (!cancelled) setPrefs(p);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function update(next: Partial<FillPrefs>): void {
    const merged = { ...prefs, ...next, agents: clampAgents(next.agents ?? prefs.agents) };
    setPrefs(merged);
    void saveFillPrefs(merged).catch(() => undefined);
  }

  return (
    <>
      <section className="card" aria-label="AI privacy">
        <div className="card-h">
          <p className="eyebrow">AI privacy</p>
          <div className="right">
            <label className="switch">
              <input
                type="checkbox"
                checked={prefs.aiProfileConsent}
                onChange={(e) => update({ aiProfileConsent: e.target.checked })}
                aria-label="Let AI workers use my profile"
                data-testid="ai-consent"
              />
            </label>
          </div>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          <b>Let AI workers use my profile</b> — when off, fields your profile can answer still fill,
          but nothing else is sent to the AI backend.
        </p>
      </section>

      <section className="card" aria-label="Typing agents">
      <div className="card-h">
        <p className="eyebrow">Typing agents</p>
        <div className="right">
          <label className="switch">
            <input
              type="checkbox"
              checked={prefs.animate}
              onChange={(e) => update({ animate: e.target.checked })}
              aria-label="Show typing agents"
            />
          </label>
        </div>
      </div>
      <p className="muted" style={{ margin: "0 0 10px" }}>
        Cursors that type your confirmed values letter by letter, several fields at once.{" "}
        <kbd>Esc</kbd> on the page finishes instantly.
      </p>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <div className="num" role="group" aria-label="Crew size">
          <button
            type="button"
            aria-label="Fewer agents"
            disabled={!prefs.animate || prefs.agents <= MIN_AGENTS}
            onClick={() => update({ agents: prefs.agents - 1 })}
          >
            −
          </button>
          <input
            type="number"
            min={MIN_AGENTS}
            max={MAX_AGENTS}
            value={prefs.agents}
            disabled={!prefs.animate}
            onChange={(e) => update({ agents: Number(e.target.value) })}
            aria-label="Number of typing agents"
          />
          <button
            type="button"
            aria-label="More agents"
            disabled={!prefs.animate || prefs.agents >= MAX_AGENTS}
            onClick={() => update({ agents: prefs.agents + 1 })}
          >
            +
          </button>
        </div>
        <div className="seg" role="group" aria-label="Typing speed">
          {SPEEDS.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={prefs.speed === s.key}
              disabled={!prefs.animate}
              onClick={() => update({ speed: s.key })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <ul className="crew" aria-label="Agent crew" style={{ opacity: prefs.animate ? 1 : 0.5 }}>
        {personasFor(prefs.agents).map((p) => (
          <li key={p.name} data-agent-chip={p.name}>
            <span className="av" style={{ background: p.color }}>
              {p.name[0]}
            </span>
            <b>{p.name}</b>
            <small>{p.role}</small>
          </li>
        ))}
      </ul>
      </section>
    </>
  );
}
