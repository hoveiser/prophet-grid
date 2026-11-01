import { useEffect, useState } from "react";
import { Boxes, Crosshair, Network, Radar, X } from "lucide-react";
import type { ConsensusPolicy, EcosystemFeed, ResolutionReceipt, SettlementSnapshot } from "../types";
import { bandLabel, bandTint, dayTime, pgt, shortDesk } from "../lib/format";

interface Props {
  open: boolean;
  market: SettlementSnapshot | null;
  policy: ConsensusPolicy | null;
  onClose: () => void;
  loadFeed: (marketId: string) => Promise<{ receipt: ResolutionReceipt; feed: EcosystemFeed }>;
}

export function OracleTelemetry({ open, market, policy, onClose, loadFeed }: Props) {
  const [payload, setPayload] = useState<{ receipt: ResolutionReceipt; feed: EcosystemFeed } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !market) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadFeed(market.market_id)
      .then((value) => {
        if (!cancelled) setPayload(value);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, market, loadFeed]);

  if (!open) return null;
  const receipt = payload?.receipt ?? null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-carbon/70 backdrop-blur-sm" onClick={onClose}>
      <aside
        data-testid="telemetry-panel"
        className="h-full w-full max-w-[520px] overflow-y-auto border-l border-edge bg-panel/95"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center gap-2 border-b border-edge bg-carbon/95 px-3 py-2.5 backdrop-blur">
          <Crosshair size={13} className="text-amber" />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink">
            dual source oracle verification and ecosystem telemetry
          </span>
          <button onClick={onClose} data-testid="telemetry-close" className="ml-auto text-dim transition hover:text-ink">
            <X size={14} />
          </button>
        </div>

        <div className="space-y-3 px-3 py-3">
          <section>
            <Heading icon={Radar} text="compared consensus fields" />
            <div className="mt-1.5 grid grid-cols-2 gap-px bg-edge/70">
              <Field label="band" value={receipt ? bandLabel(receipt.band) : market ? bandLabel(market.band) : "-"} tone={receipt ? bandTint(receipt.band) : undefined} />
              <Field
                label="strike baseline"
                value={receipt ? `${receipt.quantized_strike_baseline_bps} bps` : `${market?.strike_bps ?? 0} bps`}
              />
              <Field
                label="observed print"
                value={receipt ? `${receipt.quantized_observed_metric_bps} bps` : `${market?.observed_bps ?? 0} bps`}
              />
              <Field
                label="YES weight"
                value={receipt ? `${receipt.yes_payout_bps} bps` : `${market?.yes_payout_bps ?? 0} bps`}
              />
              <Field
                label="NO weight"
                value={receipt ? `${receipt.no_payout_bps} bps` : `${market?.no_payout_bps ?? 0} bps`}
              />
              <Field
                label="winning pool payout"
                value={pgt(receipt?.derived_winning_pool_payout ?? market?.winning_payout ?? 0)}
              />
              <Field
                label="challenger reward"
                value={pgt(receipt?.derived_challenger_reward ?? market?.challenger_reward ?? 0)}
              />
              <Field label="protocol fee sink" value={pgt(receipt?.derived_protocol_reserve_fee ?? market?.reserve_fee ?? 0)} />
            </div>
            {receipt ? (
              <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-dim">
                validators must agree exactly on {receipt.compared_fields.join(", ")}. Grid step is{" "}
                {receipt.grid_step_bps} bps. The chain re-derives every integer from the two fetched prints before
                it writes storage, so a model that returns an off grid value is rejected outright.
              </p>
            ) : null}
            {receipt?.digest ? (
              <div className="mt-1.5 border border-edge bg-rack px-2 py-1.5">
                <div className="grid-label">evidence digest</div>
                <div className="break-all font-mono text-[9px] text-cyan">{receipt.digest}</div>
              </div>
            ) : null}
          </section>

          <section>
            <Heading icon={Network} text="dual source chain of custody" />
            <SourceRow title="primary" url={market?.primary_url ?? ""} />
            <SourceRow title="secondary" url={market?.secondary_url ?? ""} />
            <SourceRow title="filed evidence" url={market?.evidence_url ?? ""} />
            <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-dim">
              Each evaluator renders both sources independently and re-runs the extraction. Fetched text is
              neutralised before it reaches the prompt: closing tags defused, angle brackets, braces and control
              characters removed, whitespace collapsed, truncated to 6000 characters. Instructions embedded in a
              page are treated as data.
            </p>
            {market ? (
              <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px]">
                <span className={market.corroborated ? "text-bid" : "text-ask"}>
                  {market.corroborated ? "sources corroborate" : "sources do not corroborate"}
                </span>
                <span className="text-dim">settlement summary: {market.summary || "none recorded"}</span>
              </div>
            ) : null}
          </section>

          <section>
            <Heading icon={Boxes} text="lifecycle gates" />
            <div className="mt-1.5 space-y-1">
              <GateLine label="intake closes" epoch={market?.close_epoch ?? 0} now={market?.now ?? 0} />
              <GateLine label="verdict recorded" epoch={market?.resolution_epoch ?? 0} now={market?.now ?? 0} />
              <GateLine label="challenge window closes" epoch={market?.challenge_deadline_epoch ?? 0} now={market?.now ?? 0} />
              <GateLine label="resolution timeout" epoch={market?.resolution_timeout_epoch ?? 0} now={market?.now ?? 0} />
            </div>
          </section>

          <section>
            <Heading icon={Crosshair} text="bonded challenge record" />
            <div className="mt-1.5 space-y-1">
              {(receipt?.challenges ?? []).length === 0 ? (
                <div className="font-mono text-[10px] text-dim">no challenge filed on this book</div>
              ) : null}
              {(receipt?.challenges ?? []).map((item) => (
                <div key={item.key} className="border border-edge bg-rack px-2 py-1.5 font-mono text-[10px]">
                  <div className="flex items-center gap-2">
                    <span className="text-ink">{item.key}</span>
                    <span
                      className={
                        item.state === "UPHELD"
                          ? "text-ask"
                          : item.state === "OVERTURNED"
                            ? "text-bid"
                            : item.state === "ABORTED"
                              ? "text-dim"
                              : "text-amber"
                      }
                    >
                      {item.state}
                    </span>
                    <span className="ml-auto text-dim">bond {pgt(item.bond)}</span>
                  </div>
                  <div className="mt-0.5 text-dim">
                    {shortDesk(item.challenger)} prior {bandLabel(item.prior_band)} · {dayTime(item.filed_at)}
                  </div>
                  <div className="break-all text-dim/80">{item.counter_url}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <Heading icon={Network} text="ecosystem interconnect" />
            <div className="mt-1.5 space-y-1">
              <div className="flex items-center gap-2 font-mono text-[10px] text-dim">
                feed id
                <span className="text-cyan">{payload?.feed.feed ?? "prophetgrid.ecosystem.v1"}</span>
              </div>
              {(payload?.feed.consumers ?? []).map((consumer) => (
                <div key={consumer.address} className="border border-edge bg-rack px-2 py-1.5 font-mono text-[10px]">
                  <div className="flex items-center gap-2">
                    <span className="text-lime">{consumer.name}</span>
                    <span className="text-dim">{shortDesk(consumer.address)}</span>
                    <span className="ml-auto text-dim">pulls {consumer.read_count}</span>
                  </div>
                  <div className="text-dim">last book {consumer.last_market_id || "none"}</div>
                </div>
              ))}
              {(payload?.feed.consumers ?? []).length === 0 ? (
                <div className="font-mono text-[10px] text-dim">
                  no sibling contract has registered yet. ProphetSyndicate and ProphetSentinel consume this feed by
                  pulling it; the settlement shape is the integration surface.
                </div>
              ) : null}
              <div className="mt-1 font-mono text-[9px] leading-relaxed text-dim">
                custody at read time: pots {pgt(payload?.feed.custody.locked_market_pots ?? 0)}, bonds{" "}
                {pgt(payload?.feed.custody.pending_challenge_bonds ?? 0)}, hedges{" "}
                {pgt(payload?.feed.custody.hedge_reservations ?? 0)}, refundable{" "}
                {pgt(payload?.feed.custody.refundable_native ?? 0)}, reserve{" "}
                {pgt(payload?.feed.custody.protocol_reserve ?? 0)}. Solvent:{" "}
                <span className={payload?.feed.custody.ok ? "text-bid" : "text-ask"}>
                  {String(payload?.feed.custody.ok ?? false)}
                </span>
              </div>
            </div>
          </section>

          {policy ? (
            <section>
              <Heading icon={Crosshair} text="consensus policy as deployed" />
              <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-dim">{policy.principle}</p>
              <p className="mt-1 font-mono text-[9px] leading-relaxed text-dim">{policy.sanitizer}</p>
              <div className="mt-1.5 grid grid-cols-3 gap-px bg-edge/70">
                <Field label="fee bps" value={String(policy.fee_bps)} />
                <Field label="reward bps" value={String(policy.reward_bps)} />
                <Field label="max challenges" value={String(policy.max_challenges_per_market)} />
              </div>
            </section>
          ) : null}

          {loading ? <div className="font-mono text-[10px] text-dim">pulling the on chain receipt...</div> : null}
          {error ? <div className="font-mono text-[10px] text-ask">{error}</div> : null}
        </div>
      </aside>
    </div>
  );
}

function Heading({ icon: Icon, text }: { icon: typeof Radar; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={12} className="text-cyan" />
      <span className="grid-label">{text}</span>
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-carbon px-2 py-1.5">
      <div className="grid-label">{label}</div>
      <div className={`font-mono text-[11px] tabular-nums ${tone ?? "text-ink"}`}>{value}</div>
    </div>
  );
}

function SourceRow({ title, url }: { title: string; url: string }) {
  return (
    <div className="border border-edge bg-rack px-2 py-1.5">
      <div className="grid-label">{title}</div>
      <a
        href={url || undefined}
        target="_blank"
        rel="noreferrer"
        className={`break-all font-mono text-[9px] ${url ? "text-cyan hover:underline" : "text-dim/60"}`}
      >
        {url || "not filed"}
      </a>
    </div>
  );
}

function GateLine({ label, epoch, now }: { label: string; epoch: number; now: number }) {
  const passed = epoch > 0 && now >= epoch;
  return (
    <div className="flex items-center gap-2 border border-edge bg-rack px-2 py-1 font-mono text-[10px]">
      <span className={`h-1.5 w-1.5 rounded-full ${passed ? "bg-bid" : "bg-amber"}`} />
      <span className="text-dim">{label}</span>
      <span className="ml-auto text-ink">{epoch > 0 ? dayTime(epoch) : "n/a"}</span>
      <span className={passed ? "text-bid" : "text-amber"}>{passed ? "elapsed" : "pending"}</span>
    </div>
  );
}
