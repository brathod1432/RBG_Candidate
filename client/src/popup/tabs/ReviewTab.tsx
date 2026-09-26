// client/src/popup/tabs/ReviewTab.tsx  — step 3 "Review & fill"
import { useState } from "react";
import type { FieldDescriptor, FieldMap } from "../../types/index";
import type { FillRequestMessage } from "../chrome";
import { requestFill, toMessage } from "../chrome";
import { getFillPrefs } from "../../utils/storage";
import { DEFAULT_FILL_PREFS } from "../../agents/palette";
import { usePopupStore } from "../store";
import SourceBadge from "../components/SourceBadge";
import Icon from "../components/Icon";

type Filter = "all" | "ai" | "profile" | "empty";

export default function ReviewTab(): JSX.Element {
  const scan = usePopupStore((s) => s.scan);
  const suggestions = usePopupStore((s) => s.suggestions);
  const editSuggestion = usePopupStore((s) => s.editSuggestion);
  const selected = usePopupStore((s) => s.selected);
  const toggleField = usePopupStore((s) => s.toggleField);
  const filling = usePopupStore((s) => s.filling);
  const setFilling = usePopupStore((s) => s.setFilling);
  const stageDecisions = usePopupStore((s) => s.stageDecisions);
  const setStageDecision = usePopupStore((s) => s.setStageDecision);
  const setTab = usePopupStore((s) => s.setTab);
  const setError = usePopupStore((s) => s.setError);
  const setNotice = usePopupStore((s) => s.setNotice);
  const [filter, setFilter] = useState<Filter>("all");
  const aiStatus = usePopupStore((st) => st.aiStatus);

  if (scan === null) {
    return (
      <section className="card empty">
        <b>Nothing to review yet</b>
        Scan a job application page first.
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn secondary" onClick={() => setTab("fill")}>
            Go to Scan
          </button>
        </div>
      </section>
    );
  }

  const stage = scan.stage.stage;
  const decision = stageDecisions[stage] ?? "pending";
  const entries = scan.descriptors;
  const sourceOf = (d: FieldDescriptor): "ai" | "profile" | "empty" => {
    const s = suggestions[d.id];
    if (!s || s.value === "") return "empty";
    return s.source === "ai" ? "ai" : "profile";
  };
  const counts = {
    all: entries.length,
    ai: entries.filter((d) => sourceOf(d) === "ai").length,
    profile: entries.filter((d) => sourceOf(d) === "profile").length,
    empty: entries.filter((d) => sourceOf(d) === "empty").length,
  };
  const visible = filter === "all" ? entries : entries.filter((d) => sourceOf(d) === filter);
  const checkedEntries = entries.filter((d) => selected[d.id] ?? false);
  const ready = checkedEntries.filter((d) => (suggestions[d.id]?.value ?? "") !== "").length;

  async function handleFill(): Promise<void> {
    const values: Record<string, string> = {};
    const selectors: FieldMap = {};
    const meta: NonNullable<FillRequestMessage["meta"]> = {};
    for (const d of checkedEntries) {
      const s = suggestions[d.id];
      const value = s?.value ?? "";
      if (value !== "") {
        values[d.id] = value;
        selectors[d.id] = d.selector;
        const m: { label?: string; workerId?: number; model?: string } = { label: d.label || d.id };
        if (s?.source === "ai" && s.workerId !== undefined) {
          m.workerId = s.workerId;
        }
        if (s?.source === "ai" && s.model !== undefined) {
          m.model = s.model;
        }
        meta[d.id] = m;
      }
    }
    if (Object.keys(values).length === 0) {
      setError("No checked fields have values to fill. Add values or save a profile first.");
      return;
    }
    setFilling(true);
    setError(null);
    setNotice(null);
    try {
      const prefs = await getFillPrefs().catch(() => DEFAULT_FILL_PREFS);
      const message: FillRequestMessage = { type: "FILL", stage, values, selectors, meta };
      if (prefs.animate) {
        message.animate = { agents: prefs.agents, speed: prefs.speed };
        setNotice(`${prefs.agents} typing agent(s) are filling the page… (Esc on the page finishes instantly)`);
      }
      const { filled, perAgent } = await requestFill(message);
      setStageDecision(stage, "filled");
      const crew =
        perAgent !== undefined && Object.keys(perAgent).length > 0
          ? ` (${Object.entries(perAgent).map(([n, c]) => `${n} ${c}`).join(", ")})`
          : "";
      setNotice(`Stage ${stage} filled with ${filled} confirmed field(s)${crew}. Review the page, then submit it yourself.`);
    } catch (err: unknown) {
      setError(toMessage(err));
    } finally {
      setFilling(false);
    }
  }

  function handleSkip(): void {
    setStageDecision(stage, "skipped");
    setError(null);
    setNotice(`Stage ${stage} skipped. Nothing was filled.`);
  }

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 className="title">Review — stage {stage}</h2>
        <span className={`pill ${decision === "filled" ? "ok" : decision === "skipped" ? "warn" : ""}`}>{decision}</span>
      </div>

      {aiStatus === "offline" && (
        <p className="status running" data-testid="review-offline-note">
          <Icon name="alert" size={14} />
          <span>AI was unavailable during the scan, so only profile values are filled in. Filling still works; rescan once Prepare shows Ready for AI answers.</span>
        </p>
      )}

      <div className="filters" role="group" aria-label="Filter fields">
        {(["all", "ai", "profile", "empty"] as const).map((f) => (
          <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "ai" ? "AI" : f === "profile" ? "Profile" : "Empty"} <b>{counts[f]}</b>
          </button>
        ))}
      </div>

      <div className="rv">
        {visible.length === 0 && (
          <div className="card empty">
            <b>No fields here</b>
            {entries.length === 0 ? "No fillable fields were detected on this page." : "Try another filter."}
          </div>
        )}
        {visible.map((d) => {
          const s = suggestions[d.id];
          const value = s?.value ?? "";
          const on = selected[d.id] ?? false;
          return (
            <div key={d.id} className={`fr${on ? "" : " off"}${s?.source === "ai" && value !== "" ? " ai" : ""}`}>
              <input type="checkbox" checked={on} onChange={() => toggleField(d.id)} aria-label={`Confirm ${d.id}`} />
              <div className="lbl" title={d.selector}>
                <span>{d.label || d.id}</span>
                {d.required && <span className="muted" aria-label="required">*</span>}
                <span className="meta">
                  {s?.source === "ai" && value !== "" && (
                    <span className="conf" title={`confidence ${Math.round((s.confidence ?? 0) * 100)}%`}>
                      <i style={{ width: `${Math.round((s.confidence ?? 0) * 100)}%` }} />
                    </span>
                  )}
                  <SourceBadge suggestion={s} />
                </span>
              </div>
              <div className="val">
                {d.type === "select" ? (
                  <select
                    className="inp"
                    aria-label={`Value for ${d.id}`}
                    value={value}
                    onChange={(e) => editSuggestion(d.id, e.target.value)}
                  >
                    <option value="">—</option>
                    {d.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : d.type === "textarea" ? (
                  <textarea
                    className="inp"
                    aria-label={`Value for ${d.id}`}
                    value={value}
                    rows={3}
                    onChange={(e) => editSuggestion(d.id, e.target.value)}
                  />
                ) : (
                  <input
                    className="inp"
                    aria-label={`Value for ${d.id}`}
                    type="text"
                    value={value}
                    placeholder="(empty — type a value)"
                    onChange={(e) => editSuggestion(d.id, e.target.value)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="sticky">
        <button type="button" className="btn primary" onClick={() => void handleFill()} disabled={filling || ready === 0}>
          {filling ? "Agents are typing…" : `Fill ${ready} field${ready === 1 ? "" : "s"}`}
        </button>
        <button type="button" className="btn secondary" onClick={handleSkip} disabled={filling}>
          Skip stage {stage}
        </button>
      </div>
    </>
  );
}
