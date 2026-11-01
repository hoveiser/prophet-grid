import { useState } from "react";
import {
  BadgeCheck,
  Banknote,
  Coins,
  Gauge,
  Gavel,
  Landmark,
  Radar,
  ScrollText,
  Send,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { CHALLENGE_BOND_WEI, MIN_DEPOSIT_WEI } from "../config";
import type { DeskBook, PositionRow, SettlementSnapshot } from "../types";
import { bandLabel, bandTint, bps, dayTime, pgt, phaseLabel, untilCountdown } from "../lib/format";

interface Props {
  market: SettlementSnapshot | null;
  book: DeskBook | null;
  busy: string | null;
  writable: boolean;
  onStake: (side: "YES" | "NO", amountWei: bigint, native: boolean) => void;
  onResolve: (evidenceUrl: string) => void;
  onChallenge: (counterUrl: string, native: boolean) => void;
  onAudit: () => void;
  onFinalize: () => void;
  onClaim: () => void;
  onRefund: () => void;
  onSweepRefund: () => void;
  onOpenTelemetry: () => void;
}

const SIZE_STEPS = [1, 5, 10, 25];

export function LegTicket({
  market,
  book,
  busy,
  writable,
  onStake,
  onResolve,
  onChallenge,
  onAudit,
  onFinalize,
  onClaim,
  onRefund,
  onSweepRefund,
  onOpenTelemetry,
}: Props) {
  const [size, setSize] = useState(5);
  const [nativeLeg, setNativeLeg] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [counter, setCounter] = useState("");

  if (!market) {
    return (
      <section className="rail flex min-h-[320px] items-center justify-center px-6 py-10 text-center">
        <div>
          <Radar size={20} className="mx-auto text-dim" />
          <p className="mt-2 font-mono text-[11px] text-dim">
            select a book in the macro orderbook to load its strike, gates and settlement path
          </p>
        </div>
      </section>
    );
  }

  const position: PositionRow | undefined = book?.positions.find(
    (item) => item.market_id === market.market_id,
  );
  const amountWei = BigInt(Math.round(size * Number(MIN_DEPOSIT_WEI) * 100));
  const canAfford = (book?.balance_pgt ?? 0) >= amountWei;

  return (
    <section className="rail">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-panel/70 px-3 py-2">
        <BadgeCheck size={13} className="text-amber" />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink">
          leg ticket PG:{market.market_id}
        </span>
        <span className={`ml-auto font-mono text-[10px] ${bandTint(market.band)}`}>{bandLabel(market.band)}</span>
        <button
          onClick={onOpenTelemetry}
          className="border border-edge px-2 py-[2px] font-mono text-[9px] text-dim transition hover:border-cyan/45 hover:text-ink"
        >
          oracle telemetry
        </button>
      </div>

      <div className="px-3 py-2.5">
        <p className="text-[12px] leading-snug text-ink">{market.question}</p>
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-dim">{market.criteria}</p>
      </div>

      <div className="grid grid-cols-2 gap-px bg-edge/70 md:grid-cols-4">
        <Stat label="strike" main={bps(market.strike_bps)} note={`${market.strike_bps} bps grid`} />
        <Stat
          label="scalar corridor"
          main={bps(market.corridor_bps)}
          note={`band ${bps(Math.max(0, market.strike_bps - market.corridor_bps))} to ${bps(Math.min(10000, market.strike_bps + market.corridor_bps))}`}
        />
        <Stat
          label="adjudicated print"
          main={market.observed_bps > 0 ? bps(market.observed_bps) : "pending"}
          note={market.corroborated ? "dual sources agree" : "not corroborated"}
          tone={market.corroborated ? "text-bid" : "text-amber"}
        />
        <Stat
          label="fee sink"
          main={pgt(market.reserve_fee)}
          note={`distributable ${pgt(market.distributable)}`}
        />
      </div>

      <div className="grid gap-px bg-edge/70 md:grid-cols-3">
        <Gate label="intake closes" epoch={market.close_epoch} now={market.now} hint="no new legs after this" />
        <Gate
          label="challenge window"
          epoch={market.challenge_deadline_epoch}
          now={market.now}
          hint="claims blocked until elapsed"
        />
        <Gate
          label="resolution timeout"
          epoch={market.resolution_timeout_epoch}
          now={market.now}
          hint="principal refund path opens"
        />
      </div>

      <div className="border-t border-edge px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid-label">size</span>
          <input
            type="range"
            min={1}
            max={25}
            step={1}
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
            data-testid="leg-size"
            className="w-40"
          />
          <span className="font-mono text-[11px] text-ink">{pgt(amountWei)} PGT</span>
          <div className="flex gap-1">
            {SIZE_STEPS.map((step) => (
              <button
                key={step}
                onClick={() => setSize(step)}
                className={`border px-1.5 py-[1px] font-mono text-[9px] transition ${
                  size === step ? "border-amber/50 bg-amber/10 text-amber" : "border-edge text-dim hover:text-ink"
                }`}
              >
                {step}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-dim">
            <input
              type="checkbox"
              checked={nativeLeg}
              onChange={(event) => setNativeLeg(event.target.checked)}
              className="accent-[#00E5FF]"
            />
            settle leg with native deposit
          </label>
        </div>

        <div className="mt-2.5 grid gap-2 md:grid-cols-2">
          <button
            data-testid="stake-yes"
            disabled={!writable || !market.can_trade || (!nativeLeg && !canAfford) || busy !== null}
            onClick={() => onStake("YES", amountWei, nativeLeg)}
            className="flex items-center justify-center gap-2 border border-bid/40 bg-bid/10 py-2 font-mono text-[11px] text-bid transition enabled:hover:bg-bid/20 disabled:opacity-40"
          >
            <Send size={12} /> take YES depth
          </button>
          <button
            data-testid="stake-no"
            disabled={!writable || !market.can_trade || (!nativeLeg && !canAfford) || busy !== null}
            onClick={() => onStake("NO", amountWei, nativeLeg)}
            className="flex items-center justify-center gap-2 border border-cyan/40 bg-cyan/10 py-2 font-mono text-[11px] text-cyan transition enabled:hover:bg-cyan/20 disabled:opacity-40"
          >
            <Send size={12} /> take NO depth
          </button>
        </div>
      </div>

      <div className="grid gap-3 border-t border-edge px-3 py-3 md:grid-cols-2">
        <div>
          <div className="flex items-center gap-1.5">
            <Sparkles size={11} className="text-amber" />
            <span className="grid-label">trigger consensus adjudication</span>
          </div>
          <input
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
            placeholder={market.primary_url}
            className="mt-1.5 w-full border border-edge bg-rack px-2 py-1.5 font-mono text-[10px] text-ink outline-none placeholder:text-dim/60 focus:border-amber/45"
          />
          <button
            data-testid="resolve-btn"
            disabled={!writable || !market.can_resolve || busy !== null || evidence.length < 12}
            onClick={() => onResolve(evidence)}
            className="mt-1.5 w-full border border-amber/40 bg-amber/10 py-1.5 font-mono text-[10px] text-amber transition enabled:hover:bg-amber/20 disabled:opacity-40"
          >
            resolve with dual source print
          </button>
        </div>

        <div>
          <div className="flex items-center gap-1.5">
            <Gavel size={11} className="text-ask" />
            <span className="grid-label">file bonded challenge</span>
          </div>
          <input
            value={counter}
            onChange={(event) => setCounter(event.target.value)}
            placeholder="https://research.example.org/counter-print"
            className="mt-1.5 w-full border border-edge bg-rack px-2 py-1.5 font-mono text-[10px] text-ink outline-none placeholder:text-dim/60 focus:border-ask/45"
          />
          <div className="mt-1.5 flex gap-1.5">
            <button
              data-testid="challenge-btn"
              disabled={!writable || !market.can_challenge || busy !== null || counter.length < 12}
              onClick={() => onChallenge(counter, false)}
              className="flex-1 border border-ask/40 bg-ask/10 py-1.5 font-mono text-[10px] text-ask transition enabled:hover:bg-ask/20 disabled:opacity-40"
            >
              bond {pgt(CHALLENGE_BOND_WEI)} collateral
            </button>
            <button
              disabled={!writable || !market.can_challenge || busy !== null || counter.length < 12}
              onClick={() => onChallenge(counter, true)}
              className="border border-ask/40 bg-ask/10 px-2 py-1.5 font-mono text-[10px] text-ask transition enabled:hover:bg-ask/20 disabled:opacity-40"
              title="Post the bond from a native deposit and claim the surplus back"
            >
              native
            </button>
            <button
              data-testid="audit-btn"
              disabled={!writable || !market.can_audit || busy !== null}
              onClick={onAudit}
              className="border border-edge bg-rack px-2 py-1.5 font-mono text-[10px] text-ink transition hover:border-cyan/45 disabled:opacity-40"
            >
              re-audit
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-2 border-t border-edge px-3 py-3 md:grid-cols-3">
        <button
          data-testid="finalize-btn"
          disabled={!writable || !market.can_finalize || busy !== null}
          onClick={onFinalize}
          className="flex items-center justify-center gap-2 border border-violet/40 bg-violet/10 py-2 font-mono text-[10px] text-violet transition enabled:hover:bg-violet/20 disabled:opacity-40"
        >
          <Landmark size={12} /> lock settlement
        </button>
        <button
          data-testid="claim-btn"
          disabled={!writable || !market.can_claim || !(position && position.estimated_payout > 0) || busy !== null}
          onClick={onClaim}
          className="flex items-center justify-center gap-2 border border-bid/40 bg-bid/10 py-2 font-mono text-[10px] text-bid transition enabled:hover:bg-bid/20 disabled:opacity-40"
        >
          <Coins size={12} /> withdraw payout
        </button>
        <button
          data-testid="refund-btn"
          disabled={!writable || !market.can_refund || busy !== null}
          onClick={onRefund}
          className="flex items-center justify-center gap-2 border border-lime/40 bg-lime/10 py-2 font-mono text-[10px] text-lime transition enabled:hover:bg-lime/20 disabled:opacity-40"
        >
          <TriangleAlert size={12} /> recover principal
        </button>
      </div>

      <div className="border-t border-edge bg-panel/60 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <ScrollText size={12} className="text-dim" />
          <span className="grid-label">desk exposure on this leg</span>
          <span className="font-mono text-[10px] text-dim">phase {phaseLabel(market.phase)}</span>
          <span className="ml-auto font-mono text-[10px] text-ink">
            YES {pgt(position?.yes_shares ?? 0)} / NO {pgt(position?.no_shares ?? 0)}
          </span>
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Mini label="principal" value={pgt(position?.principal ?? 0)} />
          <Mini label="payable now" value={pgt(position?.estimated_payout ?? 0)} tone="text-bid" />
          <Mini label="refund path" value={pgt(position?.refund_amount ?? 0)} tone="text-lime" />
          <Mini label="pending" value={untilCountdown(market.now, market.challenge_deadline_epoch)} tone="text-amber" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-edge px-3 py-2">
        <Banknote size={12} className="text-amber" />
        <span className="grid-label">refund and margin ledger</span>
        <span className="font-mono text-[10px] text-ink">refundable {pgt(book?.refundable_wei ?? 0)} PGT</span>
        <button
          data-testid="claim-refundable"
          disabled={!writable || !book || book.refundable_wei <= 0 || busy !== null}
          onClick={onSweepRefund}
          className="border border-edge px-2 py-[2px] font-mono text-[9px] text-dim transition hover:border-amber/45 disabled:opacity-40"
        >
          sweep to spendable
        </button>
        <span className="ml-auto max-w-[320px] truncate font-mono text-[9px] text-ask">
          {book?.last_rejection ?? ""}
        </span>
      </div>
    </section>
  );
}

function Stat({
  label,
  main,
  note,
  tone,
}: {
  label: string;
  main: string;
  note: string;
  tone?: string;
}) {
  return (
    <div className="bg-carbon px-3 py-2">
      <div className="grid-label">{label}</div>
      <div className={`font-mono text-[13px] leading-tight tabular-nums ${tone ?? "text-ink"}`}>{main}</div>
      <div className="font-mono text-[9px] text-dim">{note}</div>
    </div>
  );
}

function Gate({ label, epoch, now, hint }: { label: string; epoch: number; now: number; hint: string }) {
  const elapsed = epoch > 0 && now >= epoch;
  return (
    <div className="bg-carbon px-3 py-2">
      <div className="flex items-center gap-1.5">
        <Gauge size={11} className={elapsed ? "text-bid" : "text-amber"} />
        <span className="grid-label">{label}</span>
      </div>
      <div className="mt-0.5 font-mono text-[11px] text-ink">
        {elapsed ? "elapsed" : untilCountdown(now, epoch)}
      </div>
      <div className="font-mono text-[9px] text-dim">
        {epoch > 0 ? dayTime(epoch) : "not scheduled"} · {hint}
      </div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border border-edge bg-rack/60 px-2 py-1">
      <div className="grid-label">{label}</div>
      <div className={`font-mono text-[11px] tabular-nums ${tone ?? "text-ink"}`}>{value}</div>
    </div>
  );
}
