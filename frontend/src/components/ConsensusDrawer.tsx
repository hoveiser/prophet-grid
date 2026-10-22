import { useEffect, useState } from "react";
import { Fingerprint, ShieldCheck, X } from "lucide-react";
import type { Market, ResolutionReceipt } from "../types";
import { formatExact, outcomeLabel, outcomeTone } from "../lib/format";

interface ConsensusDrawerProps {
  open: boolean;
  market: Market | null;
  onClose: () => void;
  loadReceipt: (marketId: number) => Promise<ResolutionReceipt>;
}

export function ConsensusDrawer({ open, market, onClose, loadReceipt }: ConsensusDrawerProps) {
  const [receipt, setReceipt] = useState<ResolutionReceipt | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !market) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadReceipt(market.market_id)
      .then((data) => {
        if (!cancelled) setReceipt(data);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, market, loadReceipt]);

  if (!open || !market) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-testid="consensus-drawer">
      <button className="absolute inset-0 bg-obsidian/80 backdrop-blur-sm" onClick={onClose} aria-label="Close inspector" />
      <aside className="relative h-full w-full max-w-[600px] overflow-y-auto border-l border-line bg-panel shadow-panel">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel/95 px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <ShieldCheck size={15} className="text-amber" />
            <div>
              <div className="text-[12px] font-medium text-ink">Consensus and prompt inspector</div>
              <div className="text-[9.5px] text-muted">validator receipt for market #{market.market_id}</div>
            </div>
          </div>
          <button onClick={onClose} className="rounded border border-line bg-obsidian/60 p-1.5 text-muted hover:text-ink" aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-lg border border-line bg-obsidian/60 p-3">
            <div className="text-[9px] uppercase tracking-[0.16em] text-muted">market question</div>
            <div className="mt-1 text-[12px] leading-relaxed text-ink">{market.question}</div>
          </div>

          {loading ? (
            <div className="animate-pulse rounded-lg border border-line bg-panel2/60 p-4 text-[11px] text-muted">
              Reading the validator receipt from studionet...
            </div>
          ) : null}
          {error ? (
            <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-[11px] text-danger">{error}</div>
          ) : null}

          {receipt ? (
            <>
              <section className="rounded-lg border border-line bg-panel2/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[9px] uppercase tracking-[0.16em] text-muted">provisional verdict</span>
                  <span className={`font-mono text-[12px] ${outcomeTone(receipt.outcome_band)}`}>{outcomeLabel(receipt.outcome_band)}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Mini label="anchor" value={String(receipt.confidence_anchor)} />
                  <Mini label="authenticated" value={receipt.source_authenticated ? "true" : "false"} />
                  <Mini label="window" value={`${receipt.countdown_epochs} epochs`} />
                </div>

                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[9px] text-muted">
                    <span>confidence ladder</span>
                    <span className="font-mono">resolve at {receipt.resolve_threshold}+</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {receipt.confidence_anchors.map((anchor) => {
                      const active = anchor === receipt.confidence_anchor;
                      const resolves = anchor >= receipt.resolve_threshold;
                      return (
                        <div key={anchor} className="flex-1 text-center">
                          <div
                            className={`h-6 rounded border text-[9px] leading-6 font-mono ${
                              active
                                ? "border-yes/60 bg-yes/20 text-yes"
                                : resolves
                                  ? "border-line bg-obsidian/60 text-muted"
                                  : "border-line/60 bg-obsidian/30 text-line"
                            }`}
                          >
                            {anchor}
                          </div>
                          <div className={`mt-0.5 text-[8px] ${resolves ? "text-muted" : "text-line"}`}>
                            {resolves ? "resolve" : "refund"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-line bg-panel2/40 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.16em] text-muted">
                  <Fingerprint size={11} /> evidence fingerprint
                </div>
                <div className="break-all rounded bg-obsidian/70 p-2 font-mono text-[9.5px] text-no">{receipt.evidence_digest || "not resolved yet"}</div>
                <div className="mt-2 space-y-1 text-[10px] text-muted">
                  <div className="flex items-center justify-between gap-2">
                    <span>primary source</span>
                    <a href={receipt.primary_source_url} target="_blank" rel="noreferrer" className="max-w-[320px] truncate font-mono text-no hover:underline">
                      {receipt.primary_source_url}
                    </a>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>filed evidence</span>
                    <a href={receipt.evidence_url || "#"} target="_blank" rel="noreferrer" className="max-w-[320px] truncate font-mono text-yes hover:underline">
                      {receipt.evidence_url || "none"}
                    </a>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>resolved at epoch</span>
                    <span className="font-mono text-ink">{receipt.resolved_at_epoch}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>window closes after epoch</span>
                    <span className="font-mono text-ink">{receipt.challenge_deadline_epoch}</span>
                  </div>
                </div>
                {receipt.summary ? (
                  <p className="mt-2 rounded border border-line/70 bg-obsidian/40 p-2 text-[10px] leading-relaxed text-muted">
                    {receipt.summary}
                  </p>
                ) : null}
              </section>

              <section className="rounded-lg border border-amber/25 bg-amber/5 p-3">
                <div className="mb-1 text-[9px] uppercase tracking-[0.16em] text-amber">comparative equivalence principle</div>
                <p className="text-[10px] leading-relaxed text-ink/90">{receipt.principle}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {["outcome_band", "confidence_anchor", "source_authenticated"].map((field) => (
                    <span key={field} className="rounded border border-amber/30 bg-obsidian/50 px-1.5 py-0.5 font-mono text-[9px] text-amber">
                      exact: {field}
                    </span>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-line bg-panel2/40 p-3">
                <div className="mb-1 text-[9px] uppercase tracking-[0.16em] text-muted">sanitizer rules</div>
                <p className="text-[10px] leading-relaxed text-muted">{receipt.sanitizer_rules}</p>
                <div className="mt-2 rounded bg-obsidian/60 p-2 font-mono text-[9px] leading-relaxed text-no">
                  strip {"< > { }"} | defuse closing tags | drop control chars | truncate {receipt.document_char_limit} chars
                </div>
              </section>

              <section className="rounded-lg border border-line bg-panel2/40 p-3">
                <div className="mb-1 text-[9px] uppercase tracking-[0.16em] text-muted">fail closed parse policy</div>
                <p className="text-[10px] leading-relaxed text-muted">{receipt.parse_policy}</p>
                <div className="mt-2 mb-1 text-[9px] uppercase tracking-[0.16em] text-muted">error taxonomy</div>
                <p className="text-[10px] leading-relaxed text-muted">{receipt.error_taxonomy}</p>
              </section>

              <section className="rounded-lg border border-line bg-panel2/40 p-3">
                <div className="mb-2 text-[9px] uppercase tracking-[0.16em] text-muted">challenge history</div>
                {receipt.challenges.length === 0 ? (
                  <p className="text-[10px] text-muted">No challenge was filed. The bond reservation stayed empty.</p>
                ) : (
                  <div className="space-y-2">
                    {receipt.challenges.map((item) => (
                      <div key={item.index} className="rounded border border-line/70 bg-obsidian/50 p-2 text-[10px]">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-muted">#{item.index} {item.challenger.slice(0, 10)}...</span>
                          <span className={item.status === "OVERTURNED" ? "text-yes" : item.status === "UPHELD" ? "text-amber" : "text-muted"}>
                            {item.status}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[9px] text-muted">
                          <span className="truncate">{item.counter_evidence_url}</span>
                          <span className="font-mono">{formatExact(item.bond)} bond</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[9px]">
                          <span className="text-muted">{item.original_outcome} to {item.final_outcome || "pending"}</span>
                          <span className="font-mono text-muted">epoch {item.reviewed_at_epoch || item.filed_at_epoch}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <div className="rounded-lg border border-line bg-obsidian/60 p-3 font-mono text-[9px] leading-relaxed text-muted">
                <div>equivalence: {receipt.consensus}</div>
                <div>runner: {receipt.runner_pin}</div>
                <div>sources: {receipt.evidence_sources.join(" + ")}</div>
                <div>window: {receipt.challenge_window_epochs} epochs | bond: {receipt.challenge_bond_amount}</div>
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-obsidian/50 px-1.5 py-1.5">
      <div className="text-[8px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className="font-mono text-[11px] text-ink">{value}</div>
    </div>
  );
}
