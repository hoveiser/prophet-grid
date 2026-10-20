import { Activity, BookOpen, Clapperboard, Github, ShieldCheck, Volume2, VolumeX, Wallet } from "lucide-react";
import { EXPLORER_URL, NETWORK_LABEL, REPO_URL } from "../config";
import type { PlatformStats } from "../types";
import { formatToken, shortAddress } from "../lib/format";

interface HeaderProps {
  stats: PlatformStats | null;
  address: string;
  walletKind: "burner" | "metamask";
  muted: boolean;
  onToggleMute: () => void;
  onOpenWallet: () => void;
  onOpenConsensus: () => void;
  loading: boolean;
}

export function Header({
  stats,
  address,
  walletKind,
  muted,
  onToggleMute,
  onOpenWallet,
  onOpenConsensus,
  loading,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-obsidian/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-4 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="relative h-11 w-11 overflow-hidden rounded-xl border border-line bg-panel">
            <img src="./logo.png" alt="ProphetGrid" className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-transparent to-yes/10" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[17px] font-semibold tracking-tight text-ink">ProphetGrid</h1>
              <span className="rounded border border-line bg-panel2 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-muted">
                GenLayer
              </span>
            </div>
            <p className="text-[11px] text-muted">AI adjudicated conditional markets</p>
          </div>
        </div>

        <div className="ml-2 hidden items-center gap-2 rounded-lg border border-line bg-panel/70 px-3 py-1.5 lg:flex">
          <span className="h-1.5 w-1.5 animate-pulseLine rounded-full bg-yes" />
          <span className="text-[11px] font-medium text-ink">{NETWORK_LABEL}</span>
          <span className="font-mono text-[10px] text-muted">61999</span>
        </div>

        <div className="hidden flex-1 items-center justify-center gap-6 md:flex">
          <Metric label="Custody TVL" value={formatToken(stats?.tvl ?? 0)} suffix={stats?.token_symbol ?? "PGT"} loading={loading} />
          <Metric label="Volume" value={formatToken(stats?.total_volume ?? 0)} suffix="" loading={loading} />
          <Metric label="Markets" value={String(stats?.total_markets ?? 0)} suffix="" loading={loading} />
          <button
            onClick={onOpenConsensus}
            className="group flex items-center gap-2 rounded-lg border border-line bg-panel/60 px-2.5 py-1.5 text-[11px] text-muted transition hover:border-yes/40 hover:text-ink"
            title="Open the consensus and prompt inspector"
          >
            <ShieldCheck size={13} className={stats?.invariant_ok ? "text-yes" : "text-danger"} />
            <span className="font-mono">{stats?.invariant_ok ? "VAULT INVARIANT OK" : "INVARIANT CHECK"}</span>
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <a
            href={EXPLORER_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-lg border border-line bg-panel/60 px-2.5 py-2 text-[11px] text-muted transition hover:border-no/40 hover:text-ink sm:flex"
            title="Open the contract in the GenLayer explorer"
          >
            <Activity size={13} />
            <span className="font-mono">explorer</span>
          </a>
          <a
            href="./demo-video-subtitled.mp4"
            target="_blank"
            rel="noreferrer"
            data-testid="demo-video-link"
            className="hidden items-center gap-1.5 rounded-lg border border-line bg-panel/60 px-2.5 py-2 text-[11px] text-muted transition hover:border-violet/40 hover:text-ink sm:flex"
            title="Watch the subtitled demo video"
          >
            <Clapperboard size={13} />
            <span className="font-mono">demo</span>
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-lg border border-line bg-panel/60 px-2.5 py-2 text-[11px] text-muted transition hover:border-line hover:text-ink sm:flex"
          >
            <Github size={13} />
          </a>
          <button
            onClick={onToggleMute}
            className="rounded-lg border border-line bg-panel/60 p-2 text-muted transition hover:border-amber/40 hover:text-ink"
            title={muted ? "Unmute interface sound" : "Mute interface sound"}
            aria-label={muted ? "Unmute interface sound" : "Mute interface sound"}
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <button
            onClick={onOpenWallet}
            data-testid="wallet-button"
            className="flex items-center gap-2 rounded-lg border border-yes/30 bg-yes/10 px-3 py-2 text-[11px] font-medium text-yes transition hover:bg-yes/15"
          >
            <Wallet size={13} />
            <span className="font-mono">{shortAddress(address)}</span>
            <span className="hidden rounded bg-yes/15 px-1 py-0.5 text-[9px] uppercase tracking-wider md:inline">
              {walletKind}
            </span>
          </button>
          <button
            onClick={onOpenConsensus}
            className="rounded-lg border border-line bg-panel/60 p-2 text-muted transition hover:border-amber/40 hover:text-ink md:hidden"
            aria-label="Open consensus inspector"
          >
            <BookOpen size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}

function Metric({ label, value, suffix, loading }: { label: string; value: string; suffix: string; loading: boolean }) {
  return (
    <div className="min-w-[86px]">
      <div className="text-[9px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className={`font-mono text-[13px] text-ink ${loading ? "animate-pulse text-muted" : ""}`}>
        {value}
        {suffix ? <span className="ml-1 text-[10px] text-muted">{suffix}</span> : null}
      </div>
    </div>
  );
}
