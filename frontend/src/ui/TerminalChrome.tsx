import {
  Activity,
  CircleGauge,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Volume2,
  VolumeX,
} from "lucide-react";
import { CHAIN_ID, NETWORK_LABEL, RELEASE_TAG, RUNNER_PIN } from "../config";
import type { PlatformStats, SettlementSnapshot } from "../types";
import { bandLabel, bps, clock, pgtShort, shortDesk } from "../lib/format";

interface ChromeProps {
  stats: PlatformStats | null;
  markets: SettlementSnapshot[];
  desk: string;
  mode: "local desk" | "injected wallet" | "watch only";
  silenced: boolean;
  live: boolean;
  onToggleAudio: () => void;
  onOpenDesk: () => void;
  onRefresh: () => void;
  onSelect: (marketId: string) => void;
}

export function TerminalChrome({
  stats,
  markets,
  desk,
  mode,
  silenced,
  live,
  onToggleAudio,
  onOpenDesk,
  onRefresh,
  onSelect,
}: ChromeProps) {
  const ok = stats?.invariant_ok ?? false;
  const tape = markets.slice(0, 6);

  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-carbon/92 backdrop-blur-md">
      <div className="flex items-stretch gap-3 px-4 pt-2.5">
        <div className="flex items-center gap-2.5">
          <div className="relative h-9 w-9 overflow-hidden rounded-[3px] border border-edge bg-panel">
            <img src="./logo.png" alt="ProphetGrid mark" className="h-full w-full object-cover" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold leading-none tracking-tight">PROPHETGRID</span>
              <span className="rounded-[2px] border border-amber/40 bg-amber/10 px-1.5 py-[1px] font-mono text-[9px] leading-none text-amber">
                {RELEASE_TAG}
              </span>
            </div>
            <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-dim">
              conditional macro desk
            </div>
          </div>
        </div>

        <div className="ml-1 hidden items-center gap-2 border border-edge bg-panel/70 px-2.5 py-1.5 lg:flex">
          <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-bid animate-blink" : "bg-dim"}`} />
          <span className="font-mono text-[10px] text-ink">{NETWORK_LABEL}</span>
          <span className="font-mono text-[10px] text-dim">{CHAIN_ID}</span>
          <span className="font-mono text-[10px] text-dim">{clock(stats?.epoch ?? 0)}</span>
          <span className="font-mono text-[9px] text-dim/70">UTC</span>
        </div>

        <div className="hidden flex-1 items-center gap-4 md:flex">
          <Readout label="backed custody" value={pgtShort(stats?.tvl ?? 0)} unit="PGT" tone="text-amber" />
          <Readout label="notional traded" value={pgtShort(stats?.total_volume ?? 0)} unit="PGT" tone="text-cyan" />
          <Readout label="settled" value={String(stats?.settlement_count ?? 0)} unit="books" tone="text-violet" />
          <Readout label="hedge book" value={pgtShort(stats?.hedge_reservations ?? 0)} unit="PGT" tone="text-lime" />
          <button
            onClick={onOpenDesk}
            className="flex items-center gap-2 border border-edge bg-panel/60 px-2.5 py-1.5 transition hover:border-amber/45"
            title="Open the desk session panel"
          >
            <ShieldCheck size={13} className={ok ? "text-bid" : "text-ask"} />
            <span className="font-mono text-[10px]">{ok ? "CUSTODY SOLVENT" : "CUSTODY CHECK PENDING"}</span>
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={onRefresh}
            className="border border-edge bg-panel/60 p-2 text-dim transition hover:border-cyan/45 hover:text-ink"
            title="Reload the desk snapshot"
          >
            <Activity size={13} />
          </button>
          <button
            onClick={onToggleAudio}
            className="border border-edge bg-panel/60 p-2 text-dim transition hover:border-amber/45 hover:text-ink"
            title={silenced ? "Enable terminal audio cues" : "Mute terminal audio cues"}
            aria-label={silenced ? "Enable terminal audio cues" : "Mute terminal audio cues"}
          >
            {silenced ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
          <button
            onClick={onOpenDesk}
            data-testid="desk-button"
            className="flex items-center gap-2 border border-amber/35 bg-amber/10 px-3 py-2 transition hover:bg-amber/15"
          >
            <CircleGauge size={13} className="text-amber" />
            <span className="font-mono text-[10px] text-ink">{shortDesk(desk)}</span>
            <span className="hidden font-mono text-[9px] uppercase tracking-wider text-amber xl:inline">{mode}</span>
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 border-t border-edge bg-panel/50 px-4 py-1.5">
        <Radio size={12} className="text-amber" />
        <div className="relative flex-1 overflow-hidden">
          <div className="flex w-[200%] animate-marquee gap-8 whitespace-nowrap">
            {[0, 1].map((pass) => (
              <div key={pass} className="flex flex-1 gap-8">
                {tape.map((row) => (
                  <button
                    key={`${pass}-${row.market_id}`}
                    onClick={() => onSelect(row.market_id)}
                    className="group flex items-center gap-2 font-mono text-[10px]"
                  >
                    <span className="text-dim group-hover:text-ink">PG:{row.market_id}</span>
                    <span className="text-amber">{row.category}</span>
                    <span className="text-ink">{bps(strikeImplied(row))}</span>
                    <span className="text-dim">{bandLabel(row.band)}</span>
                    <span className="text-dim/70">pot {pgtShort(row.pot)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="hidden items-center gap-2 font-mono text-[9px] text-dim xl:flex">
          <ShieldAlert size={11} className={ok ? "text-bid" : "text-ask"} />
          <span>runner {RUNNER_PIN}</span>
        </div>
      </div>
    </header>
  );
}

function strikeImplied(row: SettlementSnapshot): number {
  return row.observed_bps > 0 ? row.observed_bps : row.strike_bps;
}

function Readout({ label, value, unit, tone }: { label: string; value: string; unit: string; tone: string }) {
  return (
    <div className="min-w-[92px]">
      <div className="grid-label">{label}</div>
      <div className={`font-mono text-[13px] leading-tight tabular-nums ${tone}`}>
        {value}
        <span className="ml-1 text-[9px] text-dim">{unit}</span>
      </div>
    </div>
  );
}
