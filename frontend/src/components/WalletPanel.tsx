import { Check, Coins, Copy, KeyRound, RefreshCw, Wallet2 } from "lucide-react";
import { BURNER_SLOTS } from "../config";
import type { Portfolio, TxRecord } from "../types";
import { formatExact, shortAddress, shortHash, timeAgo } from "../lib/format";

interface WalletPanelProps {
  address: string;
  kind: "burner" | "metamask";
  slot: number;
  portfolio: Portfolio | null;
  busy: string | null;
  transactions: TxRecord[];
  onSwitchSlot: (slot: number) => void;
  onMint: () => void;
  onConnectMetaMask: () => void;
  onRefresh: () => void;
}

export function WalletPanel({
  address,
  kind,
  slot,
  portfolio,
  busy,
  transactions,
  onSwitchSlot,
  onMint,
  onConnectMetaMask,
  onRefresh,
}: WalletPanelProps) {
  return (
    <div className="space-y-3" data-testid="wallet-panel">
      <div className="rounded-xl border border-line bg-panel/80 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
            <Wallet2 size={13} /> {kind === "burner" ? "burner wallet" : "metamask identity"}
          </div>
          <span className="rounded border border-line bg-obsidian/60 px-1.5 py-0.5 text-[8.5px] uppercase tracking-wider text-muted">
            {kind}
          </span>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-line bg-obsidian/60 px-2.5 py-2">
          <span className="font-mono text-[11px] text-ink">{shortAddress(address)}</span>
          <button
            onClick={() => void navigator.clipboard.writeText(address)}
            className="rounded p-1 text-muted transition hover:text-ink"
            aria-label="Copy address"
          >
            <Copy size={12} />
          </button>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-line bg-obsidian/50 p-2.5">
            <div className="text-[8.5px] uppercase tracking-[0.14em] text-muted">liquid PGT</div>
            <div className="font-mono text-[15px] text-yes">{formatExact(portfolio?.balance ?? 0)}</div>
          </div>
          <div className="rounded-lg border border-line bg-obsidian/50 p-2.5">
            <div className="text-[8.5px] uppercase tracking-[0.14em] text-muted">positions</div>
            <div className="font-mono text-[15px] text-ink">{portfolio?.position_count ?? 0}</div>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            onClick={onMint}
            disabled={busy !== null}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-yes/35 bg-yes/10 px-2 py-2 text-[10.5px] font-medium text-yes transition hover:bg-yes/20 disabled:opacity-40"
            data-testid="mint-button"
          >
            <Coins size={12} /> {busy === "mint" ? "minting..." : "Mint 1000 PGT"}
          </button>
          <button
            onClick={onRefresh}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-line bg-obsidian/60 px-2 py-2 text-[10.5px] text-muted transition hover:text-ink"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-panel/80 p-4">
        <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted">
          <KeyRound size={12} /> switch identity
        </div>
        <div className="space-y-1.5">
          {BURNER_SLOTS.map((label, index) => (
            <button
              key={label}
              onClick={() => onSwitchSlot(index)}
              className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-[10.5px] transition ${
                kind === "burner" && slot === index
                  ? "border-yes/40 bg-yes/10 text-yes"
                  : "border-line bg-obsidian/50 text-muted hover:text-ink"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="flex h-4 w-4 items-center justify-center rounded-full border border-line font-mono text-[8px]">
                  {index + 1}
                </span>
                Burner {label}
              </span>
              {kind === "burner" && slot === index ? <Check size={12} /> : <span className="font-mono text-[9px]">switch</span>}
            </button>
          ))}
        </div>
        <button
          onClick={onConnectMetaMask}
          className="mt-2 w-full rounded-lg border border-no/35 bg-no/10 px-2 py-2 text-[10.5px] font-medium text-no transition hover:bg-no/20"
        >
          Connect MetaMask
        </button>
        <p className="mt-2 text-[9px] leading-relaxed text-muted">
          Burner keys are generated in this browser and stored locally. They sign real studionet transactions.
          MetaMask is used as an identity and read-only wallet unless the GenLayer snap is installed.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-panel/80 p-4">
        <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted">transaction feed</div>
        {transactions.length === 0 ? (
          <p className="text-[10px] text-muted">No transactions from this session yet.</p>
        ) : (
          <div className="space-y-1.5">
            {transactions.slice(0, 7).map((tx) => (
              <div key={`${tx.hash}-${tx.at}`} className="rounded border border-line/70 bg-obsidian/50 px-2 py-1.5">
                <div className="flex items-center justify-between text-[9.5px]">
                  <span className="font-mono text-ink">{tx.functionName}</span>
                  <span
                    className={
                      tx.status === "accepted" ? "text-yes" : tx.status === "error" ? "text-danger" : "text-amber"
                    }
                  >
                    {tx.status}
                  </span>
                </div>
                <div className="flex items-center justify-between font-mono text-[8.5px] text-muted">
                  <span>{shortHash(tx.hash)}</span>
                  <span>{timeAgo(tx.at)}</span>
                </div>
                {tx.message ? <div className="mt-0.5 truncate font-mono text-[8.5px] text-danger">{tx.message}</div> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
