// client/src/popup/App.tsx
import { useEffect } from "react";
import { getProfile } from "../utils/storage";
import { toMessage } from "./chrome";
import { usePrepareHealth } from "./usePrepareHealth";
import { DISCLAIMER, usePopupStore } from "./store";
import Icon from "./components/Icon";
import { logoSvg } from "../agents/logo";
import type { PopupTab } from "./store";
import SettingsTab from "./tabs/SettingsTab";
import PrepareTab from "./tabs/PrepareTab";
import FillTab from "./tabs/FillTab";
import ReviewTab from "./tabs/ReviewTab";

const STEPS: Array<{ key: PopupTab; label: string }> = [
  { key: "settings", label: "Profile" },
  { key: "prepare", label: "Prepare" },
  { key: "fill", label: "Scan" },
  { key: "review", label: "Review" },
];

function ServerPill(): JSX.Element {
  const status = usePopupStore((s) => s.prepareStatus);
  const c = usePopupStore((s) => s.prepareChecks);
  const setTab = usePopupStore((s) => s.setTab);
  const cls = status === "ready" ? "ok" : status === "down" ? "bad" : status === "degraded" ? "warn" : "";
  const text =
    status === "unknown" || status === "checking"
      ? "checking…"
      : status === "down"
        ? "server offline"
        : `${c.workers}/${c.workersTotal} workers`;
  return (
    <button
      type="button"
      className={`pill ${cls}`}
      title={status === "down" ? "Start the local server: uvicorn server.main:app --port 8000" : c.models.join("\n")}
      data-testid="server-pill"
      onClick={() => setTab("prepare")}
    >
      {text}
    </button>
  );
}

export default function App(): JSX.Element {
  const tab = usePopupStore((s) => s.tab);
  const setTab = usePopupStore((s) => s.setTab);
  const error = usePopupStore((s) => s.error);
  const notice = usePopupStore((s) => s.notice);
  const profile = usePopupStore((s) => s.profile);
  const setProfile = usePopupStore((s) => s.setProfile);
  const keySource = usePopupStore((s) => s.prepareChecks.keySource);
  const setError = usePopupStore((s) => s.setError);
  const scan = usePopupStore((s) => s.scan);
  const stageDecisions = usePopupStore((s) => s.stageDecisions);
  const prepareStatus = usePopupStore((s) => s.prepareStatus);

  useEffect(() => {
    let cancelled = false;
    getProfile()
      .then((p) => {
        if (!cancelled && p !== null) setProfile(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(toMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [setProfile, setError]);
  usePrepareHealth();

  const done: Record<PopupTab, boolean> = {
    settings: profile !== null && (profile.fullName ?? "") !== "",
    prepare: prepareStatus === "ready",
    fill: scan !== null,
    review: scan !== null && stageDecisions[scan.stage.stage] === "filled",
  };

  return (
    <div className="app">
      <header className="hdr">
        <span className="logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: logoSvg(26) }} />
        <div className="brand">
          <h1>RBG Candidate</h1>
          <small>AI application co-pilot</small>
        </div>
        <div className="pills">
          <ServerPill />
          <button
            type="button"
            className={`pill ${keySource === "none" ? "warn" : "ok"}`}
            data-testid="key-pill"
            title={
              keySource === "yours" || keySource === "both"
                ? "Your own NVIDIA key (saved encrypted in the extension) is used"
                : keySource === "server"
                  ? "The server's NVIDIA key from .env is used"
                  : "No NVIDIA key — add one in Profile or in the server's .env"
            }
            onClick={() => setTab("settings")}
          >
            {keySource === "yours" || keySource === "both" ? "your key" : keySource === "server" ? ".env key" : "no key"}
          </button>
        </div>
      </header>

      <nav className="steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            type="button"
            className={`step${done[s.key] ? " done" : ""}`}
            aria-current={tab === s.key ? "step" : undefined}
            onClick={() => setTab(s.key)}
          >
            <span className="n" aria-hidden="true">
              {done[s.key] ? <Icon name="check" size={11} /> : i + 1}
            </span>
            {s.label}
          </button>
        ))}
      </nav>

      <main>
        {error !== null && (
          <div className="alert err" role="alert">
            {error}
          </div>
        )}
        {notice !== null && (
          <div className="alert info" role="status">
            {notice}
          </div>
        )}
        {tab === "settings" && <SettingsTab />}
        {tab === "prepare" && <PrepareTab />}
        {tab === "fill" && <FillTab />}
        {tab === "review" && <ReviewTab />}
      </main>

      <footer className="foot">{DISCLAIMER}</footer>
    </div>
  );
}
