import React from "react";

export function ChannelIcon({ channel }: { channel: "cash" | "tng" }) {
  return <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {channel === "cash" ? <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M6 12h.01M18 12h.01" /></> : <><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 5h4M11 19h2" /></>}
  </svg>;
}
