import type { SVGProps } from 'react';

/**
 * Inline icon set — 24px grid, 1.75 stroke, round caps, to match the reference
 * app's weight. Inlined rather than pulled from a package so the whole set
 * ships in the precache and nothing renders blank on first offline load.
 */
type P = SVGProps<SVGSVGElement>;

const base = (props: P) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  width: 24,
  height: 24,
  ...props,
});

export const IconHome = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.8V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.8" />
  </svg>
);

export const IconDiet = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 3v8a2.5 2.5 0 0 1-2.5 2.5h0A2.5 2.5 0 0 1 2 11V3" />
    <path d="M4.5 3v10.5M4.5 13.5V21" />
    <path d="M17 3c-1.7 1.4-2.5 3.4-2.5 5.5S15.3 12.6 17 14v7" />
    <path d="M20 3v18" />
  </svg>
);

export const IconPlans = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <path d="m8.5 15 2 2 4-4" />
  </svg>
);

export const IconStreak = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3s5.5 4.2 5.5 9a5.5 5.5 0 1 1-11 0c0-1.9.8-3.6 1.8-5 .3 1.2 1 2 1.9 2.3C10.4 7.6 11.2 5.2 12 3Z" />
  </svg>
);

export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconMinus = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
  </svg>
);

export const IconCamera = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8h2.6l1.3-2.2a1 1 0 0 1 .87-.5h6.46a1 1 0 0 1 .87.5L17.4 8H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13.5" r="3.2" />
  </svg>
);

export const IconCameraPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 9a1 1 0 0 1 1-1h2.6l1.3-2.2a1 1 0 0 1 .87-.5h4.1" />
    <path d="M21 12.5V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9" />
    <circle cx="12" cy="13.5" r="3.2" />
    <path d="M17.5 3v5M20 5.5h-5" />
  </svg>
);

export const IconBarcode = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M7 8v8M10 8v8M13.5 8v8M17 8v8" />
  </svg>
);

export const IconMic = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
  </svg>
);

export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IconSparkle = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3.5 13.6 9 19 10.5 13.6 12 12 17.5 10.4 12 5 10.5 10.4 9 12 3.5Z" />
    <path d="M18.5 16.5 19.2 18.8 21.5 19.5 19.2 20.2 18.5 22.5 17.8 20.2 15.5 19.5 17.8 18.8 18.5 16.5Z" />
  </svg>
);

export const IconScale = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M8 9h8" />
    <path d="M12 15v-2.5M12 12.5 10 11" />
  </svg>
);

export const IconFlame = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3c.4 2.6-1 3.7-2.3 5C8.2 9.5 7 11 7 13.4A5 5 0 0 0 12 21a5 5 0 0 0 5-7.6c-.5-1.4-1.6-2.3-2.2-3.6-.6 1-1.3 1.5-2.2 1.8.8-2.4.7-5.5-.6-8.6Z" />
  </svg>
);

export const IconSteps = (p: P) => (
  <svg {...base(p)}>
    <path d="M6.5 3.5c1.7 0 2.6 1.6 2.6 3.6 0 1.4-.4 2.4-.4 3.6 0 1 .5 1.6.5 2.6 0 1.4-1 2.2-2.4 2.2S4 14.9 4 13.5c0-1.1.5-1.7.5-2.7 0-1.2-.4-2.1-.4-3.6 0-2 .9-3.7 2.4-3.7Z" />
    <path d="M6.7 18.2c1.1 0 1.9.6 1.9 1.6s-.8 1.7-1.9 1.7-1.9-.7-1.9-1.7.8-1.6 1.9-1.6Z" />
    <path d="M17.5 6.5c1.5 0 2.4 1.7 2.4 3.7 0 1.5-.4 2.4-.4 3.6 0 1 .5 1.6.5 2.7 0 1.4-1 2.2-2.4 2.2s-2.4-.8-2.4-2.2c0-1 .5-1.6.5-2.6 0-1.2-.4-2.2-.4-3.6 0-2 .9-3.8 2.2-3.8Z" />
  </svg>
);

export const IconMoon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </svg>
);

export const IconWater = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 5h12l-1.1 14.2a2 2 0 0 1-2 1.8H9.1a2 2 0 0 1-2-1.8L6 5Z" />
    <path d="M6.5 11h11" />
  </svg>
);

export const IconDroplet = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3.2c2.8 3.2 5.5 6 5.5 9.3a5.5 5.5 0 1 1-11 0c0-3.3 2.7-6.1 5.5-9.3Z" />
  </svg>
);

export const IconDumbbell = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12" />
  </svg>
);

export const IconUser = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="3.75" />
    <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
  </svg>
);

export const IconChevronRight = (p: P) => (
  <svg {...base(p)}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);

export const IconChevronDown = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 9 7 7 7-7" />
  </svg>
);

export const IconChevronLeft = (p: P) => (
  <svg {...base(p)}>
    <path d="m15 5-7 7 7 7" />
  </svg>
);

export const IconChevronUp = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 15 7-7 7 7" />
  </svg>
);

export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6.5 7 7.4 20a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9L17.5 7" />
    <path d="M10.5 11v6M13.5 11v6" />
  </svg>
);

export const IconSettings = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.2a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1v-.2a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </svg>
);

export const IconChat = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 12a8 8 0 0 1-8 8H8l-4 2.5V17a8 8 0 0 1 5-15h.5A8 8 0 0 1 21 12Z" />
  </svg>
);

export const IconGallery = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L16 17M14.5 15l1.7-1.7a2 2 0 0 1 2.8 0L21 15.5" />
  </svg>
);

export const IconEdit = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="m14.5 6.5 3 3" />
  </svg>
);

export const IconInfo = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.75h.01" />
  </svg>
);

export const IconWarning = (p: P) => (
  <svg {...base(p)}>
    <path d="M10.3 3.9 2.6 17.3A2 2 0 0 0 4.3 20.3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4.5M12 17h.01" />
  </svg>
);

export const IconDownload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" />
  </svg>
);

export const IconUpload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" />
    <path d="M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" />
  </svg>
);

export const IconRefresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 11.5A8 8 0 0 0 6.2 6.2L4 8.4" />
    <path d="M4 4v4.5h4.5" />
    <path d="M4 12.5a8 8 0 0 0 13.8 5.3L20 15.6" />
    <path d="M20 20v-4.5h-4.5" />
  </svg>
);

export const IconSend = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 12 20 4l-5 16-3.4-6.6L4.5 12Z" />
  </svg>
);

export const IconTorch = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 3h6v3.5l-1.2 2.2v11a1.3 1.3 0 0 1-1.3 1.3h-1a1.3 1.3 0 0 1-1.3-1.3v-11L9 6.5V3Z" />
    <path d="M9 6.5h6" />
  </svg>
);

export const IconLock = (p: P) => (
  <svg {...base(p)}>
    <rect x="4.5" y="10" width="15" height="10.5" rx="2" />
    <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
  </svg>
);

export const IconShare = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 15V3.5M8 7l4-3.5L16 7" />
    <path d="M5 13v6.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V13" />
  </svg>
);
