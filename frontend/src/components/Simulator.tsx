import { useMemo, useState } from "react";
import { CircleDollarSign, FlaskConical, Sigma } from "lucide-react";
import { boundaryPreview, simulate } from "../lib/math";
import { formatBps, formatExact, formatPpm, outcomeLabel } from "../lib/format";
import type { Market, OutcomeBand } from "../types";
import { Gauge } from "./Gauge";

interface SimulatorProps {
  market: Market | null;
}

const BANDS: { value: OutcomeBand; label: string; tone: string }[] = [
  { value: "OUTCOME_YES", label: "YES", tone: "text-yes border-yes/50 bg-yes/10" },
  { value: "OUTCOME_NO", label: "NO", tone: "text-no border-no/50 bg-no/10" },
  { value: "OUTCOME_INVALID_REFUND", label: "REFUND", tone: "text-amber border-amber/50 bg-amber/10" },
];

export function Simulator({ market }: SimulatorProps) {
  const [yesPool, setYesPool] = useState(market ? Math.max(1, market.yes_pool) : 300);
  const [noPool, setNoPool] = useState(market ? Math.max(1, market.no_pool) : 200);
  const [stake, setStake] = useState(100);
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [band, setBand] = useState<OutcomeBand>("OUTCOME_YES");

  const result = useMemo(() => simulate({ yesPool, noPool, stake, side, band }), [yesPool, noPool, stake, side, band]);
  const boundaries = useMemo(
    () => boundaryPreview({ yesPool, noPool, stake, side, band }),
    [yesPool, noPool, stake, side, band],
  );

  const maxPool = Math.max(yesPool, noPool, 1000);

  return (
    <div className="space-y-4" data-testid="simulator">
      <div className="rounded-xl border border-line bg-panel/80 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
            <FlaskConical size={13} /> what-if conditional simulator
          </div>
          <span className="rounded border border-line bg-obsidian/60 px-1.5 py-0.5 font-mono text-[9px] text-muted">
            parimutuel
          </span>
        </div>

        <div className="mb-4 flex rounded-lg border border-line bg-obsidian/60 p-0.5">
          {(["YES", "NO"] as const).map((option) => (
            <button
              key={option}
              onClick={() => setSide(option)}
              className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition ${
                side === option
                  ? option === "YES"
                    ? "bg-yes/15 text-yes"
                    : "bg-no/15 text-no"
                  : "text-muted hover:text-ink"
              }`}
            >
              buy {option}
            </button>
          ))}
        </div>

        <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
          <span>YES pool</span>
          <span className="font-mono text-yes">{formatExact(yesPool)}</span>
        </div>
        <input
          type="range"
          min={1}
          max={maxPool}
          step={1}
          value={Math.min(yesPool, maxPool)}
          onChange={(event) => setYesPool(Number(event.target.value))}
          className="slider slider-yes mb-4"
          aria-label="YES pool"
        />

        <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
          <span>NO pool</span>
          <span className="font-mono text-no">{formatExact(noPool)}</span>
        </div>
        <input
          type="range"
          min={1}
          max={maxPool}
          step={1}
          value={Math.min(noPool, maxPool)}
          onChange={(event) => setNoPool(Number(event.target.value))}
          className="slider slider-no mb-4"
          aria-label="NO pool"
        />

        <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
          <span>your stake</span>
          <span className="font-mono text-ink">{formatExact(stake)} PGT</span>
        </div>
        <input
          type="range"
          min={1}
          max={2000}
          step={1}
          value={stake}
          onChange={(event) => setStake(Number(event.target.value))}
          className="slider slider-amber mb-4"
          aria-label="your stake"
        />

        <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-muted">resolution band</div>
        <div className="grid grid-cols-3 gap-1.5">
          {BANDS.map((option) => (
            <button
              key={option.value}
              onClick={() => setBand(option.value)}
              className={`rounded-md border px-1.5 py-1.5 text-[10px] font-medium transition ${
                band === option.value ? option.tone : "border-line bg-obsidian/50 text-muted hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-panel/80 p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-muted">implied YES</div>
            <div className="font-mono text-[11px] text-ink">{formatBps(result.impliedYesBps)}</div>
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-[0.18em] text-muted">multiple</div>
            <div className="font-mono text-[11px] text-amber">{result.payoutMultiplePpm ? formatPpm(result.payoutMultiplePpm) : "n/a"}</div>
          </div>
        </div>
        <div className="flex justify-center">
          <Gauge valueBps={result.impliedYesBps} tone={result.payoutMultiplePpm >= 1_000_000 ? "yes" : "no"} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-line bg-obsidian/50 p-2.5">
            <div className="text-[9px] uppercase tracking-[0.14em] text-muted">payout if {outcomeLabel(result.band)}</div>
            <div className="font-mono text-[15px] text-ink">{formatExact(result.payout)}</div>
            <div className={`font-mono text-[10px] ${result.roiBps >= 0 ? "text-yes" : "text-danger"}`}>
              ROI {formatBps(result.roiBps)}
            </div>
          </div>
          <div className="rounded-lg border border-line bg-obsidian/50 p-2.5">
            <div className="text-[9px] uppercase tracking-[0.14em] text-muted">total pot</div>
            <div className="font-mono text-[15px] text-ink">{formatExact(result.totalPot)}</div>
            <div className="font-mono text-[10px] text-muted">win pool {formatExact(result.winningPool)}</div>
          </div>
        </div>

        <div className="mt-2 rounded-lg border border-amber/25 bg-amber/5 p-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] text-amber">
              <Sigma size={11} /> dust conservation
            </div>
            <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${result.conservationOk ? "bg-yes/10 text-yes" : "bg-danger/10 text-danger"}`}>
              {result.conservationOk ? "BALANCED" : "OFF BY DUST"}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-muted">
            <span>yours {formatExact(result.payout)}</span>
            <span>others {formatExact(result.otherPayouts)}</span>
            <span className="text-amber">dust {formatExact(result.dustToLastClaimant)}</span>
          </div>
          <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-obsidian">
            <span className="h-full bg-yes" style={{ width: `${result.totalPot ? (result.payout / result.totalPot) * 100 : 0}%` }} />
            <span className="h-full bg-no" style={{ width: `${result.totalPot ? (result.otherPayouts / result.totalPot) * 100 : 0}%` }} />
            <span className="h-full bg-amber" style={{ width: `${result.totalPot ? (result.dustToLastClaimant / result.totalPot) * 100 : 0}%` }} />
          </div>
          <p className="mt-1.5 text-[9px] leading-relaxed text-muted">
            The last claimant receives the rounding dust so the sum of payouts equals the pot exactly.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-panel/80 p-4">
        <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted">
          <CircleDollarSign size={12} /> boundary preview
        </div>
        <div className="space-y-1.5">
          {boundaries.map((row) => (
            <div key={row.band} className="flex items-center justify-between rounded border border-line/70 bg-obsidian/40 px-2 py-1.5 text-[10px]">
              <span className={row.band === "OUTCOME_YES" ? "text-yes" : row.band === "OUTCOME_NO" ? "text-no" : "text-amber"}>
                {outcomeLabel(row.band)}
              </span>
              <span className="font-mono text-muted">
                {formatExact(row.payout)} <span className="text-line">|</span> ROI {formatBps(row.roiBps)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
