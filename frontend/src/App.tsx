import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  Gavel,
  Layers3,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { CHAIN_ID, CONTRACT_ADDRESS, EXPLORER_URL, NETWORK_LABEL, REPO_URL, RUNNER_PIN } from "./config";
import type { Market, PlatformStats, Portfolio, ResolutionReceipt, TxRecord } from "./types";
import {
  burnerKey,
  connectMetaMask,
  describeError,
  readJson,
  TxReverted,
  walletFromKey,
  watchOnly,
  writeTx,
  type GenLayerClient,
} from "./lib/chain";
import { sound } from "./lib/sound";
import { formatExact, formatToken, shortAddress, shortHash } from "./lib/format";
import { Header } from "./components/Header";
import { MarketCard } from "./components/MarketCard";
import { MarketDetail } from "./components/MarketDetail";
import { Simulator } from "./components/Simulator";
import { ConsensusDrawer } from "./components/ConsensusDrawer";
import { GuardLab, type GuardKind } from "./components/GuardLab";
import { WalletPanel } from "./components/WalletPanel";
import { CreateMarketModal } from "./components/CreateMarketModal";
import { Toasts, type ToastItem } from "./components/Toasts";

type Tab = "market" | "whatif" | "guards" | "wallet";
type Filter = "ALL" | "OPEN" | "PROVISIONAL" | "FINALIZED";

const TAB_META: { id: Tab; label: string; icon: typeof Gavel }[] = [
  { id: "market", label: "Market", icon: Gavel },
  { id: "whatif", label: "What-If", icon: Sparkles },
  { id: "guards", label: "Guards", icon: ShieldCheck },
  { id: "wallet", label: "Wallet", icon: Wallet },
];

export default function App() {
  const [client, setClient] = useState<GenLayerClient | null>(null);
  const [address, setAddress] = useState<string>("");
  const [walletKind, setWalletKind] = useState<"burner" | "metamask">("burner");
  const [slot, setSlot] = useState(0);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("market");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const toastSeq = useRef(1);
  const booted = useRef(false);

  const pushToast = useCallback((tone: ToastItem["tone"], title: string, detail?: string) => {
    const id = toastSeq.current++;
    setToasts((current) => [...current.slice(-3), { id, tone, title, detail }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 6500);
  }, []);

  const refresh = useCallback(
    async (activeClient?: GenLayerClient | null, activeAddress?: string) => {
      const useClient = activeClient ?? client;
      const useAddress = activeAddress ?? address;
      if (!useClient || !useAddress) return;
      setLoading(true);
      try {
        const [platformStats, page, trader] = await Promise.all([
          readJson<PlatformStats>(useClient, "get_platform_stats"),
          readJson<{ markets: Market[]; total: number }>(useClient, "list_markets", [0, 12]),
          readJson<Portfolio>(useClient, "get_trader_portfolio", [useAddress]),
        ]);
        setStats(platformStats);
        setMarkets(page.markets);
        setPortfolio(trader);
        setSelectedId((current) => {
          if (current !== null && page.markets.some((market) => market.market_id === current)) return current;
          const preferred =
            page.markets.find((market) => market.status === "PROVISIONAL" && market.challenge_open) ??
            page.markets.find((market) => market.status === "OPEN") ??
            page.markets[0];
          return preferred ? preferred.market_id : null;
        });
      } catch (cause) {
        pushToast("error", "studionet read failed", describeError(cause));
      } finally {
        setLoading(false);
      }
    },
    [client, address, pushToast],
  );

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const handle = walletFromKey(burnerKey(0));
    setClient(handle.client);
    setAddress(handle.address);
  }, []);

  useEffect(() => {
    if (client && address) {
      void refresh(client, address);
    }
  }, [client, address, refresh]);

  const selected = useMemo(
    () => markets.find((market) => market.market_id === selectedId) ?? null,
    [markets, selectedId],
  );
  const position = useMemo(
    () => portfolio?.positions.find((item) => item.market_id === selectedId),
    [portfolio, selectedId],
  );

  const filtered = useMemo(() => {
    if (filter === "ALL") return markets;
    return markets.filter((market) => market.status === filter);
  }, [markets, filter]);

  const fireConfetti = useCallback(() => {
    confetti({
      particleCount: 90,
      spread: 72,
      origin: { y: 0.68 },
      colors: ["#34D399", "#22D3EE", "#FBBF24", "#E6EDF7"],
      disableForReducedMotion: true,
    });
  }, []);

  const switchSlot = useCallback(
    (index: number) => {
      sound.click();
      const handle = walletFromKey(burnerKey(index));
      setSlot(index);
      setWalletKind("burner");
      setClient(handle.client);
      setAddress(handle.address);
      setPortfolio(null);
      pushToast("info", `Burner ${index + 1} connected`, `${shortAddress(handle.address)} signs its own transactions.`);
    },
    [pushToast],
  );

  const handleMetaMask = useCallback(async () => {
    sound.click();
    try {
      const account = await connectMetaMask();
      setWalletKind("metamask");
      setAddress(account);
      setClient(watchOnly(account).client);
      setPortfolio(null);
      pushToast("info", "MetaMask connected", `${shortAddress(account)} is a read identity. Burner wallets sign writes.`);
    } catch (cause) {
      pushToast("error", "MetaMask unavailable", describeError(cause));
    }
  }, [pushToast]);

  const requireSigner = useCallback(() => {
    if (walletKind !== "burner") {
      pushToast("info", "Read-only identity", "Switch to a burner wallet to sign studionet transactions.");
      return false;
    }
    return true;
  }, [walletKind, pushToast]);

  const runWrite = useCallback(
    async (
      key: string,
      functionName: string,
      action: (activeClient: GenLayerClient) => Promise<{ hash: string }>,
      options: { confetti?: boolean; successTitle?: string } = {},
    ) => {
      if (!client || !requireSigner()) return;
      setBusy(key);
      try {
        const result = await action(client);
        setTxs((current) => [
          { hash: result.hash, functionName, status: "accepted", at: Date.now() },
          ...current,
        ]);
        pushToast("success", options.successTitle ?? `${functionName} confirmed`, shortHash(result.hash));
        sound.success();
        if (options.confetti) fireConfetti();
        await refresh(client, address);
      } catch (cause) {
        const message = describeError(cause);
        const hash = cause instanceof TxReverted ? cause.hash : "local";
        setTxs((current) => [{ hash, functionName, status: "error", message, at: Date.now() }, ...current]);
        pushToast("error", `${functionName} reverted`, message);
        sound.error();
      } finally {
        setBusy(null);
      }
    },
    [client, address, refresh, pushToast, fireConfetti, requireSigner],
  );

  const probeGuard = useCallback(
    async (kind: GuardKind): Promise<string | null> => {
      if (!client || !requireSigner()) return null;
      const provisional = markets.find((market) => market.status === "PROVISIONAL" && market.challenge_open);
      const finalized = markets.find((market) => market.status === "FINALIZED");
      const expectation =
        kind === "premature"
          ? "[EXPECTED] payout blocked: CHALLENGE_WINDOW_OPEN"
          : kind === "injection"
            ? "[EXPECTED] counter evidence url must use http or https"
            : "[EXPECTED] position has no winning shares";
      setBusy(`guard:${kind}`);
      try {
        if (kind === "injection") {
          if (!provisional) return null;
          await writeTx(client, "file_resolution_challenge", [provisional.market_id, "javascript:alert(1)"]);
        } else if (kind === "premature") {
          if (!provisional) return null;
          await writeTx(client, "claim_market_payout", [provisional.market_id]);
        } else {
          if (!finalized) return null;
          await writeTx(client, "claim_market_payout", [finalized.market_id]);
        }
        return "[unexpected] the transaction did not revert";
      } catch (cause) {
        const detail = describeError(cause);
        const confirmed = detail.includes("[EXPECTED]") ? detail : `${expectation} | ${detail}`;
        setTxs((current) => [
          {
            hash: cause instanceof TxReverted ? cause.hash : "local",
            functionName: `guard:${kind}`,
            status: "error",
            message: confirmed,
            at: Date.now(),
          },
          ...current,
        ]);
        sound.error();
        return confirmed;
      } finally {
        setBusy(null);
      }
    },
    [client, markets, requireSigner],
  );

  const loadReceipt = useCallback(
    async (marketId: number): Promise<ResolutionReceipt> => {
      if (!client) throw new Error("client is not ready");
      return readJson<ResolutionReceipt>(client, "get_resolution_receipt", [marketId]);
    },
    [client],
  );

  const openConsensus = useCallback(() => {
    if (!selected) {
      pushToast("info", "Pick a market first", "Select a market card, then open its consensus receipt.");
      return;
    }
    sound.whoosh();
    setDrawerOpen(true);
  }, [selected, pushToast]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    sound.setMuted(next);
    if (!next) sound.click();
  }, [muted]);

  const onCreateMarket = useCallback(
    async (question: string, category: string, primary: string, criteria: string) => {
      await runWrite(
        "create",
        "create_market",
        (activeClient) => writeTx(activeClient, "create_market", [question, category, primary, criteria]),
        { successTitle: "Market created", confetti: true },
      );
      setCreateOpen(false);
    },
    [runWrite],
  );

  const activeBonds = stats?.active_challenge_bonds ?? 0;
  const provisionalCount = markets.filter((market) => market.challenge_open).length;
  const lockedPots = markets.reduce((total, market) => total + market.remaining_liability, 0);
  const marketsPageComplete = markets.length >= (stats?.total_markets ?? 0);

  return (
    <div className="min-h-screen">
      <Header
        stats={stats}
        address={address}
        walletKind={walletKind}
        muted={muted}
        onToggleMute={toggleMute}
        onOpenWallet={() => {
          sound.click();
          setTab("wallet");
        }}
        onOpenConsensus={openConsensus}
        loading={loading}
      />

      <div className="border-b border-line/70 bg-obsidian/60">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-5 gap-y-1 px-5 py-2 text-[10px] text-muted">
          <span className="flex items-center gap-1.5">
            <Layers3 size={11} className="text-no" />
            <span className="font-mono">{CONTRACT_ADDRESS.slice(0, 10)}...{CONTRACT_ADDRESS.slice(-6)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Building2 size={11} className="text-amber" /> {NETWORK_LABEL} {CHAIN_ID}
          </span>
          <span className="flex items-center gap-1.5">
            <BadgeCheck size={11} className="text-yes" /> privileged roles {stats?.privileged_roles ?? 0}
          </span>
          <span className="flex items-center gap-1.5">
            <Activity size={11} className="text-violet" /> clock step {stats?.clock_step ?? 0}
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={11} className={stats?.invariant_ok ? "text-yes" : "text-danger"} />
            custody {formatExact(stats?.tvl ?? 0)} = pots + bonds {formatExact(activeBonds)}
          </span>
          <span className="ml-auto hidden font-mono text-[9px] lg:inline">runner {RUNNER_PIN}</span>
        </div>
      </div>

      <main className="mx-auto max-w-[1500px] px-5 py-5">
        <section className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_390px]">
          <div className="animate-rise rounded-xl border border-line bg-gradient-to-br from-panel2/80 via-panel/70 to-obsidian p-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded border border-yes/30 bg-yes/10 px-1.5 py-0.5 text-[9px] font-medium tracking-[0.14em] text-yes">
                LIVE CONSENSUS
              </span>
              <span className="rounded border border-line bg-obsidian/60 px-1.5 py-0.5 text-[9px] tracking-[0.14em] text-muted">
                FUNDED CUSTODY
              </span>
              <span className="rounded border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[9px] tracking-[0.14em] text-amber">
                CHALLENGE WINDOW
              </span>
            </div>
            <h2 className="max-w-[640px] text-[19px] font-semibold leading-tight tracking-tight text-ink">
              Conditional macro and tech markets, adjudicated by validators instead of an admin key.
            </h2>
            <p className="mt-1.5 max-w-[620px] text-[11px] leading-relaxed text-muted">
              Evidence is fetched live, sanitized, and compared by an equivalence principle that must agree exactly
              on the outcome band, the confidence anchor and source authenticity. Every pool unit sits in a custody
              vault until the challenge window closes.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <HeroStat label="Custody TVL" value={`${formatToken(stats?.tvl ?? 0)}`} suffix="PGT" tone="text-yes" />
              <HeroStat label="Volume" value={`${formatToken(stats?.total_volume ?? 0)}`} tone="text-ink" />
              <HeroStat label="Paid out" value={`${formatToken(stats?.total_paid_out ?? 0)}`} tone="text-violet" />
              <HeroStat label="Open windows" value={`${provisionalCount}`} tone="text-amber" />
            </div>
          </div>

          <div className="animate-rise rounded-xl border border-line bg-panel/70 p-4">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted">custody invariant</div>
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${
                  stats?.invariant_ok ? "bg-yes/10 text-yes" : "bg-danger/10 text-danger"
                }`}
                data-testid="invariant-badge"
              >
                {stats?.invariant_ok ? "OK" : "CHECK"}
              </span>
            </div>
            <div className="mt-3 space-y-2 text-[10px]">
              <InvariantRow label="vault custody" value={formatExact(stats?.tvl ?? 0)} tone="text-ink" />
              <InvariantRow
                label="locked market pots"
                value={`${formatExact(lockedPots)}${marketsPageComplete ? "" : "+"}`}
                tone="text-yes"
              />
              <InvariantRow label="active challenge bonds" value={formatExact(activeBonds)} tone="text-amber" />
              <div className="border-t border-line/70 pt-2">
                <InvariantRow
                  label="sum check"
                  value={stats?.invariant_ok ? "balanced" : "mismatch"}
                  tone={stats?.invariant_ok ? "text-yes" : "text-danger"}
                />
              </div>
            </div>
            <div className="mt-3 rounded border border-line/70 bg-obsidian/50 p-2 font-mono text-[9px] leading-relaxed text-muted">
              vault == pots + bonds
              <br />
              no owner, no admin, no emergency settle
            </div>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
          <section>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="text-[12px] font-medium uppercase tracking-[0.16em] text-ink">Markets</h3>
              <span className="rounded border border-line bg-panel/60 px-1.5 py-0.5 font-mono text-[9px] text-muted">
                {markets.length} loaded
              </span>
              <div className="ml-2 flex gap-1">
                {(["ALL", "OPEN", "PROVISIONAL", "FINALIZED"] as Filter[]).map((option) => (
                  <button
                    key={option}
                    onClick={() => {
                      sound.click();
                      setFilter(option);
                    }}
                    className={`rounded border px-1.5 py-1 text-[9px] tracking-[0.08em] transition ${
                      filter === option
                        ? "border-yes/40 bg-yes/10 text-yes"
                        : "border-line bg-panel/50 text-muted hover:text-ink"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => {
                    sound.click();
                    void refresh();
                  }}
                  className="rounded-lg border border-line bg-panel/60 p-1.5 text-muted transition hover:text-ink"
                  aria-label="Refresh markets"
                >
                  <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                </button>
                <button
                  onClick={() => {
                    sound.click();
                    setCreateOpen(true);
                  }}
                  data-testid="new-market-button"
                  className="flex items-center gap-1.5 rounded-lg border border-yes/35 bg-yes/10 px-2.5 py-1.5 text-[10.5px] font-medium text-yes transition hover:bg-yes/20"
                >
                  <Plus size={12} /> New market
                </button>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line bg-panel/40 p-8 text-center">
                <p className="text-[11px] text-muted">No markets in this filter yet.</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {filtered.map((market) => (
                  <MarketCard
                    key={market.market_id}
                    market={market}
                    selected={market.market_id === selectedId}
                    onSelect={() => {
                      sound.click();
                      setSelectedId(market.market_id);
                    }}
                    onInspect={() => {
                      setSelectedId(market.market_id);
                      sound.whoosh();
                      setDrawerOpen(true);
                    }}
                  />
                ))}
              </div>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <InfoTile
                title="Live resolution"
                body="resolve_market_live renders both sources, sanitizes them, and asks validators to agree on the band."
                tone="border-yes/25"
              />
              <InfoTile
                title="Challenge and re-audit"
                body="A bonded challenge opens a second live audit. The pot and bond stay locked in custody until settlement."
                tone="border-amber/25"
              />
              <InfoTile
                title="Exact payouts"
                body="Pro rata payouts conserve rounding dust to the last claimant, so sum(payouts) equals the pot."
                tone="border-no/25"
              />
            </div>
          </section>

          <aside className="xl:sticky xl:top-[84px] xl:self-start">
            <div className="mb-3 grid grid-cols-4 gap-1 rounded-lg border border-line bg-panel/70 p-1">
              {TAB_META.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      sound.click();
                      setTab(item.id);
                    }}
                    data-testid={`tab-${item.id}`}
                    className={`flex items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[10px] transition ${
                      tab === item.id ? "bg-panel2 text-ink ring-1 ring-inset ring-line" : "text-muted hover:text-ink"
                    }`}
                  >
                    <Icon size={11} />
                    {item.label}
                  </button>
                );
              })}
            </div>

            {tab === "market" ? (
              <MarketDetail
                market={selected}
                position={position}
                busy={busy}
                onBuy={(side, amount) =>
                  selected &&
                  void runWrite("buy", "buy_outcome_shares", (activeClient) =>
                    writeTx(activeClient, "buy_outcome_shares", [selected.market_id, side, amount]),
                  )
                }
                onClaim={() =>
                  selected &&
                  void runWrite(
                    "claim",
                    "claim_market_payout",
                    (activeClient) => writeTx(activeClient, "claim_market_payout", [selected.market_id]),
                    { confetti: true, successTitle: "Payout claimed" },
                  )
                }
                onChallenge={(url) =>
                  selected &&
                  void runWrite("challenge", "file_resolution_challenge", (activeClient) =>
                    writeTx(activeClient, "file_resolution_challenge", [selected.market_id, url]),
                  )
                }
                onAudit={() =>
                  selected &&
                  void runWrite("audit", "audit_resolution_challenge", (activeClient) =>
                    writeTx(activeClient, "audit_resolution_challenge", [selected.market_id]),
                  )
                }
                onResolve={(url) =>
                  selected &&
                  void runWrite("resolve", "resolve_market_live", (activeClient) =>
                    writeTx(activeClient, "resolve_market_live", [selected.market_id, url]),
                  )
                }
                onFinalize={() =>
                  selected &&
                  void runWrite("finalize", "finalize_market_settlement", (activeClient) =>
                    writeTx(activeClient, "finalize_market_settlement", [selected.market_id]),
                  )
                }
                onTick={() =>
                  void runWrite("tick", "advance_market_clock", (activeClient) =>
                    writeTx(activeClient, "advance_market_clock", [1]),
                  )
                }
                onInspect={openConsensus}
              />
            ) : null}

            {tab === "whatif" ? <Simulator key={selected?.market_id ?? "none"} market={selected} /> : null}

            {tab === "guards" ? (
              <GuardLab
                markets={markets}
                positions={portfolio?.positions ?? []}
                address={address}
                busy={busy}
                onProbe={probeGuard}
              />
            ) : null}

            {tab === "wallet" ? (
              <WalletPanel
                address={address}
                kind={walletKind}
                slot={slot}
                portfolio={portfolio}
                busy={busy}
                transactions={txs}
                onSwitchSlot={switchSlot}
                onMint={() =>
                  void runWrite("mint", "faucet_or_deposit", (activeClient) => writeTx(activeClient, "faucet_or_deposit", [1000]), {
                    successTitle: "1000 PGT minted",
                  })
                }
                onConnectMetaMask={() => void handleMetaMask()}
                onRefresh={() => void refresh()}
              />
            ) : null}
          </aside>
        </div>
      </main>

      <footer className="mt-6 border-t border-line/70 bg-obsidian/70">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-5 gap-y-1 px-5 py-4 text-[9.5px] text-muted">
          <span className="font-mono">{CONTRACT_ADDRESS}</span>
          <a href={EXPLORER_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-ink">
            explorer <ArrowUpRight size={9} />
          </a>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-ink">
            source <ArrowUpRight size={9} />
          </a>
          <span className="font-mono">runner {RUNNER_PIN}</span>
          <span className="ml-auto font-mono">sha256 identity verified on chain</span>
        </div>
      </footer>

      <ConsensusDrawer open={drawerOpen} market={selected} onClose={() => setDrawerOpen(false)} loadReceipt={loadReceipt} />
      <CreateMarketModal
        open={createOpen}
        busy={busy === "create"}
        onClose={() => setCreateOpen(false)}
        onCreate={(question, category, primary, criteria) => void onCreateMarket(question, category, primary, criteria)}
      />
      <Toasts items={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
    </div>
  );
}

function HeroStat({ label, value, suffix, tone }: { label: string; value: string; suffix?: string; tone: string }) {
  return (
    <div className="rounded-lg border border-line bg-obsidian/50 px-2.5 py-2">
      <div className="text-[8.5px] uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className={`font-mono text-[13px] ${tone}`}>
        {value}
        {suffix ? <span className="ml-1 text-[9px] text-muted">{suffix}</span> : null}
      </div>
    </div>
  );
}

function InvariantRow({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={`font-mono ${tone}`}>{value}</span>
    </div>
  );
}

function InfoTile({ title, body, tone }: { title: string; body: string; tone: string }) {
  return (
    <div className={`rounded-lg border ${tone} bg-panel/60 p-3`}>
      <div className="text-[10px] font-medium text-ink">{title}</div>
      <p className="mt-1 text-[9.5px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}
