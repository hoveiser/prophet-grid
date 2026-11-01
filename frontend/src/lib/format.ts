import { BAND_LABEL, PHASE_LABEL } from "../config";

const WEI = 10n ** 18n;

export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") return Number(value) || 0;
  if (typeof value === "bigint") return Number(value);
  return 0;
}

/** Render an atto scale collateral amount with the desk precision. */
export function pgt(value: unknown, digits = 3): string {
  const raw = BigInt(Math.round(toNumber(value)));
  const whole = raw / WEI;
  const fraction = (raw % WEI) / (10n ** 15n);
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(3, "0").slice(0, digits)}`;
}

export function pgtShort(value: unknown): string {
  const amount = toNumber(value) / 1e18;
  if (Math.abs(amount) >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (Math.abs(amount) >= 1_000) return `${(amount / 1_000).toFixed(1)}k`;
  return amount.toFixed(amount >= 100 ? 0 : 2);
}

export function bps(value: unknown): string {
  return `${(toNumber(value) / 100).toFixed(1)}%`;
}

export function multiple(value: unknown): string {
  return `${(toNumber(value) / 10_000).toFixed(3)}x`;
}

export function weiToEth(value: unknown): string {
  return (toNumber(value) / 1e18).toFixed(4);
}

export function bandLabel(band: string): string {
  return BAND_LABEL[band] ?? band ?? "NO PRINT";
}

export function phaseLabel(phase: string): string {
  return PHASE_LABEL[phase] ?? phase;
}

export function statusTint(status: string): string {
  switch (status) {
    case "OPEN":
      return "text-[#00E5FF] border-[#00E5FF]/35 bg-[#00E5FF]/10";
    case "PROVISIONAL":
      return "text-[#FF9500] border-[#FF9500]/35 bg-[#FF9500]/10";
    case "CHALLENGED":
      return "text-[#FB7185] border-[#FB7185]/35 bg-[#FB7185]/10";
    case "FINALIZED":
      return "text-[#A78BFA] border-[#A78BFA]/35 bg-[#A78BFA]/10";
    case "REFUNDED":
      return "text-[#10B981] border-[#10B981]/35 bg-[#10B981]/10";
    default:
      return "text-slate-400 border-slate-600/40 bg-slate-700/10";
  }
}

export function bandTint(band: string): string {
  if (band === "YES_CONFIRMED_FINAL") return "text-[#10B981]";
  if (band === "NO_CONFIRMED_FINAL") return "text-[#FB7185]";
  if (band === "CONDITIONAL_SCALAR_SPLIT") return "text-[#FF9500]";
  if (band === "INVALID_OR_AMBIGUOUS_REFUND") return "text-[#FACC15]";
  return "text-slate-400";
}

export function clock(epoch: number): string {
  if (!epoch) return "--:--:--";
  return new Date(epoch * 1000).toISOString().slice(11, 19);
}

export function dayTime(epoch: number): string {
  if (!epoch) return "not scheduled";
  return new Date(epoch * 1000).toISOString().slice(5, 16).replace("T", " ");
}

export function untilCountdown(now: number, target: number): string {
  const delta = Math.max(0, Math.round(target - now));
  if (delta === 0) return "elapsed";
  const parts = [Math.floor(delta / 3600), Math.floor((delta % 3600) / 60), delta % 60];
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}

export function shortHash(value: string | null | undefined): string {
  if (!value) return "pending";
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

export function shortDesk(value: string | null | undefined): string {
  if (!value) return "no desk";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function relativeTime(secondsAgo: number): string {
  if (secondsAgo < 60) return `${Math.max(0, Math.round(secondsAgo))}s ago`;
  if (secondsAgo < 3600) return `${Math.round(secondsAgo / 60)}m ago`;
  return `${Math.round(secondsAgo / 3600)}h ago`;
}
