import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Banknote, Copy, KeyRound, Loader, Search, Wallet2, X } from "lucide-react";
import { CHALLENGE_BOND_WEI, DESK_SLOTS, EXPLORER_URL, MIN_DEPOSIT_WEI } from "../config";
import type { DeskBook, TxBinding } from "../types";
import { pgt, shortHash } from "../lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
  address: string;
  mode: "local desk" | "injected wallet" | "watch only";
  slot: number;
  book: DeskBook | null;
  busy: string | null;
  transactions: TxBinding[];
  onSlot: (slot: number) => void;
  onMetaMask: () => void;
  onWatch: (address: string) => void;
  onDeposit: (units: number) => void;
  onSweepRefund: () => void;
  onTransfer: (to: string, units: number) => void;
}

export function DeskRegistry({
  open,
  onClose,
  address,
  mode,
  slot,
  book,
  busy,
  transactions,
  onSlot,
  onMetaMask,
  onWatch,
  onDeposit,
  onSweepRefund,
  onTransfer,
}: Props) {
  const [units, setUnits] = useState(20);
  const [peer, setPeer] = useState("");
  const [lookup, setLookup] = useState("");
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[65] flex justify-end bg-carbon/75 backdrop-blur-sm" onClick={onClose}>
      <aside
        data-testid="desk-panel"
        className="h-full w-full max-w-[460px] overflow-y-auto border-l border-edge bg-panel/95"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center gap-2 border-b border-edge bg-carbon/95 px-3 py-2.5 backdrop-blur">
          <Wallet2 size={13} className="text-amber" />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink">desk session</span>
          <span className="ml-2 border border-edge px-1.5 py-[1px] font-mono text-[9px] uppercase text-dim">
            {mode}
          </span>
          <button onClick={onClose} data-testid="desk-close" className="ml-auto text-dim transition hover:text-ink">
            <X size={14} />
          </button>
        </div>

        <div className="space-y-3 px-3 py-3">
          <div className="border border-edge bg-rack px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span className="grid-label">trading address</span>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(address).then(() => setCopied(true));
                }}
                className="ml-auto flex items-center gap-1 font-mono text-[9px] text-dim transition hover:text-ink"
              >
                <Copy size={10} /> {copied ? "copied" : "copy"}
              </button>
            </div>
            <div className="mt-1 break-all font-mono text-[11px] text-ink">{address}</div>
            <a
              href={EXPLORER_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block font-mono text-[9px] text-cyan hover:underline"
            >
              contract on the genlayer explorer
            </a>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {DESK_SLOTS.map((label, index) => (
              <button
                key={label}
                data-testid={`desk-slot-${index}`}
                onClick={() => onSlot(index)}
                disabled={busy !== null}
                className={`border px-2 py-1.5 font-mono text-[10px] uppercase transition disabled:opacity-50 ${
                  slot === index && mode === "local desk"
                    ? "border-amber/50 bg-amber/10 text-amber"
                    : "border-edge bg-rack text-dim hover:text-ink"
                }`}
              >
                <KeyRound size={10} className="mr-1 inline" />
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-px bg-edge/70 md:grid-cols-3">
            <Metric label="spendable" value={pgt(book?.balance_pgt ?? 0)} unit="PGT" />
            <Metric label="refundable" value={pgt(book?.refundable_wei ?? 0)} unit="PGT" tone="text-ask" />
            <Metric label="min deposit" value={pgt(MIN_DEPOSIT_WEI)} unit="PGT" />
          </div>

          <div className="border border-edge bg-rack px-2.5 py-2">
            <div className="flex items-center gap-2">
              <Banknote size={11} className="text-bid" />
              <span className="grid-label">deposit native collateral</span>
              <span className="ml-auto font-mono text-[10px] text-ink">{units} units</span>
            </div>
            <input
              type="range"
              min={1}
              max={60}
              value={units}
              data-testid="deposit-units"
              onChange={(event) => setUnits(Number(event.target.value))}
              className="mt-1.5 w-full"
            />
            <div className="mt-1.5 flex gap-1.5">
              <button
                data-testid="deposit-btn"
                onClick={() => onDeposit(units)}
                disabled={busy !== null || mode === "watch only"}
                className="flex flex-1 items-center justify-center gap-1.5 border border-bid/40 bg-bid/10 py-1.5 font-mono text-[10px] text-bid transition enabled:hover:bg-bid/20 disabled:opacity-40"
              >
                {busy === "deposit" ? <Loader size={11} className="animate-spin" /> : <ArrowDownLeft size={11} />}
                mint backed collateral
              </button>
              <button
                data-testid="sweep-refund"
                onClick={onSweepRefund}
                disabled={busy !== null || !book || book.refundable_wei <= 0}
                className="border border-amber/40 bg-amber/10 px-2 py-1.5 font-mono text-[10px] text-amber transition enabled:hover:bg-amber/20 disabled:opacity-40"
              >
                sweep refundable
              </button>
            </div>
            <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-dim">
              collateral is only minted against native value this address holds, so the ledger stays fully backed.
              A refused deposit is parked as a refundable claim instead of reverting.
            </p>
          </div>

          <div className="border border-edge bg-rack px-2.5 py-2">
            <div className="grid-label">settle collateral to another desk</div>
            <div className="mt-1.5 flex gap-1.5">
              <input
                value={peer}
                onChange={(event) => setPeer(event.target.value)}
                placeholder="0x..."
                className="min-w-0 flex-1 border border-edge bg-carbon px-2 py-1.5 font-mono text-[10px] text-ink outline-none placeholder:text-dim/60 focus:border-cyan/45"
              />
              <button
                data-testid="transfer-btn"
                onClick={() => onTransfer(peer, units)}
                disabled={busy !== null || peer.length < 42 || mode === "watch only"}
                className="flex items-center gap-1.5 border border-cyan/40 bg-cyan/10 px-2 py-1.5 font-mono text-[10px] text-cyan transition enabled:hover:bg-cyan/20 disabled:opacity-40"
              >
                <ArrowUpRight size={11} /> send
              </button>
            </div>
          </div>

          <div className="border border-edge bg-rack px-2.5 py-2">
            <div className="flex items-center gap-2">
              <Search size={11} className="text-dim" />
              <span className="grid-label">inspect another desk read only</span>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <input
                value={lookup}
                onChange={(event) => setLookup(event.target.value)}
                placeholder="0x trader address"
                className="min-w-0 flex-1 border border-edge bg-carbon px-2 py-1.5 font-mono text-[10px] text-ink outline-none placeholder:text-dim/60 focus:border-amber/45"
              />
              <button
                data-testid="watch-btn"
                onClick={() => onWatch(lookup)}
                disabled={lookup.length < 42}
                className="border border-edge px-2 py-1.5 font-mono text-[10px] text-dim transition hover:border-amber/45 hover:text-ink disabled:opacity-40"
              >
                load book
              </button>
            </div>
            <button
              data-testid="metamask-btn"
              onClick={onMetaMask}
              className="mt-1.5 w-full border border-violet/40 bg-violet/10 py-1.5 font-mono text-[10px] text-violet transition hover:bg-violet/20"
            >
              connect an injected wallet
            </button>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="grid-label">session blotter</span>
              <span className="ml-auto font-mono text-[9px] text-dim">
                bond floor {pgt(CHALLENGE_BOND_WEI)} PGT
              </span>
            </div>
            <div className="mt-1.5 space-y-1">
              {transactions.length === 0 ? (
                <div className="font-mono text-[10px] text-dim">no transactions signed from this session yet</div>
              ) : null}
              {transactions.map((item) => (
                <div key={item.id} className="border border-edge bg-rack px-2 py-1.5 font-mono text-[10px]">
                  <div className="flex items-center gap-2">
                    <span className="text-ink">{item.label}</span>
                    <span
                      className={
                        item.execution === "SUCCESS"
                          ? "text-bid"
                          : item.execution && item.execution.includes("ERROR")
                            ? "text-ask"
                            : "text-amber"
                      }
                    >
                      {item.execution ?? item.status ?? "pending"}
                    </span>
                    <a
                      href={`${EXPLORER_URL}/transactions/${item.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto text-dim hover:text-cyan"
                    >
                      {shortHash(item.hash)}
                    </a>
                  </div>
                  <div className="text-dim">
                    {item.status ?? "submitted"} · {new Date(item.at).toISOString().slice(11, 19)}Z
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Metric({ label, value, unit, tone }: { label: string; value: string; unit: string; tone?: string }) {
  return (
    <div className="bg-carbon px-2.5 py-2">
      <div className="grid-label">{label}</div>
      <div className={`font-mono text-[13px] tabular-nums ${tone ?? "text-ink"}`}>
        {value}
        <span className="ml-1 text-[9px] text-dim">{unit}</span>
      </div>
    </div>
  );
}
