import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Clock3,
  Gavel,
  Lock,
  RefreshCcw,
  ScanSearch,
  ShieldAlert,
  Timer,
} from "lucide-react";
import type { Market, Position } from "../types";
import { formatBps, formatExact, marketStatusTone, outcomeLabel, outcomeTone } from "../lib/format";

interface MarketDetailProps {
  market: Market | null;
  position: Position | undefined;
  busy: string | null;
  onBuy: (side: "YES" | "NO", amount: number) => void;
  onClaim: () => void;
  onChallenge: (url: string) => void;
  onAudit: () => void;
  onResolve: (url: string) => void;
  onFinalize: () => void;
  onTick: () => void;
  onInspect: () => void;
}

export function MarketDetail({
  market,
  position,
  busy,
  onBuy,
  onClaim,
  onChallenge,
  onAudit,
  onResolve,
  onFinalize,
  onTick,
  onInspect,
}: MarketDetailProps) {
  const [amount, setAmount] = useState(50);
  const [counterUrl, setCounterUrl] = useState("https://research.example.com/counter-evidence");
  const [evidenceUrl, setEvidenceUrl] = useState("https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/eip-7691.md");
  const [operatorOpen, setOperatorOpen] = useState(false);

  if (!market) {
    return (
      <div className="rounded-xl border border-line bg-panel/70 p-6 text-center">
        <ScanSearch className="mx-auto mb-2 text-line" size={26} />
        <p className="text-[12px] text-muted">Select a market to trade, challenge or settle it.</p>
      </div>
    );
  }

  const tone = marketStatusTone(market);
  const isOpen = market.status === "OPEN";
  const isProvisional = market.status === "PROVISIONAL";
  const isChallenged = market.status === "CHALLENGED";
  const isFinalized = market.status === "FINALIZED";
  const canClaim = isFinalized && Boolean(position) && position?.payout_quote !== undefined && (position?.payout_quote ?? 0) > 0;

  return (
    <div className="space-y-3" data-testid="market-detail">
      <div className="rounded-xl border border-line bg-panel/80 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded border border-line bg-panel2 px-1.5 py-0.5 text-[9px] tracking-[0.1em] text-muted">{market.category}</span>
          <span className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-medium ${tone.className}`}>
            <span className={`h-1 w-1 rounded-full ${tone.dot}`} />
            {tone.label}
          </span>
          <span className={`rounded border border-line bg-obsidian/60 px-1.5 py-0.5 text-[9px] font-medium ${outcomeTone(market.provisional_outcome)}`}>
            {outcomeLabel(market.provisional_outcome)}
          </span>
          <span className="ml-auto font-mono text-[10px] text-muted">#{market.market_id}</span>
        </div>

        <h2 className="text-[14px] font-medium leading-snug text-ink">{market.question}</h2>
        <p className="mt-2 line-clamp-3 text-[10.5px] leading-relaxed text-muted">{market.resolution_criteria}</p>

        <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
          <Cell label="YES" value={formatExact(market.yes_pool)} tone="text-yes" />
          <Cell label="NO" value={formatExact(market.no_pool)} tone="text-no" />
          <Cell label="POT" value={formatExact(market.total_pot)} tone="text-amber" />
          <Cell label="LEFT" value={formatExact(market.remaining_liability)} tone="text-ink" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-muted">
          <a
            href={market.primary_source_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded border border-line bg-obsidian/60 px-2 py-1 transition hover:text-no"
          >
            primary source <ArrowUpRight size={10} />
          </a>
          {market.evidence_url ? (
            <a
              href={market.evidence_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded border border-line bg-obsidian/60 px-2 py-1 transition hover:text-yes"
            >
              filed evidence <ArrowUpRight size={10} />
            </a>
          ) : null}
          <button
            onClick={onInspect}
            className="flex items-center gap-1 rounded border border-line bg-obsidian/60 px-2 py-1 transition hover:border-amber/40 hover:text-amber"
          >
            consensus receipt <ArrowUpRight size={10} />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-panel/80 p-4">
        <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted">
          <Clock3 size={12} /> settlement timeline
        </div>
        <div className="space-y-2">
          <Step done label={`Market created at step ${market.created_at_step}`} />
          <Step done={market.resolved_at_step > 0} label={market.resolved_at_step > 0 ? `Verdict ${outcomeLabel(market.provisional_outcome)} at step ${market.resolved_at_step}, confidence anchor ${market.confidence_anchor}` : "Awaiting live resolution"} />
          <Step
            done={market.challenge_deadline_step > 0 && !market.challenge_open}
            active={market.challenge_open || isChallenged}
            label={
              market.status === "CHALLENGED"
                ? `Re-audit pending, bond ${formatExact(market.challenge_bond_locked)} locked`
                : market.challenge_deadline_step > 0
                  ? `Challenge window closes at step ${market.challenge_deadline_step} (${market.countdown_steps} left)`
                  : "Challenge window not open"
            }
          />
          <Step done={isFinalized} active={market.settlement_ready && !isFinalized} label={isFinalized ? `Settled at step ${market.finalized_at_step}` : "Claims locked until the window closes"} />
        </div>
      </div>

      <div className="rounded-xl border border-line bg-panel/80 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted">your position</div>
          {position ? (
            <span className="font-mono text-[10px] text-muted">
              {formatExact(position.yes_shares)} YES / {formatExact(position.no_shares)} NO
            </span>
          ) : (
            <span className="font-mono text-[10px] text-muted">no shares</span>
          )}
        </div>

        {isOpen ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(event) => setAmount(Math.max(1, Number(event.target.value)))}
                className="w-full rounded-md border border-line bg-obsidian/70 px-2 py-1.5 font-mono text-[11px] text-ink outline-none focus:border-yes/50"
                aria-label="trade amount"
              />
              <span className="rounded bg-panel2 px-2 py-1.5 font-mono text-[10px] text-muted">PGT</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onBuy("YES", amount)}
                disabled={busy !== null}
                className="rounded-lg border border-yes/40 bg-yes/10 px-3 py-2 text-[11px] font-medium text-yes transition hover:bg-yes/20 disabled:opacity-40"
              >
                {busy === "buy" ? "signing..." : "Buy YES"}
              </button>
              <button
                onClick={() => onBuy("NO", amount)}
                disabled={busy !== null}
                className="rounded-lg border border-no/40 bg-no/10 px-3 py-2 text-[11px] font-medium text-no transition hover:bg-no/20 disabled:opacity-40"
              >
                {busy === "buy" ? "signing..." : "Buy NO"}
              </button>
            </div>
          </div>
        ) : null}

        {isProvisional ? (
          <div className="space-y-2">
            <div className="rounded border border-amber/25 bg-amber/5 px-2 py-1.5 text-[10px] text-amber">
              {market.claim_block_reason === "CHALLENGE_WINDOW_OPEN"
                ? `Pot and bonds stay locked for ${market.countdown_steps} more steps.`
                : "Window closed, finalize to open claims."}
            </div>
            <input
              value={counterUrl}
              onChange={(event) => setCounterUrl(event.target.value)}
              className="w-full rounded-md border border-line bg-obsidian/70 px-2 py-1.5 font-mono text-[10px] text-ink outline-none focus:border-amber/50"
              aria-label="counter evidence url"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onChallenge(counterUrl)}
                disabled={busy !== null || !market.challenge_open}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-amber/40 bg-amber/10 px-2 py-2 text-[10.5px] font-medium text-amber transition hover:bg-amber/20 disabled:opacity-40"
              >
                <Gavel size={12} /> File challenge
              </button>
              <button
                onClick={onClaim}
                disabled={busy !== null}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-line bg-obsidian/60 px-2 py-2 text-[10.5px] font-medium text-muted transition hover:text-ink disabled:opacity-40"
              >
                <Lock size={12} /> Claim (locked)
              </button>
            </div>
            {market.settlement_ready ? (
              <button
                onClick={onFinalize}
                disabled={busy !== null}
                className="w-full rounded-lg border border-violet/40 bg-violet/10 px-3 py-2 text-[11px] font-medium text-violet transition hover:bg-violet/20 disabled:opacity-40"
              >
                Finalize settlement
              </button>
            ) : null}
          </div>
        ) : null}

        {isChallenged ? (
          <button
            onClick={onAudit}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-orange-400/40 bg-orange-400/10 px-3 py-2 text-[11px] font-medium text-orange-300 transition hover:bg-orange-400/20 disabled:opacity-40"
          >
            <RefreshCcw size={12} /> Run re-audit consensus
          </button>
        ) : null}

        {isFinalized ? (
          <button
            onClick={onClaim}
            disabled={busy !== null || !canClaim}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-yes/40 bg-yes/10 px-3 py-2 text-[11px] font-medium text-yes transition hover:bg-yes/20 disabled:opacity-40"
          >
            <ArrowDownToLine size={12} /> {canClaim ? `Claim ${formatExact(position?.payout_quote ?? 0)} PGT` : "Nothing to claim"}
          </button>
        ) : null}
      </div>

      <div className="rounded-xl border border-line bg-panel/60">
        <button
          onClick={() => setOperatorOpen((value) => !value)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-[10px] uppercase tracking-[0.16em] text-muted"
        >
          <span className="flex items-center gap-2">
            <ShieldAlert size={12} /> permissionless operator controls
          </span>
          {operatorOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {operatorOpen ? (
          <div className="space-y-2 border-t border-line px-4 py-3">
            <p className="text-[9.5px] leading-relaxed text-muted">
              No owner key exists. Any account may resolve, challenge, audit, advance the clock or finalize.
              Each action still passes the same on-chain guards.
            </p>
            <input
              value={evidenceUrl}
              onChange={(event) => setEvidenceUrl(event.target.value)}
              className="w-full rounded-md border border-line bg-obsidian/70 px-2 py-1.5 font-mono text-[10px] text-ink outline-none focus:border-yes/50"
              aria-label="resolution evidence url"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onResolve(evidenceUrl)}
                disabled={busy !== null || !isOpen}
                className="rounded-lg border border-line bg-obsidian/60 px-2 py-1.5 text-[10px] text-ink transition hover:border-no/40 disabled:opacity-40"
              >
                Live resolve
              </button>
              <button
                onClick={onTick}
                disabled={busy !== null}
                className="flex items-center justify-center gap-1 rounded-lg border border-line bg-obsidian/60 px-2 py-1.5 text-[10px] text-ink transition hover:border-amber/40 disabled:opacity-40"
              >
                <Timer size={11} /> Advance clock
              </button>
            </div>
            <div className="font-mono text-[9px] text-muted">
              implied YES {formatBps(market.implied_yes_prob_bps)} | digest {market.evidence_digest ? `${market.evidence_digest.slice(0, 18)}...` : "none"}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-line bg-obsidian/50 px-1.5 py-2">
      <div className="text-[8.5px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className={`font-mono text-[11.5px] ${tone}`}>{value}</div>
    </div>
  );
}

function Step({ done, active, label }: { done?: boolean; active?: boolean; label: string }) {
  const color = done ? "bg-yes" : active ? "bg-amber" : "bg-line";
  return (
    <div className="flex items-start gap-2">
      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${color} ${active ? "animate-pulseLine" : ""}`} />
      <span className={`text-[10px] leading-relaxed ${done ? "text-ink" : active ? "text-amber" : "text-muted"}`}>{label}</span>
    </div>
  );
}
