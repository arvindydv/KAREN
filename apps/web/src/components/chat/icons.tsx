import type { SVGProps } from 'react';

/** Small inline icons (decorative: always paired with a text label or aria-label). */
const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
  ...props,
});

export const IconSend = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M5 12h13M13 6l6 6-6 6" />
  </svg>
);
export const IconStop = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="7" y="7" width="10" height="10" rx="2" />
  </svg>
);
export const IconCopy = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
  </svg>
);
export const IconShield = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);
export const IconShare = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
  </svg>
);
export const IconRefresh = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </svg>
);
export const IconThumbUp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M7 11v9H4v-9zM7 11l4-7a2 2 0 0 1 3 2l-1 4h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7" />
  </svg>
);
export const IconThumbDown = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M17 13V4h3v9zM17 13l-4 7a2 2 0 0 1-3-2l1-4H6a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 7.2 4H17" />
  </svg>
);
export const IconEdit = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="M13 7l4 4" />
  </svg>
);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-4.5-4.5" />
  </svg>
);
export const IconPin = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9 4h6l-1 6 4 3H6l4-3zM12 13v7" />
  </svg>
);
export const IconMore = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="5" cy="12" r="1.3" />
    <circle cx="12" cy="12" r="1.3" />
    <circle cx="19" cy="12" r="1.3" />
  </svg>
);
export const IconArrowDown = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
);
export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2" />
  </svg>
);
export const IconMenu = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
