import React from "react";

export const monthCloseIconPath = "M8 3h8v4H8zM7 5H5v16h14V5h-2M8 12l2 2 5-5M8 18h8";

const paths = {
  add: "M12 5v14M5 12h14",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M18 6 6 18",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5",
  undo: "m9 15-6-6 6-6M3 9h12a6 6 0 0 1 0 12h-3",
  save: "M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8",
  refresh: "M20 7v5h-5M4 17v-5h5M6.1 6.1a8 8 0 0 1 13.3 3M4.6 14.9a8 8 0 0 0 13.3 3",
  warning: "M12 3 2 21h20L12 3Zm0 6v5m0 3h.01",
  calendar: "M4 5h16v16H4zM8 3v4m8-4v4M4 10h16",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5",
  moon: "M20.8 13.1A9 9 0 0 1 10.9 3.2 9 9 0 1 0 20.8 13.1Z",
  unlock: "M5 11h14v10H5V11ZM8 11V6a4 4 0 0 1 7.7-1.5M12 15v3",
  receipt: "M5 3h14v18l-3-2-4 2-4-2-3 2V3ZM8 7h8M8 11h8M8 15h4",
  monthClose: monthCloseIconPath,
  logout: "M9 3H4v18h5M13 7l5 5-5 5M8 12h10",
  lock: "M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4M12 14v3",
} as const;

export function ActionIcon({ name, size = 20 }: { name: keyof typeof paths; size?: number }) {
  return <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
