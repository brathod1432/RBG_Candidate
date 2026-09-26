// client/src/popup/components/PreviewModal.tsx
import { usePopupStore } from "../store";
import SourceBadge from "./SourceBadge";

interface PreviewModalProps {
  onClose: () => void;
  onSendToReview: () => void;
}

export default function PreviewModal({
  onClose,
  onSendToReview,
}: PreviewModalProps): JSX.Element | null {
  const scan = usePopupStore((s) => s.scan);
  const suggestions = usePopupStore((s) => s.suggestions);
  const selected = usePopupStore((s) => s.selected);
  const toggleField = usePopupStore((s) => s.toggleField);

  if (scan === null) {
    return null;
  }

  const entries = scan.descriptors;

  return (
    <div role="dialog" aria-modal="true" aria-label="Scan preview">
      <h3>Preview — stage {scan.stage.stage}</h3>
      <p>
        Confidence {scan.stage.confidence} ({scan.stage.reason})
      </p>
      <p>{scan.url}</p>
      {entries.length === 0 ? (
        <p>No fillable fields detected on this page.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Include</th>
              <th>Field</th>
              <th>Suggested value</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((d) => {
              const s = suggestions[d.id];
              return (
                <tr key={d.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected[d.id] ?? false}
                      onChange={() => toggleField(d.id)}
                      aria-label={`Include ${d.id}`}
                    />
                  </td>
                  <td title={d.selector}>{d.label || d.id}</td>
                  <td>{s?.value ? s.value.slice(0, 80) : "—"}</td>
                  <td>
                    <SourceBadge suggestion={s} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p>
        Review every value before filling. Nothing is filled or submitted from
        this preview.
      </p>
      <button type="button" onClick={onSendToReview}>
        Send to Review
      </button>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
