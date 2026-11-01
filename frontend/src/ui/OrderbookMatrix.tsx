import { ChevronRight, Layers3, Link2, Timer } from "lucide-react";
import type { HedgeRow, PositionRow, SettlementSnapshot } from "../types";
import {
  bandLabel,
  bandTint,
  bps,
  dayTime,
  pgt,
  pgtShort,
  phaseLabel,
  statusTint,
  untilCountdown,
} from "../lib/format";

interface Props {
  markets: SettlementSnapshot[];
  selected: string | null;
  positions: PositionRow[];
  hedges: HedgeRow[];
  busy: string | null;
  onSelect: (marketId: string) => void;
  onReleaseHedge: (hedge: HedgeRow) => void;
  onOpenWorkspace: (marketId: string) => void;
}

export function OrderbookMatrix({
  markets,
  selected,
  positions,
  hedges,
  busy,
  onSelect,
  onReleaseHedge,
  onOpenWorkspace,
}: Props) {
  return (
    <section className="rail scanline relative overflow-hidden">
      <div className="flex items-center justify-between border-b border-edge bg-panel/70 px-3 py-2">
        <div className="flex items-center gap-2">
          <Layers3 size={13} className="text-amber" />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink">
            macro orderbook and conditional hedge matrix
          </span>
        </div>
        <span className="font-mono text-[10px] text-dim">{markets.length} books listed</span>
      </div>

      <div className="hidden grid-cols-[1.6fr_repeat(7,minmax(78px,auto))] gap-2 border-b border-edge/70 px-3 py-1.5 md:grid">
        {[
          "instrument",
          "state",
          "strike",
          "corridor",
          "print",
          "depth yes",
          "depth no",
          "gate",
        ].map((head) => (
          <span key={head} className="grid-label">
            {head}
          </span>
        ))}
      </div>

      <div className="divide-y divide-edge/60">
        {markets.map((row) => {
          const mine = positions.find((item) => item.market_id === row.market_id);
          const total = Math.max(1, row.yes_pool + row.no_pool);
          const yesPct = Math.round((row.yes_pool / total) * 100);
          const active = selected === row.market_id;
          return (
            <div
              key={row.market_id}
              data-testid={`book-row-${row.market_id}`}
              className={`grid grid-cols-1 gap-2 px-3 py-2.5 transition md:grid-cols-[1.6fr_repeat(7,minmax(78px,auto))] ${
                active ? "bg-amber/[0.06]" : "hover:bg-rack/60"
              }`}
            >
              <button onClick={() => onSelect(row.market_id)} className="flex items-start gap-2 text-left">
                <ChevronRight
                  size={13}
                  className={`mt-0.5 shrink-0 ${active ? "text-amber" : "text-dim/60"}`}
                />
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11px] text-ink">{row.question}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="border border-edge px-1.5 py-[1px] font-mono text-[9px] text-dim">
                      PG:{row.market_id}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-cyan">{row.category}</span>
                    <span className={`font-mono text-[9px] ${bandTint(row.band)}`}>{bandLabel(row.band)}</span>
                    {mine && mine.principal > 0 ? (
                      <span className="font-mono text-[9px] text-lime">
                        book {pgt(mine.yes_shares)}Y / {pgt(mine.no_shares)}N
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>

              <div>
                <span
                  className={`inline-flex items-center border px-1.5 py-[2px] font-mono text-[9px] uppercase tracking-wider ${statusTint(row.status)}`}
                >
                  {row.status}
                </span>
                <div className="mt-1 font-mono text-[9px] text-dim">{phaseLabel(row.phase)}</div>
              </div>

              <Cell value={bps(row.strike_bps)} note={`${row.strike_bps} bps`} />
              <Cell value={bps(row.corridor_bps)} note={`+/- ${row.corridor_bps}`} />
              <Cell
                value={row.observed_bps > 0 ? bps(row.observed_bps) : "no print"}
                note={row.corroborated ? "dual source ok" : "awaiting corroboration"}
                tone={row.corroborated ? "text-bid" : "text-amber"}
              />

              <DepthBar pct={yesPct} amount={pgtShort(row.yes_pool)} tone="bg-bid" label="yes" />
              <DepthBar
                pct={100 - yesPct}
                amount={pgtShort(row.no_pool)}
                tone="bg-cyan"
                label="no"
                note={`budget ${pgtShort(row.yes_budget)}/${pgtShort(row.no_budget)}`}
              />

              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-1 font-mono text-[10px] text-dim">
                  <Timer size={10} className="text-amber" />
                  {row.challenge_deadline_epoch > 0
                    ? untilCountdown(row.now, row.challenge_deadline_epoch)
                    : untilCountdown(row.now, row.close_epoch)}
                </span>
                <span className="font-mono text-[9px] text-dim/80">
                  {row.challenge_deadline_epoch > 0
                    ? `close ${dayTime(row.challenge_deadline_epoch)}`
                    : `intake ${dayTime(row.close_epoch)}`}
                </span>
                <button
                  onClick={() => onOpenWorkspace(row.market_id)}
                  className="border border-edge px-1.5 py-[2px] font-mono text-[9px] text-dim transition hover:border-amber/40 hover:text-ink"
                >
                  workspace
                </button>
              </div>
            </div>
          );
        })}
        {markets.length === 0 ? (
          <div className="px-3 py-8 text-center font-mono text-[11px] text-dim">
            no conditional books on this deployment yet
          </div>
        ) : null}
      </div>

      <div className="border-t border-edge bg-panel/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <Link2 size={12} className="text-lime" />
          <span className="grid-label">cross-market hedge baskets</span>
          <span className="ml-auto font-mono text-[10px] text-dim">
            reserved {pgt(hedges.reduce((sum, item) => sum + item.reservation, 0))} PGT
          </span>
        </div>
        <div className="mt-2 space-y-1.5">
          {hedges.map((hedge) => (
            <div
              key={hedge.hedge_id}
              data-testid={`hedge-${hedge.hedge_id}`}
              className="flex flex-wrap items-center gap-2 border border-edge bg-rack/60 px-2 py-1.5"
            >
              <span className="font-mono text-[10px] text-ink">BASKET {hedge.hedge_id}</span>
              <span className="font-mono text-[10px] text-dim">
                PG:{hedge.primary_market_id} {hedge.primary_side} x PG:{hedge.hedge_market_id} {hedge.hedge_side}
              </span>
              <span className="font-mono text-[10px] text-lime">
                coll {pgt(hedge.collateral)} / res {pgt(hedge.reservation)}
              </span>
              <span className="font-mono text-[10px] text-dim">
                weights {hedge.primary_weight_bps}+{hedge.hedge_weight_bps} bps
              </span>
              <span
                className={`font-mono text-[9px] uppercase ${
                  hedge.state === "RELEASED" ? "text-bid" : "text-amber"
                }`}
              >
                {hedge.state}
              </span>
              {hedge.state === "LOCKED" ? (
                <button
                  onClick={() => onReleaseHedge(hedge)}
                  disabled={busy !== null || hedge.unlock_epoch > Math.floor(Date.now() / 1000)}
                  className="ml-auto border border-lime/40 bg-lime/10 px-2 py-[2px] font-mono text-[9px] text-lime transition enabled:hover:bg-lime/20 disabled:opacity-40"
                  title={`Unlocks at epoch ${hedge.unlock_epoch}`}
                >
                  release
                </button>
              ) : (
                <span className="ml-auto font-mono text-[10px] text-bid">paid {pgt(hedge.paid)}</span>
              )}
            </div>
          ))}
          {hedges.length === 0 ? (
            <div className="font-mono text-[10px] text-dim">
              no baskets reserved on this desk; pair opposite legs across two books
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Cell({ value, note, tone }: { value: string; note: string; tone?: string }) {
  return (
    <div>
      <div className={`font-mono text-[11px] tabular-nums ${tone ?? "text-ink"}`}>{value}</div>
      <div className="font-mono text-[9px] text-dim">{note}</div>
    </div>
  );
}

function DepthBar({
  pct,
  amount,
  tone,
  label,
  note,
}: {
  pct: number;
  amount: string;
  tone: string;
  label: string;
  note?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between font-mono text-[10px]">
        <span className="text-dim">{label}</span>
        <span className="text-ink">{amount}</span>
      </div>
      <div className="mt-1 h-1.5 w-full bg-edge/60">
        <div className={`h-full ${tone}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
      </div>
      {note ? <div className="mt-0.5 font-mono text-[9px] text-dim/80">{note}</div> : null}
    </div>
  );
}
