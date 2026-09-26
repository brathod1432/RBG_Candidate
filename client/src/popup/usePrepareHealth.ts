// client/src/popup/usePrepareHealth.ts
// One health poller for the whole popup (header pill + Prepare step).
// Quick (2 s) while not ready, relaxed (10 s) when ready, backs off while down.
// `checkPrepareNow()` runs a check immediately (Prepare → "Check now").
import { useEffect } from "react";
import { hasApiKey } from "../utils/storage";
import { requestHealth } from "./chrome";
import { checksFrom, deriveStatus, nextDelay, POLL_BUSY_MS } from "./health";
import { usePopupStore } from "./store";

const NOW_EVENT = "rbg-check-now";

export function checkPrepareNow(): void {
  window.dispatchEvent(new Event(NOW_EVENT));
}

export async function runHealthCheck(): Promise<void> {
  const { setPrepare, prepareStatus } = usePopupStore.getState();
  if (prepareStatus === "unknown") setPrepare("checking");
  const [health, ownKey] = await Promise.all([
    requestHealth(),
    hasApiKey().catch(() => false),
  ]);
  const checks = checksFrom(health, ownKey);
  setPrepare(deriveStatus(checks), checks);
}

export function usePrepareHealth(): void {
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    let delay = POLL_BUSY_MS;
    let inFlight = false;

    const tick = async (): Promise<void> => {
      if (!alive || inFlight) return;
      inFlight = true;
      window.clearTimeout(timer);
      try {
        await runHealthCheck();
      } finally {
        inFlight = false;
      }
      if (!alive) return;
      delay = nextDelay(usePopupStore.getState().prepareStatus, delay);
      timer = window.setTimeout(() => void tick(), delay);
    };

    const now = (): void => void tick();
    const onVisible = (): void => {
      if (!document.hidden) void tick();
    };
    window.addEventListener(NOW_EVENT, now);
    window.addEventListener("focus", now);
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener(NOW_EVENT, now);
      window.removeEventListener("focus", now);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
