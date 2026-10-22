import { ArrowUpRight, Clock3, Layers, ShieldQuestion } from "lucide-react";
import type { Market } from "../types";
import { formatBps, formatExact, marketStatusTone, outcomeLabel, outcomeTone } from "../lib/format";

interface MarketCardProps {
  market: Market;
  selected: boolean;
  onSelect: () => void;
  onInspect: () => void;
}

const CATEGORY_TONE: Record<string, string> = {
  TECH: "text-no border-no/30 bg-no/10",
  MACRO: "text-amber border-amber/30 bg-amber/10",
  AI: "text-violet border-violet/30 bg-violet/10",
  CRYPTO: "text-yes border-yes/30 bg-yes/10",
  SEMICONDUCTORS: "text-orange-300 border-orange-400/30 bg-orange-400/10",
  OTHER: "text-muted border-line bg-panel2",
};

export function MarketCard({ market, selected, onSelect, onInspect }: MarketCardProps) {
  const tone = marketStatusTone(market);
  const yesBps = market.implied_yes_prob_bps;
  const total = Math.max(1, market.yes_pool + market.no_pool);
  const yesWidth = Math.round((market.yes_pool / total) * 100);

  return (
    <article
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSelect();
      }}
      role="button"
      tabIndex={0}
      data-testid={`market-card-${market.market_id}`}
      className={`group relative cursor-pointer overflow-hidden rounded-xl border p-4 transition ${
        selected
          ? "border-yes/45 bg-panel2/90 shadow-glow"
          : "border-line bg-panel/80 hover:border-line hover:bg-panel2/70"
      }`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded border px-1.5 py-0.5 text-[9px] font-medium tracking-[0.1em] ${CATEGORY_TONE[market.category] ?? CATEGORY_TONE.OTHER}`}>
            {market.category}
          </span>
          <span className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-medium tracking-[0.08em] ${tone.className}`}>
            <span className={`h-1 w-1 rounded-full ${tone.dot}`} />
            {tone.label}
          </span>
          {market.status === "FINALIZED" ? (
            <span className={`rounded border border-line bg-obsidian/60 px-1.5 py-0.5 text-[9px] font-medium ${outcomeTone(market.provisional_outcome)}`}>
              {outcomeLabel(market.provisional_outcome)}
            </span>
          ) : null}
        </div>
        <span className="font-mono text-[10px] text-muted">#{market.market_id}</span>
      </div>

      <h3 className="mb-3 line-clamp-2 text-[13.5px] font-medium leading-snug text-ink">{market.question}</h3>

      <div className="mb-1.5 flex items-center justify-between text-[10px]">
        <span className="font-mono text-yes">YES {formatBps(yesBps)}</span>
        <span className="font-mono text-no">NO {formatBps(10000 - yesBps)}</span>
      </div>
      <div className="mb-3 flex h-2 overflow-hidden rounded-full bg-obsidian ring-1 ring-inset ring-line/70">
        <div
          className="h-full bg-gradient-to-r from-yes/70 to-yes transition-all duration-500"
          style={{ width: `${yesWidth}%` }}
        />
        <div className="h-full flex-1 bg-gradient-to-r from-no/70 to-no transition-all duration-500" />
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-[10px]">
        <div>
          <div className="uppercase tracking-[0.12em] text-muted">YES pool</div>
          <div className="font-mono text-ink">{formatExact(market.yes_pool)}</div>
        </div>
        <div>
          <div className="uppercase tracking-[0.12em] text-muted">NO pool</div>
          <div className="font-mono text-ink">{formatExact(market.no_pool)}</div>
        </div>
        <div>
          <div className="uppercase tracking-[0.12em] text-muted">Pot</div>
          <div className="font-mono text-amber">{formatExact(market.total_pot)}</div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line/70 pt-2.5">
        <div className="flex items-center gap-3 text-[10px] text-muted">
          {market.status === "CHALLENGE_WINDOW" && market.challenge_open ? (
            <span className="flex items-center gap-1 text-amber">
              <Clock3 size={11} /> window {market.countdown_epochs} epochs
            </span>
          ) : market.status === "REFUNDABLE_ZERO_WINNERS" || market.status === "EXPIRED" ? (
            <span className="flex items-center gap-1 text-orange-300">
              <ShieldQuestion size={11} /> refund {formatExact(market.unclaimed_refund_principal)}
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Layers size={11} /> {market.trade_count} trades
            </span>
          )}
          {market.forfeit_pot > 0 ? <span className="text-amber">+{formatExact(market.forfeit_pot)} bond pot</span> : null}
        </div>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onInspect();
          }}
          className="flex items-center gap-1 rounded border border-line bg-obsidian/60 px-2 py-1 text-[10px] text-muted transition hover:border-amber/40 hover:text-amber"
        >
          consensus <ArrowUpRight size={10} />
        </button>
      </div>
    </article>
  );
}
