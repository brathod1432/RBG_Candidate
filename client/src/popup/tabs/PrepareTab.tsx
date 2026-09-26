// client/src/popup/tabs/PrepareTab.tsx — step 2 "Prepare"
// Merged: the health checks from the Prepare-tab work (server reachable,
// NVIDIA key configured, workers active), restyled in the design system.
// Status comes from the single popup-wide poller (usePrepareHealth).
import { usePopupStore } from "../store";
import Icon, { plural } from "../components/Icon";
import { checkPrepareNow } from "../usePrepareHealth";
import type { PrepareStatus } from "../health";

const STATUS_TEXT: Record<PrepareStatus, string> = {
  unknown: "Not checked yet",
  checking: "Checking…",
  ready: "Ready",
  degraded: "Partly ready",
  down: "Server offline",
};

type Tone = "ok" | "warn" | "bad" | "wait";

function CheckRow({
  label,
  detail,
  tone,
  value,
}: {
  label: string;
  detail: string;
  tone: Tone;
  value: string;
}): JSX.Element {
  return (
    <div className={`chk ${tone}`} role="listitem" aria-label={`${label}: ${value}`}>
      <span className="chk-ic" aria-hidden="true">
        <Icon name={tone === "ok" ? "check" : tone === "bad" ? "x" : tone === "warn" ? "alert" : "sparkle"} size={13} />
      </span>
      <span className="chk-txt">
        <b>{label}</b>
        <small>{detail}</small>
      </span>
      <span className={`pill ${tone === "wait" ? "" : tone}`}>{value}</span>
    </div>
  );
}

export default function PrepareTab(): JSX.Element {
  const status = usePopupStore((s) => s.prepareStatus);
  const c = usePopupStore((s) => s.prepareChecks);
  const last = usePopupStore((s) => s.prepareLastCheckedAt);
  const setTab = usePopupStore((s) => s.setTab);
  const waiting = status === "unknown" || status === "checking";

  const keyDetail =
    c.keySource === "both"
      ? "Server .env key + your own key (yours is used)"
      : c.keySource === "server"
        ? "Using the server's key from .env"
        : c.keySource === "yours"
          ? "Using your own key, saved encrypted in the extension"
          : "Add NVIDIA_API_KEY to .env, or save your key in Profile";

  return (
    <>
      <section className="card" aria-label="Prepare">
        <div className="card-h">
          <div>
            <p className="eyebrow">Before you scan</p>
            <h2 className="title">Is the AI backend ready?</h2>
          </div>
          <div className="right">
            <span
              className={`pill ${status === "ready" ? "ok" : status === "down" ? "bad" : status === "degraded" ? "warn" : ""}`}
              data-testid="overall-status"
              role="status"
              aria-live="polite"
            >
              {STATUS_TEXT[status]}
            </span>
          </div>
        </div>

        <div className="checks" role="list" aria-label="Health checks">
          <CheckRow
            label="Server reachable"
            detail="Local API at 127.0.0.1:8000"
            tone={waiting ? "wait" : c.server ? "ok" : "bad"}
            value={waiting ? "…" : c.server ? "online" : "offline"}
          />
          <CheckRow
            label="NVIDIA API key"
            detail={keyDetail}
            tone={waiting ? "wait" : c.apiKey ? "ok" : c.server ? "warn" : "bad"}
            value={waiting ? "…" : c.apiKey ? "configured" : "missing"}
          />
          <CheckRow
            label="AI workers"
            detail={c.models.length > 0 ? c.models.map((m) => m.split("/").pop()).join(", ") : "Coordinator + worker pool"}
            tone={waiting ? "wait" : c.workersTotal > 0 && c.workers >= c.workersTotal ? "ok" : c.workers > 0 ? "warn" : "bad"}
            value={waiting ? "…" : `${c.workers}/${c.workersTotal || "–"}`}
          />
        </div>

        {status === "down" && (
          <p className="status offline" role="alert">
            <Icon name="alert" size={14} />
            <span>
              The local AI server isn&apos;t running. Double-click <code>scripts\start-server.bat</code> in the project folder
              and keep its window open. You can still fill from your profile without it.
            </span>
          </p>
        )}
        {status === "degraded" && !c.apiKey && (
          <p className="status running">
            <Icon name="key" size={14} />
            <span>No NVIDIA key yet — AI answers are off; profile matches still work.</span>
          </p>
        )}
        {status === "degraded" && c.apiKey && c.workers < c.workersTotal && (
          <p className="status running">
            <Icon name="sparkle" size={14} />
            <span>
              {plural(c.workers, "worker")} of {c.workersTotal} available — the rest are cooling down or have no usable model.
            </span>
          </p>
        )}

        <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
          <span className="muted" style={{ fontSize: 11 }}>
            {last !== null ? `Checked ${new Date(last).toLocaleTimeString()}` : "Checking automatically"}
          </span>
          <button type="button" className="btn secondary sm" onClick={checkPrepareNow}>
            Check now
          </button>
        </div>
      </section>

      <button
        type="button"
        className="btn primary block"
        data-testid="continue-to-fill"
        onClick={() => setTab("fill")}
      >
        {status === "ready" ? "Continue to scan" : "Continue anyway"} <Icon name="arrowRight" />
      </button>
    </>
  );
}
