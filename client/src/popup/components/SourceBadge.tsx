// client/src/popup/components/SourceBadge.tsx
import type { Suggestion } from "../../types/index";
import Icon from "./Icon";

/** Where a value came from: profile, which AI worker/model, or nothing. */
export default function SourceBadge({
  suggestion,
}: {
  suggestion: Suggestion | undefined;
}): JSX.Element {
  if (suggestion === undefined || suggestion.source === "none" || suggestion.value === "") {
    return (
      <span className="badge none" data-source="none" title={suggestion?.error ?? "No value found"}>
        needs value
      </span>
    );
  }
  if (suggestion.source === "profile") {
    return (
      <span className="badge profile" data-source="profile">
        profile
      </span>
    );
  }
  const model = suggestion.model?.split("/").pop();
  return (
    <span className="badge ai" data-source="ai" title={suggestion.model ?? ""}>
      <Icon name="sparkle" size={11} />
      AI{suggestion.workerId !== undefined ? ` · w${suggestion.workerId}` : ""}
      {model !== undefined && <code>{model}</code>}
    </span>
  );
}
