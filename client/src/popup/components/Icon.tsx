// client/src/popup/components/Icon.tsx
// One small, consistent icon set (24-grid, 1.8 stroke, round caps) instead of
// Unicode glyphs that render differently on every OS.

const PATHS = {
  upload: "M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3",
  download: "M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3",
  check: "M5 12.5 10 17.5 19 7.5",
  arrowRight: "M5 12h14m0 0-5.5-5.5M19 12l-5.5 5.5",
  chevron: "M9 6l6 6-6 6",
  scan: "M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 12h10",
  key: "M14.5 9.5a4 4 0 1 1-2.2-3.57M14.5 9.5 21 16v3h-3v-2h-2v-2l-2.2-2.2",
  sparkle: "M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5zM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z",
  alert: "M12 8v5m0 3.5v.01M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zm0 0v5h5M9 13h6M9 17h4",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8a7 7 0 0 1 14 0",
  x: "M6 6l12 12M18 6 6 18",
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}): JSX.Element {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** "1 job" / "2 jobs" — no more "1 languages". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
