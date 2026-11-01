import { useEffect, useState, type ReactNode } from "react";
import { Landmark, Scale, Wallet } from "lucide-react";
import type { CustodyReport, PlatformStats } from "../types";
import { nativeBalanceOfContract } from "../lib/chain";
import { pgt, pgtShort } from "../lib/format";

interface Props {
  stats: PlatformStats | null;
  custody: CustodyReport | null;
}

export function SolvencyBoard({ stats, custody }: Props) {
  const [chainNative, setChainNative] = useState<bigint | null>(null);

  useEffect(() => {
    let cancelled = false;
    nativeBalanceOfContract()
      .then((value) => {
        if (!cancelled) setChainNative(value);
      })
      .catch(() => setChainNative(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const reported = BigInt(Math.round(custody?.native_custody_balance ?? stats?.native_custody_wei ?? 0));
  const matches = chainNative !== null && chainNative === reported;

  return (
    <section className="rail" data-testid="solvency-board">
      <div className="flex items-center gap-2 border-b border-edge bg-panel/70 px-3 py-2">
        <Scale size={13} className="text-bid" />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink">
          custody accounting and solvency rail
        </span>
        <span
          className={`ml-auto border px-2 py-[2px] font-mono text-[9px] uppercase tracking-wider ${
            custody?.ok ? "border-bid/40 bg-bid/10 text-bid" : "border-ask/40 bg-ask/10 text-ask"
          }`}
        >
          {custody?.ok ? "invariant holds" : "invariant not verified"}
        </span>
      </div>

      <div className="grid gap-px bg-edge/70 md:grid-cols-4">
        <Block label="total supply" value={pgt(custody?.total_supply ?? 0)} note="PGT units minted" tone="text-amber" />
        <Block label="wallet balances" value={pgt(custody?.wallet_balances ?? 0)} note="spendable by desks" />
        <Block label="vault custody" value={pgt(custody?.vault_custody_balance ?? 0)} note="reserved inside the contract" tone="text-cyan" />
        <Block label="native value held" value={pgt(reported)} note="GEN wei locked on the address" tone="text-lime" />
      </div>

      <div className="px-3 py-2.5">
        <div className="grid gap-1.5 md:grid-cols-2">
          <Term label="locked market pots" value={custody?.locked_market_pots ?? 0} total={custody?.vault_custody_balance ?? 1} tone="bg-amber" />
          <Term label="pending challenge bonds" value={custody?.pending_challenge_bonds ?? 0} total={custody?.vault_custody_balance ?? 1} tone="bg-ask" />
          <Term label="hedge reservations" value={custody?.hedge_reservations ?? 0} total={custody?.vault_custody_balance ?? 1} tone="bg-lime" />
          <Term label="refundable deposits" value={custody?.refundable_native ?? 0} total={custody?.vault_custody_balance ?? 1} tone="bg-cyan" />
          <Term label="protocol fee reserve" value={custody?.protocol_reserve ?? 0} total={custody?.vault_custody_balance ?? 1} tone="bg-violet" />
        </div>

        <div className="mt-2.5 grid gap-2 md:grid-cols-2">
          <Panel icon={Landmark} title="conservation identity">
            <p className="font-mono text-[9px] leading-relaxed text-dim">
              total supply equals the native value this address holds, and equals wallet balances plus the vault.
              The vault equals pots plus bonds plus hedge reservations plus the fee reserve plus refundable deposits.
              Every write path in the contract moves both sides of that identity together.
            </p>
          </Panel>
          <Panel icon={Wallet} title="node balance cross check">
            <div className="flex items-baseline gap-2 font-mono text-[11px]">
              <span className="text-ink">{chainNative === null ? "unavailable" : pgt(chainNative)}</span>
              <span className="text-dim">reported {pgt(reported)}</span>
              <span className={`ml-auto ${matches ? "text-bid" : "text-amber"}`}>
                {chainNative === null ? "cors blocked" : matches ? "exact match" : "mismatch"}
              </span>
            </div>
            <p className="mt-1 font-mono text-[9px] leading-relaxed text-dim">
              read directly from the studionet node with eth_getBalance, not from contract storage, so the collateral
              claim is checked against the chain itself.
            </p>
          </Panel>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-px bg-edge/70 md:grid-cols-5">
          <Block label="notional" value={pgtShort(stats?.total_volume ?? 0)} note="lifetime" />
          <Block label="paid out" value={pgtShort(stats?.total_paid_out ?? 0)} note="settled books" tone="text-bid" />
          <Block label="refunded" value={pgtShort(stats?.total_refunded ?? 0)} note="principal returned" tone="text-lime" />
          <Block label="soft fails" value={String(custody?.soft_fail_count ?? 0)} note="refused payables parked" tone="text-ask" />
          <Block label="privileged roles" value={String(stats?.privileged_roles ?? 0)} note="no admin key exists" />
        </div>
      </div>
    </section>
  );
}

function Block({ label, value, note, tone }: { label: string; value: string; note: string; tone?: string }) {
  return (
    <div className="bg-carbon px-3 py-2">
      <div className="grid-label">{label}</div>
      <div className={`font-mono text-[13px] leading-tight tabular-nums ${tone ?? "text-ink"}`}>{value}</div>
      <div className="font-mono text-[9px] text-dim">{note}</div>
    </div>
  );
}

function Term({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const share = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between font-mono text-[10px]">
        <span className="text-dim">{label}</span>
        <span className="text-ink">{pgt(value)}</span>
      </div>
      <div className="mt-1 h-1.5 bg-edge/60">
        <div className={`h-full ${tone}`} style={{ width: `${Math.max(1.5, share)}%` }} />
      </div>
    </div>
  );
}

function Panel({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Landmark;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border border-edge bg-rack/70 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <Icon size={11} className="text-dim" />
        <span className="grid-label">{title}</span>
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
