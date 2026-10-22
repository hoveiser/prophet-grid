import { useState } from "react";
import { AlertTriangle, Beaker, ShieldX, Zap } from "lucide-react";
import type { Market, Position } from "../types";
import { shortAddress } from "../lib/format";

export type GuardKind = "premature" | "injection" | "zero_share";

interface GuardLabProps {
  markets: Market[];
  positions: Position[];
  address: string;
  busy: string | null;
  onProbe: (kind: GuardKind) => Promise<string | null>;
}

interface GuardSpec {
  kind: GuardKind;
  title: string;
  expected: string;
  rule: string;
  icon: typeof ShieldX;
  tone: string;
}

const GUARDS: GuardSpec[] = [
  {
    kind: "premature",
    title: "Premature claim before window close",
    expected: "[EXPECTED] payout blocked: CHALLENGE_WINDOW_OPEN",
    rule: "claim_market_payout refuses while current_epoch <= challenge_deadline_epoch. The pot stays in custody until the window strictly elapses.",
    icon: ShieldX,
    tone: "amber",
  },
  {
    kind: "injection",
    title: "Unauthenticated URL injection",
    expected: "[EXPECTED] counter evidence url must use http or https",
    rule: "Every evidence URL must be http or https, public and credential free. javascript and data schemes revert before any bond moves.",
    icon: AlertTriangle,
    tone: "danger",
  },
  {
    kind: "zero_share",
    title: "Zero-share claim",
    expected: "[EXPECTED] position has no winning shares",
    rule: "A wallet without winning shares cannot drain the pot. The payout is derived from the caller's own position only.",
    icon: Beaker,
    tone: "no",
  },
];

export function GuardLab({ markets, positions, address, busy, onProbe }: GuardLabProps) {
  const [results, setResults] = useState<Record<string, { text: string; live: boolean }>>({});

  const provisional = markets.find((market) => market.status === "CHALLENGE_WINDOW" && market.challenge_open);
  const finalized = markets.find((market) => market.status === "FINALIZED");

  const targetFor = (kind: GuardKind): { market: Market; reason: string; ready: boolean } | null => {
    if (kind === "premature" || kind === "injection") {
      if (!provisional) {
        return { market: markets[0], reason: "no market in an open challenge window", ready: false };
      }
      return { market: provisional, reason: "live challenge window detected", ready: true };
    }
    if (!finalized) {
      return { market: markets[0], reason: "no settled market available", ready: false };
    }
    const position = positions.find((item) => item.market_id === finalized.market_id);
    const hasWinner = position ? (position.outcome_band === "OUTCOME_YES" ? position.yes_shares : position.outcome_band === "OUTCOME_NO" ? position.no_shares : position.principal) > 0 : false;
    if (hasWinner) {
      return { market: finalized, reason: "this wallet already holds a winning position", ready: false };
    }
    return { market: finalized, reason: "settled market detected, wallet has no position", ready: true };
  };

  const dryRun = (kind: GuardKind) => {
    const spec = GUARDS.find((item) => item.kind === kind);
    if (!spec) return;
    const target = targetFor(kind);
    const text = target?.ready
      ? spec.expected
      : `[precondition] ${target?.reason ?? "no target"}. The contract would still revert on the same rule once a target exists.`;
    setResults((current) => ({ ...current, [kind]: { text, live: false } }));
  };

  const liveProbe = async (kind: GuardKind) => {
    try {
      const message = await onProbe(kind);
      setResults((current) => ({
        ...current,
        [kind]: { text: message ?? "[precondition] live probe unavailable", live: true },
      }));
    } catch (cause) {
      setResults((current) => ({
        ...current,
        [kind]: { text: cause instanceof Error ? cause.message : String(cause), live: true },
      }));
    }
  };

  return (
    <div className="space-y-3" data-testid="guard-lab">
      <div className="rounded-xl border border-line bg-panel/80 p-4">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
          <Zap size={13} className="text-danger" /> security guard lab
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
          Each guard is enforced on chain. Dry run mirrors the exact revert string. Live probe sends a real
          transaction from {shortAddress(address)} and shows the validator error.
        </p>
      </div>

      {GUARDS.map((spec) => {
        const target = targetFor(spec.kind);
        const result = results[spec.kind];
        const Icon = spec.icon;
        const border =
          spec.tone === "amber" ? "border-amber/25" : spec.tone === "danger" ? "border-danger/25" : "border-no/25";
        return (
          <div key={spec.kind} className={`rounded-xl border ${border} bg-panel/70 p-4`} data-testid={`guard-${spec.kind}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <Icon size={14} className={spec.tone === "amber" ? "text-amber" : spec.tone === "danger" ? "text-danger" : "text-no"} />
                <div>
                  <div className="text-[11.5px] font-medium text-ink">{spec.title}</div>
                  <div className="mt-0.5 font-mono text-[9.5px] text-muted">
                    target #{target?.market?.market_id ?? "n/a"} | {target?.reason}
                  </div>
                </div>
              </div>
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[8.5px] ${
                  target?.ready ? "bg-yes/10 text-yes" : "bg-panel2 text-muted"
                }`}
              >
                {target?.ready ? "LIVE TARGET" : "GUARD RULE"}
              </span>
            </div>

            <p className="mt-2 text-[10px] leading-relaxed text-muted">{spec.rule}</p>

            <div className="mt-2 rounded border border-line/70 bg-obsidian/60 p-2 font-mono text-[9px] text-muted">
              expected: <span className="text-danger">{spec.expected}</span>
            </div>

            {result ? (
              <div
                className={`mt-2 rounded border p-2 font-mono text-[9.5px] leading-relaxed ${
                  result.live ? "border-danger/40 bg-danger/10 text-danger" : "border-amber/30 bg-amber/5 text-amber"
                }`}
                data-testid={`guard-result-${spec.kind}`}
              >
                <div className="mb-1 flex items-center justify-between text-[8.5px] uppercase tracking-[0.12em]">
                  <span>{result.live ? "live on-chain revert" : "dry run mirror"}</span>
                  <span>{result.live ? "REVERT CONFIRMED" : "SIMULATED"}</span>
                </div>
                {result.text}
              </div>
            ) : null}

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => dryRun(spec.kind)}
                className="rounded-lg border border-line bg-obsidian/60 px-2 py-1.5 text-[10px] text-muted transition hover:text-ink"
              >
                Dry run
              </button>
              <button
                onClick={() => void liveProbe(spec.kind)}
                disabled={busy !== null || !target?.ready}
                data-testid={`guard-live-${spec.kind}`}
                className="rounded-lg border border-danger/35 bg-danger/10 px-2 py-1.5 text-[10px] font-medium text-danger transition hover:bg-danger/20 disabled:opacity-35"
              >
                {busy === `guard:${spec.kind}` ? "signing..." : "Live probe"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
