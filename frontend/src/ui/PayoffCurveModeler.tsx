import { useMemo, useState } from "react";
import { LineChart, MoveHorizontal, RotateCcw } from "lucide-react";
import { FULL_SCALE_BPS, GRID_STEP_BPS } from "../config";
import type { SettlementSnapshot } from "../types";
import { bandLabel, bandTint, bps, multiple, pgt } from "../lib/format";
import { corridorFor, decideBand, modelPayoff, snapGrid } from "../lib/payoff";

interface Props {
  market: SettlementSnapshot | null;
}

const WIDTH = 520;
const HEIGHT = 208;
const PAD = 26;

export function PayoffCurveModeler({ market }: Props) {
  const seedStrike = market ? market.strike_bps : 5000;
  const seedCorridor = market ? market.corridor_bps : 2000;
  const [strike, setStrike] = useState(seedStrike);
  const [corridor, setCorridor] = useState(seedCorridor);
  const [observed, setObserved] = useState(market && market.observed_bps > 0 ? market.observed_bps : 6250);
  const [corroborated, setCorroborated] = useState(true);
  const [yesPool, setYesPool] = useState(market ? Math.max(1, Math.round(market.yes_pool / 1e15)) : 40);
  const [noPool, setNoPool] = useState(market ? Math.max(1, Math.round(market.no_pool / 1e15)) : 60);
  const [deskSize, setDeskSize] = useState(10);

  const seed = () => {
    if (!market) return;
    setStrike(market.strike_bps);
    setCorridor(market.corridor_bps);
    setObserved(market.observed_bps > 0 ? market.observed_bps : market.strike_bps);
    setYesPool(Math.max(1, Math.round(market.yes_pool / 1e15)));
    setNoPool(Math.max(1, Math.round(market.no_pool / 1e15)));
  };

  const { lower, upper } = corridorFor(strike, corridor);
  const model = useMemo(
    () =>
      modelPayoff({
        yesPool: yesPool * 10 ** 15,
        noPool: noPool * 10 ** 15,
        deskYes: deskSize * 10 ** 15,
        deskNo: 0,
        strike,
        corridor,
        observed,
        corroborated,
      }),
    [yesPool, noPool, deskSize, strike, corridor, observed, corroborated],
  );

  const xs = (bpsValue: number) =>
    PAD + (Math.max(0, Math.min(FULL_SCALE_BPS, bpsValue)) / FULL_SCALE_BPS) * (WIDTH - 2 * PAD);
  const ys = (payoutBps: number) => HEIGHT - PAD - (payoutBps / FULL_SCALE_BPS) * (HEIGHT - 2 * PAD);

  const curve = useMemo(() => {
    const points: string[] = [];
    for (let grid = 0; grid <= FULL_SCALE_BPS; grid += GRID_STEP_BPS) {
      const outcome = decideBand(grid, strike, corridor, corroborated);
      points.push(`${xs(grid).toFixed(1)},${ys(outcome.yes_payout_bps).toFixed(1)}`);
    }
    return points.join(" ");
  }, [strike, corridor, corroborated]);

  const snapped = snapGrid(observed);

  return (
    <section className="rail" data-testid="payoff-modeler">
      <div className="flex items-center gap-2 border-b border-edge bg-panel/70 px-3 py-2">
        <LineChart size={13} className="text-cyan" />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink">
          strike quantization and scalar payoff modeler
        </span>
        <button
          onClick={seed}
          disabled={!market}
          className="ml-auto flex items-center gap-1.5 border border-edge px-2 py-[2px] font-mono text-[9px] text-dim transition hover:border-cyan/45 disabled:opacity-40"
        >
          <RotateCcw size={10} /> load book
        </button>
      </div>

      <div className="grid gap-3 px-3 py-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <svg width="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="scalar payoff curve">
            <rect x={PAD} y={PAD} width={WIDTH - 2 * PAD} height={HEIGHT - 2 * PAD} fill="#131A28" stroke="#1B2436" />
            <rect
              x={xs(lower)}
              y={PAD}
              width={Math.max(2, xs(upper) - xs(lower))}
              height={HEIGHT - 2 * PAD}
              fill="#FF9500"
              opacity={0.14}
            />
            <line x1={xs(lower)} y1={PAD} x2={xs(lower)} y2={HEIGHT - PAD} stroke="#FF9500" strokeDasharray="3 3" opacity={0.6} />
            <line x1={xs(upper)} y1={PAD} x2={xs(upper)} y2={HEIGHT - PAD} stroke="#FF9500" strokeDasharray="3 3" opacity={0.6} />
            <line x1={xs(strike)} y1={PAD} x2={xs(strike)} y2={HEIGHT - PAD} stroke="#00E5FF" strokeDasharray="2 4" />
            <polyline points={curve} fill="none" stroke="#10B981" strokeWidth={2} />
            <line
              x1={xs(Math.max(0, snapped))}
              y1={PAD}
              x2={xs(Math.max(0, snapped))}
              y2={HEIGHT - PAD}
              stroke="#FACC15"
              strokeWidth={1.5}
            />
            <circle cx={xs(Math.max(0, snapped))} cy={ys(model.yes_payout_bps)} r={4} fill="#FACC15" />
            {[0, 2500, 5000, 7500, 10000].map((tick) => (
              <g key={tick}>
                <line x1={xs(tick)} y1={HEIGHT - PAD} x2={xs(tick)} y2={HEIGHT - PAD + 4} stroke="#7C8CA7" />
                <text x={xs(tick)} y={HEIGHT - 8} fill="#7C8CA7" fontSize={9} textAnchor="middle" fontFamily="JetBrains Mono">
                  {(tick / 100).toFixed(0)}%
                </text>
              </g>
            ))}
            <text x={8} y={ys(5000)} fill="#7C8CA7" fontSize={9} fontFamily="JetBrains Mono">YES</text>
            <text x={WIDTH - 34} y={ys(5000)} fill="#7C8CA7" fontSize={9} fontFamily="JetBrains Mono">payout</text>
          </svg>

          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <Slider
              label="quantized strike baseline"
              value={strike}
              min={0}
              max={FULL_SCALE_BPS}
              step={GRID_STEP_BPS}
              onChange={setStrike}
              testid="slider-strike"
            />
            <Slider
              label="scalar corridor half width"
              value={corridor}
              min={GRID_STEP_BPS}
              max={5000}
              step={GRID_STEP_BPS}
              onChange={setCorridor}
              testid="slider-corridor"
            />
            <Slider
              label="observed macro print"
              value={observed}
              min={0}
              max={FULL_SCALE_BPS}
              step={50}
              onChange={setObserved}
              testid="slider-observed"
            />
            <Slider
              label="desk leg size"
              value={deskSize}
              min={1}
              max={Math.max(2, yesPool + noPool)}
              step={1}
              onChange={setDeskSize}
              testid="slider-size"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="border border-edge bg-rack/70 px-2.5 py-2">
            <div className="grid-label">derived band</div>
            <div className={`mt-1 font-mono text-[13px] ${bandTint(model.band)}`}>{bandLabel(model.band)}</div>
            <div className="mt-1 flex items-center gap-2">
              <label className="flex items-center gap-1.5 font-mono text-[10px] text-dim">
                <input
                  type="checkbox"
                  checked={corroborated}
                  onChange={(event) => setCorroborated(event.target.checked)}
                  className="accent-[#10B981]"
                />
                dual source corroboration
              </label>
            </div>
          </div>

          <Row label="grid snap of print" value={`${Math.max(0, snapped)} bps`} note={`raw ${observed}`} />
          <Row label="corridor window" value={`${bps(lower)} to ${bps(upper)}`} note={`${upper - lower} bps wide`} />
          <Row
            label="payout weights"
            value={`YES ${model.yes_payout_bps} / NO ${model.no_payout_bps}`}
            note={model.yes_payout_bps + model.no_payout_bps === FULL_SCALE_BPS ? "weights sum to unity" : "refund band"}
          />
          <Row label="pot" value={pgt(model.pot)} note={`fee sink ${pgt(model.fee)}`} />
          <Row label="distributable" value={pgt(model.distributable)} note={`YES budget ${pgt(model.yesBudget)}`} />
          <Row
            label="desk payout on this leg"
            value={pgt(model.deskPayout)}
            note={`${multiple(model.deskPrincipal > 0 ? Math.round((model.deskPayout / model.deskPrincipal) * 10000) : 0)} on stake`}
            tone={model.refundMode ? "text-lime" : "text-bid"}
          />
          <Row label="roi" value={`${(model.roiBps / 100).toFixed(1)}%`} note={`principal ${pgt(model.deskPrincipal)}`} />
          <div
            className={`border px-2.5 py-2 font-mono text-[10px] ${
              model.conserved ? "border-bid/40 bg-bid/10 text-bid" : "border-ask/40 bg-ask/10 text-ask"
            }`}
          >
            conservation {model.conserved ? "exact" : "broken"} · dust {model.dust} wei · refund flag {String(model.refundMode)}
          </div>
          <p className="flex items-start gap-1.5 font-mono text-[9px] leading-relaxed text-dim">
            <MoveHorizontal size={11} className="mt-0.5 shrink-0" />
            modelling only. The chain recomputes these integers inside consensus and rejects any validator that
            disagrees, so a desk cannot steer a settlement from here.
          </p>
        </div>
      </div>
    </section>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  testid,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  testid: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="grid-label">{label}</span>
        <span className="font-mono text-[11px] text-ink">{value}</span>
      </div>
      <input
        data-testid={testid}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full"
      />
    </div>
  );
}

function Row({ label, value, note, tone }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div className="border border-edge bg-rack/70 px-2.5 py-1.5">
      <div className="grid-label">{label}</div>
      <div className={`font-mono text-[12px] tabular-nums ${tone ?? "text-ink"}`}>{value}</div>
      <div className="font-mono text-[9px] text-dim">{note}</div>
    </div>
  );
}
