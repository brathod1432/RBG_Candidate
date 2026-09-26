// client/src/agents/logo.ts
// Brand mark: three fanned cursors (R · G · B) — the agent crew. Used in the
// popup header, the on-page panel, and rendered to the toolbar icons.

const ARROW = "M0 0 L0 17.5 L4.9 13.2 L8.1 20.4 L11.3 19 L8.2 12 L14.9 11.8 Z";

const CURSORS: Array<{ color: string; x: number; y: number; r: number }> = [
  { color: "#EF4444", x: 3, y: 3.5, r: -14 },
  { color: "#22C55E", x: 11.5, y: 6.5, r: 0 },
  { color: "#3B82F6", x: 19.5, y: 10.5, r: 12 },
];

/** Inline SVG markup for the logo at any size (square). */
export function logoSvg(size = 20, stroke = "#fff"): string {
  const parts = CURSORS.map(
    (c) =>
      `<path d="${ARROW}" transform="translate(${c.x} ${c.y}) rotate(${c.r})" fill="${c.color}" ` +
      `stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/>`,
  ).join("");
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 36 36" aria-hidden="true" ` +
    `xmlns="http://www.w3.org/2000/svg">${parts}</svg>`
  );
}
