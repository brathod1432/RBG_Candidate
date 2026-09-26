// client/src/popup/tabs/FillTab.tsx  — step 2 "Scan"
import { requestScan, requestSuggestions, toMessage } from "../chrome";
import { selectFilled, usePopupStore } from "../store";
import Icon, { plural } from "../components/Icon";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch (_err: unknown) {
    return url;
  }
}

export default function FillTab(): JSX.Element {
  const scan = usePopupStore((s) => s.scan);
  const setScan = usePopupStore((s) => s.setScan);
  const scanning = usePopupStore((s) => s.scanning);
  const setScanning = usePopupStore((s) => s.setScanning);
  const setSelected = usePopupStore((s) => s.setSelected);
  const suggestions = usePopupStore((s) => s.suggestions);
  const setSuggestions = usePopupStore((s) => s.setSuggestions);
  const aiStatus = usePopupStore((s) => s.aiStatus);
  const prepareStatus = usePopupStore((s) => s.prepareStatus);
  const prepareChecks = usePopupStore((s) => s.prepareChecks);
  const aiInfo = usePopupStore((s) => s.aiInfo);
  const setAiStatus = usePopupStore((s) => s.setAiStatus);
  const scanStats = usePopupStore((s) => s.scanStats);
  const setScanStats = usePopupStore((s) => s.setScanStats);
  const server = usePopupStore((s) => s.server);
  const setTab = usePopupStore((s) => s.setTab);
  const setError = usePopupStore((s) => s.setError);
  const setNotice = usePopupStore((s) => s.setNotice);

  async function handleScan(): Promise<void> {
    setScanning(true);
    setError(null);
    setNotice(null);
    setSuggestions({});
    setScanStats(null);
    try {
      const result = await requestScan();
      setScan(result);
      const count = result.descriptors.length;
      setAiStatus("running", `${plural(count, "field")} to plan`);
      try {
        const ai = await requestSuggestions(result);
        setSuggestions(ai.suggestions);
        setSelected(selectFilled(ai.suggestions));
        if (ai.offline) {
          setAiStatus("offline", ai.reason ?? "server unreachable");
        } else if (ai.stats !== undefined) {
          const st = ai.stats;
          setScanStats({
            aiTasks: st.ai_tasks,
            workersUsed: st.workers_used,
            profileFields: st.profile_fields,
            seconds: st.duration_ms / 1000,
            models: st.models_used,
          });
          setAiStatus(
            "done",
            `${plural(st.ai_tasks, "AI task")} on ${plural(st.workers_used, "worker")} · ${st.profile_fields} from profile`,
          );
        } else {
          setAiStatus("done", null);
        }
      } catch (err: unknown) {
        setAiStatus("offline", toMessage(err));
      }
    } catch (err: unknown) {
      setError(toMessage(err));
      setAiStatus("idle");
    } finally {
      setScanning(false);
    }
  }

  const fieldCount = scan ? scan.descriptors.length : 0;
  const filledCount = Object.values(suggestions).filter((s) => s.value !== "").length;
  const totalWorkers = server?.online ? server.workers : 15;
  const used = scanStats?.workersUsed ?? 0;
  const running = scanning || aiStatus === "running";

  return (
    <>
      <section className="card hero" aria-label="Scan this page">
        <div className="pageinfo">
          <span className="fav" aria-hidden="true">{scan ? hostOf(scan.url).replace(/^www\./, "").charAt(0).toUpperCase() : <Icon name="scan" />}</span>
          <div style={{ minWidth: 0 }}>
            <div className="t">{scan?.job.title ?? "Open a job application form"}</div>
            <div className="u">
              {scan ? `${hostOf(scan.url)} · stage ${scan.stage.stage} · ${plural(fieldCount, "field")}` : "then scan it — nothing is filled yet"}
            </div>
          </div>
        </div>

        {!running && prepareStatus !== "ready" && prepareStatus !== "unknown" && prepareStatus !== "checking" && (
          <button type="button" className="status running linkish" onClick={() => setTab("prepare")} data-testid="warmup">
            <Icon name={prepareStatus === "down" ? "alert" : "sparkle"} size={14} />
            <span>
              {prepareStatus === "down"
                ? "AI server offline — scan will use profile matches only. Open Prepare"
                : !prepareChecks.apiKey
                  ? "No NVIDIA key — AI answers off. Open Prepare"
                  : `Starting AI workers… ${prepareChecks.workers}/${prepareChecks.workersTotal}. Open Prepare`}
            </span>
          </button>
        )}

        <button type="button" className="btn primary block" onClick={() => void handleScan()} disabled={running}>
          {!running && <Icon name="scan" />}
          {running ? "Scanning & asking AI workers…" : scan ? "Scan again" : "Scan this page"}
        </button>

        <div>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <p className="eyebrow">AI worker pool</p>
            <span className="muted" style={{ fontSize: 11 }}>
              {running ? "working…" : scanStats ? `${used} of ${totalWorkers} used` : `${totalWorkers} ready`}
            </span>
          </div>
          <div
            className={`workers${running ? " run" : scanStats ? " done" : ""}`}
            aria-hidden="true"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(totalWorkers, 30))}, 1fr)` }}
          >
            {Array.from({ length: Math.max(1, Math.min(totalWorkers, 30)) }, (_, i) => (
              <i key={i} className={scanStats && i >= used ? "idle" : undefined} />
            ))}
          </div>
        </div>

        {aiStatus !== "idle" && (
          <p className={`status ${aiStatus}`} data-testid="ai-status" data-status={aiStatus} role="status">
            <Icon name={aiStatus === "offline" ? "alert" : aiStatus === "done" ? "check" : "sparkle"} size={14} className={aiStatus === "running" ? "spin" : undefined} />
            <span>
              {aiStatus === "running" ? "Coordinator is assigning fields to workers…" : aiStatus === "offline" ? "AI unavailable — profile matches only" : "Done"}
              {aiInfo !== null && aiStatus !== "running" ? ` · ${aiInfo}` : ""}
            </span>
          </p>
        )}
      </section>

      {scanStats !== null && (
        <section className="card" aria-label="Scan results">
          <div className="tiles">
            <div className="tile">
              <b>{fieldCount}</b>
              <span>fields</span>
            </div>
            <div className="tile">
              <b>{scanStats.aiTasks}</b>
              <span>AI tasks</span>
            </div>
            <div className="tile">
              <b>{scanStats.workersUsed}</b>
              <span>workers</span>
            </div>
            <div className="tile">
              <b>{scanStats.seconds.toFixed(1)}</b>
              <span>seconds</span>
            </div>
          </div>
          {scanStats.models.length > 0 && (
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 11 }}>
              Models: <code>{scanStats.models.map((m) => m.split("/").pop()).join(", ")}</code>
            </p>
          )}
        </section>
      )}

      {scan !== null && !running && (
        <button type="button" className="btn primary block" onClick={() => setTab("review")}>
          Review {plural(filledCount, "value")} <Icon name="arrowRight" />
        </button>
      )}
    </>
  );
}
