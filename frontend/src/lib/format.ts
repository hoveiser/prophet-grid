export function formatToken(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 10_000) return `${(value / 1_000).toFixed(1)}k`;
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function formatExact(value: number | undefined | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "0";
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

export function formatPpm(ppm: number): string {
  return `${(ppm / 1_000_000).toFixed(2)}x`;
}

export function shortAddress(address: string | null | undefined): string {
  if (!address) return "disconnected";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return "";
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

export function statusTone(status: string): { label: string; className: string; dot: string } {
  switch (status) {
    case "OPEN":
      return { label: "TRADING", className: "text-yes border-yes/40 bg-yes/10", dot: "bg-yes" };
    case "PROVISIONAL":
      return { label: "CHALLENGE WINDOW", className: "text-amber border-amber/40 bg-amber/10", dot: "bg-amber" };
    case "CHALLENGED":
      return { label: "RE-AUDIT PENDING", className: "text-orange-300 border-orange-400/40 bg-orange-400/10", dot: "bg-orange-400" };
    case "FINALIZED":
      return { label: "SETTLED", className: "text-violet border-violet/40 bg-violet/10", dot: "bg-violet" };
    default:
      return { label: status, className: "text-muted border-line bg-panel2", dot: "bg-muted" };
  }
}

export function marketStatusTone(market: { status: string; phase?: string; challenge_open?: boolean }): {
  label: string;
  className: string;
  dot: string;
} {
  if (market.status === "PROVISIONAL" && market.phase === "READY_TO_FINALIZE") {
    return { label: "READY TO FINALIZE", className: "text-amber border-amber/40 bg-amber/10", dot: "bg-amber" };
  }
  return statusTone(market.status);
}

export function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "OUTCOME_YES":
      return "YES";
    case "OUTCOME_NO":
      return "NO";
    case "OUTCOME_INVALID_REFUND":
      return "REFUND";
    default:
      return "PENDING";
  }
}

export function outcomeTone(outcome: string): string {
  switch (outcome) {
    case "OUTCOME_YES":
      return "text-yes";
    case "OUTCOME_NO":
      return "text-no";
    case "OUTCOME_INVALID_REFUND":
      return "text-amber";
    default:
      return "text-muted";
  }
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
