import type { SVGProps } from 'react';

/* SVG icon set.
 *
 * Rules:
 *   - 16x16 viewBox, currentColor stroke, 1.75px stroke-width. Renders
 *     crisply at 14, 16, 18, 20px. Sized via font-size in the parent.
 *   - No fills; line icons only. Matches the rest of the app's
 *     hairline-first vocabulary.
 *   - stroke-linecap=round, stroke-linejoin=round — soft terminations
 *     read as "made by a person," not "manufactured by a machine."
 *   - Every icon is a single forwardRef component so it can be used
 *     inside a <button> without breaking the button's flex layout.
 *
 * Naming follows Lucide's convention so any future migration is a
 * drop-in (just `import { RefreshCw } from 'lucide-react'`). */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...rest,
  };
}

export function RefreshCw(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M13.5 8a5.5 5.5 0 0 1-9.36 3.89M2.5 8a5.5 5.5 0 0 1 9.36-3.89" />
      <path d="M13.5 3.5v3h-3M2.5 12.5v-3h3" />
    </svg>
  );
}

export function Settings(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="2" />
      <path d="M13.5 8a5.5 5.5 0 0 0-.1-1l1.1-0.9-1-1.7-1.4 0.4a5.5 5.5 0 0 0-1.7-1L10 2.5h-2L7.6 3.8a5.5 5.5 0 0 0-1.7 1L4.5 4.4l-1 1.7 1.1 0.9a5.5 5.5 0 0 0 0 2L3.5 9.9l1 1.7 1.4-0.4a5.5 5.5 0 0 0 1.7 1L8 13.5h2l0.4-1.3a5.5 5.5 0 0 0 1.7-1l1.4 0.4 1-1.7-1.1-0.9a5.5 5.5 0 0 0 .1-1z" />
    </svg>
  );
}

export function HelpCircle(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.2 6.2a1.8 1.8 0 1 1 2.5 1.7c-0.5 0.2-0.7 0.6-0.7 1.1V9.5" />
      <path d="M8 11.8v0.2" />
    </svg>
  );
}

export function ExternalLink(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M9 2.5h4.5V7" />
      <path d="M13.5 2.5 7 9" />
      <path d="M12.5 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1h3" />
    </svg>
  );
}

export function X(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="m3 3 10 10M13 3 3 13" />
    </svg>
  );
}

export function ChevronDown(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

export function ChevronUp(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="m4 10 4-4 4 4" />
    </svg>
  );
}

export function ChevronLeft(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="m10 4-4 4 4 4" />
    </svg>
  );
}

export function ChevronRight(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
}

export function ArrowRight(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M2.5 8h11M9.5 4l4 4-4 4" />
    </svg>
  );
}

export function ArrowLeft(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M13.5 8h-11M6.5 4l-4 4 4 4" />
    </svg>
  );
}

export function Plus(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function Minus(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M3 8h10" />
    </svg>
  );
}

export function Search(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="7" cy="7" r="4" />
      <path d="m13.5 13.5-3-3" />
    </svg>
  );
}

export function Check(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="m3 8 3.5 3.5L13 5" />
    </svg>
  );
}

export function Copy(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2H3.5A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
    </svg>
  );
}

export function Trash2(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M2.5 4.5h11" />
      <path d="M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
      <path d="M4 4.5 4.5 13a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1L12 4.5" />
      <path d="M6.5 7v4M9.5 7v4" />
    </svg>
  );
}

export function Star({
  filled,
  ...rest
}: IconProps & { filled?: boolean }): JSX.Element {
  return (
    <svg {...base(rest)} fill={filled ? 'currentColor' : 'none'}>
      <path d="M8 2.2 9.8 5.7l3.9 0.6-2.8 2.7 0.7 3.9L8 11l-3.6 1.9 0.7-3.9L2.3 6.3l3.9-0.6z" />
    </svg>
  );
}

export function GitMerge(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="4" cy="3.5" r="1.5" />
      <circle cx="4" cy="12.5" r="1.5" />
      <circle cx="12" cy="6" r="1.5" />
      <path d="M4 5v6" />
      <path d="M4 10c0-2 1.5-3.5 4-3.5 2 0 3 0 4-2" />
    </svg>
  );
}

export function GitPullRequest(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="4" cy="3.5" r="1.5" />
      <circle cx="4" cy="12.5" r="1.5" />
      <circle cx="12" cy="6" r="1.5" />
      <path d="M4 5v6" />
      <path d="M12 7.5c-2 0-3-1-3-3" />
    </svg>
  );
}

export function GitBranch(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="4" cy="3.5" r="1.5" />
      <circle cx="4" cy="12.5" r="1.5" />
      <circle cx="12" cy="6" r="1.5" />
      <path d="M4 5v6" />
      <path d="M12 7.5c-2.5 0-4-1.5-4-3.5" />
    </svg>
  );
}

// Lucide's `git-commit`: a centered circle with a horizontal line passing
// through it, terminating at the icon's left/right edges. Used by the
// Activity timeline for per-commit rows.
export function GitCommit(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="2.5" />
      <line x1="1" y1="8" x2="5.5" y2="8" />
      <line x1="10.5" y1="8" x2="15" y2="8" />
    </svg>
  );
}

export function MoreHorizontal(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="3.5" cy="8" r="1" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="12.5" cy="8" r="1" />
    </svg>
  );
}

export function Filter(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M2.5 3h11l-4.2 5.2v4.3l-2.6 1.5V8.2z" />
    </svg>
  );
}

export function Eye(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.75" />
    </svg>
  );
}

export function EyeOff(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M2 8s2.5-4.5 6-4.5c1 0 2 0.2 2.8 0.5" />
      <path d="M14 8s-1 1.7-2.8 3" />
      <path d="M6.5 9.7a1.8 1.8 0 0 0 2.6-2.5" />
      <path d="m2 2 12 12" />
    </svg>
  );
}

export function AlertCircle(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5" />
      <path d="M8 11h.01" />
    </svg>
  );
}

export function AlertTriangle(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M8 2.5 1.7 13.2h12.6z" />
      <path d="M8 6.5v3" />
      <path d="M8 11.5h.01" />
    </svg>
  );
}

export function MessageSquare(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M2.5 3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6.5L4 13.5V11.5H3.5a1 1 0 0 1-1-1z" />
    </svg>
  );
}

export function FileText(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M3.5 2.5h6L13 6v7a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" />
      <path d="M9.5 2.5V6H13" />
      <path d="M5 8.5h6M5 11h4" />
    </svg>
  );
}

export function Folder(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M2 4.5a1 1 0 0 1 1-1h3.5l1.5 1.5h5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
    </svg>
  );
}

export function Clock(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 1.5" />
    </svg>
  );
}

export function Sun(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.3 3.3l1.4 1.4M11.3 11.3l1.4 1.4M3.3 12.7l1.4-1.4M11.3 4.7l1.4-1.4" />
    </svg>
  );
}

export function Moon(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7z" />
    </svg>
  );
}

export function Monitor(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="3" width="11" height="8.5" rx="1" />
      <path d="M5.5 14h5M8 11.5V14" />
    </svg>
  );
}

export function User(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" />
    </svg>
  );
}

export function Key(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="4.5" cy="11.5" r="2" />
      <path d="M6.2 10.2 13 3.5M10.5 6 12 7.5" />
    </svg>
  );
}

export function Edit3(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M11.5 2.5 13.5 4.5 5 13H3v-2z" />
      <path d="M10 4 12 6" />
    </svg>
  );
}

export function CheckCircle(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="6" />
      <path d="m5 8 2 2 4-4.5" />
    </svg>
  );
}

export function XCircle(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="6" />
      <path d="m5.5 5.5 5 5M10.5 5.5l-5 5" />
    </svg>
  );
}

export function Reply(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M9 4 4 8l5 4" />
      <path d="M4 8h7a3 3 0 0 1 3 3v2" />
    </svg>
  );
}

export function ArrowUp(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M8 14V3" />
      <path d="m4 7 4-4 4 4" />
    </svg>
  );
}

export function ArrowDown(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M8 2v11" />
      <path d="m4 9 4 4 4-4" />
    </svg>
  );
}

export function ArrowUpRight(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M5 13 13 5" />
      <path d="M7 5h6v6" />
    </svg>
  );
}

export function Wifi(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M2 6.5a9 9 0 0 1 12 0" />
      <path d="M4.5 9.5a6 6 0 0 1 7 0" />
      <path d="M7 12.5a3 3 0 0 1 2 0" />
      <circle cx="8" cy="14.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function Triangle(props: IconProps): JSX.Element {
  return (
    <svg {...base(props)}>
      <path d="M8 3 2.5 13.5h11z" />
    </svg>
  );
}

/* Sidebar/panel toggle — a framed rect with a left column, the universal
 * "show/hide the left panel" glyph (VS Code, Linear). The left column fills
 * when the panel is open so the single button reads its own state. */
export function PanelLeft({
  filled,
  ...rest
}: IconProps & { filled?: boolean }): JSX.Element {
  return (
    <svg {...base(rest)}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M6 3v10" />
      {filled && <rect x="2.5" y="3" width="3.5" height="10" fill="currentColor" stroke="none" />}
    </svg>
  );
}
