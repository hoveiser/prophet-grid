import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import {
  ArrowDownLeft,
  BookOpenCheck,
  Github,
  LayoutGrid,
  LineChart,
  Loader,
  ScanLine,
  Video,
} from "lucide-react";
import {
  CHALLENGE_BOND_WEI,
  CONTRACT_ADDRESS,
  EXPLORER_URL,
  MIN_DEPOSIT_WEI,
  NETWORK_LABEL,
  REPO_URL,
} from "./config";
import type {
  ConsensusPolicy,
  CustodyReport,
  DeskBook,
  EcosystemFeed,
  HedgeRow,
  MarketPage,
  PlatformStats,
  PositionRow,
  ResolutionReceipt,
  SettlementSnapshot,
  TxBinding,
} from "./types";
import type { Signal } from "./ui/SignalStrip";
import {
  connectMetaMask,
  deskFromKey,
  deskSlot,
  readContract,
  selectDeskSlot,
  sendTransaction,
  TxReverted,
  watchDesk,
  describeFailure,
  type TerminalClient,
} from "./lib/chain";
import { audio } from "./lib/terminalAudio";
import { pgt, shortDesk } from "./lib/format";
import { TerminalChrome } from "./ui/TerminalChrome";
import { OrderbookMatrix } from "./ui/OrderbookMatrix";
import { LegTicket } from "./ui/LegTicket";
import { PayoffCurveModeler } from "./ui/PayoffCurveModeler";
import { OracleTelemetry } from "./ui/OracleTelemetry";
import { SolvencyBoard } from "./ui/SolvencyBoard";
import { DeskRegistry } from "./ui/DeskRegistry";
import { ListingConsole, type Draft } from "./ui/ListingConsole";
import { SignalStrip } from "./ui/SignalStrip";

type Workspace = "books" | "model" | "telemetry";

const UNIT = 10 ** 15;

export default function App() {
  const [desk, setDesk] = useState(() => deskFromKey(selectDeskSlot(deskSlot())));
  const [mode, setMode] = useState<"local desk" | "injected wallet" | "watch only">("local desk");
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [custody, setCustody] = useState<CustodyReport | null>(null);
  const [markets, setMarkets] = useState<SettlementSnapshot[]>([]);
  const [book, setBook] = useState<DeskBook | null>(null);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [hedges, setHedges] = useState<HedgeRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>("books");
  const [busy, setBusy] = useState<string | null>(null);
  const [silenced, setSilenced] = useState(false);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [transactions, setTransactions] = useState<TxBinding[]>([]);
  const [deskOpen, setDeskOpen] = useState(false);
  const [listingOpen, setListingOpen] = useState(false);
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const [policy, setPolicy] = useState<ConsensusPolicy | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [booting, setBooting] = useState(true);
  const [errors, setErrors] = useState<string | null>(null);
  const sequence = useRef(1);

  /** Anyone may list a book, so empty listings exist. They are hidden by default. */
  const books = useMemo(
    () => (showEmpty ? markets : markets.filter((row) => row.pot > 0 || row.status !== "OPEN")),
    [markets, showEmpty],
  );
  const hiddenBooks = markets.length - books.length;

  const active = useMemo(
    () => books.find((row) => row.market_id === selected) ?? books[0] ?? null,
    [books, selected],
  );

  const notify = useCallback((tone: Signal["tone"], title: string, detail?: string) => {
    const item: Signal = { id: sequence.current++, tone, title, detail };
    setSignals((current) => [...current.slice(-4), item]);
    window.setTimeout(() => {
      setSignals((current) => current.filter((entry) => entry.id !== item.id));
    }, 9000);
  }, []);

  const loadDeskViews = useCallback(
    async (client: TerminalClient, address: string) => {
      const next = await readContract<DeskBook>(client, "get_trader_portfolio", [address]);
      setBook(next);
      setPositions(next.positions ?? []);
      setHedges(next.hedges ?? []);
    },
    [],
  );

  /** Initial paint costs exactly four RPC calls to stay inside the rate limit. */
  const refresh = useCallback(
    async (client: TerminalClient, address: string) => {
      const [nextStats, page, nextCustody] = await Promise.all([
        readContract<PlatformStats>(client, "get_platform_stats"),
        readContract<MarketPage>(client, "list_markets", [0, 8]),
        readContract<CustodyReport>(client, "get_custody_accounting_summary"),
      ]);
      setStats(nextStats);
      setMarkets(page.rows);
      setCustody(nextCustody);
      if (!selected && page.rows.length > 0) setSelected(page.rows[0].market_id);
      await loadDeskViews(client, address);
    },
    [loadDeskViews, selected],
  );

  /** The consensus policy is static per deployment, so it is fetched once on demand. */
  const ensurePolicy = useCallback(async () => {
    if (policy) return;
    try {
      setPolicy(await readContract<ConsensusPolicy>(desk.client, "get_consensus_policy"));
    } catch {
      setPolicy(null);
    }
  }, [desk, policy]);

  useEffect(() => {
    let cancelled = false;
    setBooting(true);
    refresh(desk.client, desk.address)
      .catch((error: unknown) => {
        if (!cancelled) setErrors(describeFailure(error));
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [desk, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || busy) return;
      refresh(desk.client, desk.address).catch(() => undefined);
    }, 45000);
    return () => window.clearInterval(timer);
  }, [busy, desk, refresh]);

  const logTx = (label: string, outcome: { hash: string; execution: string | null; status: string | null }) => {
    setTransactions((current) =>
      [
        { id: sequence.current++, label, hash: outcome.hash, execution: outcome.execution, status: outcome.status, at: Date.now() },
        ...current,
      ].slice(0, 12),
    );
  };

  const run = useCallback(
    async (label: string, functionName: string, args: unknown[], valueWei: bigint = 0n, cheer = false) => {
      if (!desk.writable) {
        notify("halt", "desk is read only", "switch to a local desk or connect a wallet to sign");
        audio.play("reject");
        return null;
      }
      setBusy(label);
      try {
        const outcome = await sendTransaction(desk.client, functionName, args, valueWei);
        logTx(label, outcome);
        audio.play(cheer ? "settle" : outcome.execution === "SUCCESS" ? "fill" : "print");
        if (cheer) {
          confetti({ particleCount: 70, spread: 62, origin: { y: 0.4 }, colors: ["#FF9500", "#00E5FF", "#10B981"] });
        }
        notify("ok", `${label} settled on chain`, `tx ${outcome.hash.slice(0, 18)}...`);
        await refresh(desk.client, desk.address);
        return outcome;
      } catch (error) {
        if (error instanceof TxReverted) {
          logTx(label, { hash: error.hash, execution: error.execution, status: "REVERTED" });
          audio.play("reject");
          notify("halt", `${label} refused by the contract`, error.message);
        } else {
          audio.play("reject");
          notify("halt", `${label} did not land`, describeFailure(error));
        }
        return null;
      } finally {
        setBusy(null);
      }
    },
    [desk, notify, refresh],
  );

  const onStake = (side: "YES" | "NO", amountWei: bigint, native: boolean) => {
    audio.play("depth");
    return native
      ? run(`take ${side} native leg`, "acquire_outcome_shares_payable", [active?.market_id ?? "0", side], amountWei)
      : run(`take ${side} leg`, "buy_outcome_shares", [active?.market_id ?? "0", side, amountWei]);
  };

  const onResolve = (url: string) => run("consensus adjudication", "resolve_market_via_consensus", [active?.market_id ?? "0", url]);

  const onChallenge = (url: string, native: boolean) =>
    native
      ? run("bonded challenge", "challenge_market_resolution_payable", [active?.market_id ?? "0", url],
          BigInt(CHALLENGE_BOND_WEI) * 2n)
      : run("bonded challenge", "file_resolution_challenge", [active?.market_id ?? "0", url]);

  const onAudit = () => run("re-audit of the print", "audit_resolution_challenge", [active?.market_id ?? "0"]);
  const onFinalize = () => run("settlement locked", "finalize_market_settlement", [active?.market_id ?? "0"]);
  const onClaim = () => run("payout withdrawn", "claim_market_winnings", [active?.market_id ?? "0"], 0n, true);
  const onRefund = () => run("principal refunded", "claim_refund", [active?.market_id ?? "0"], 0n, true);
  const onSweepRefund = () => run("refundable swept", "claim_refundable_balance", []);

  const onDeposit = (units: number) =>
    run("native deposit", "fund_pgt_vault_payable", [], BigInt(units) * BigInt(UNIT));

  const onTransfer = (to: string, units: number) =>
    run("collateral settled", "transfer_tokens", [to, BigInt(units) * BigInt(UNIT)]);

  const onReleaseHedge = (hedge: HedgeRow) =>
    run(`basket ${hedge.hedge_id} released`, "release_conditional_hedge", [hedge.hedge_id], 0n, true);

  const onCreate = async (draft: Draft) => {
    const outcome = await run("book listed", "create_market", [
      draft.question,
      draft.category,
      draft.primary,
      draft.secondary,
      draft.criteria,
      draft.strike,
      draft.corridor,
      draft.closeWindow,
      draft.challengeWindow,
      draft.timeoutMargin,
    ]);
    if (outcome) setListingOpen(false);
  };

  const switchSlot = (index: number) => {
    const key = selectDeskSlot(index);
    setDesk(deskFromKey(key));
    setMode("local desk");
    audio.play("tape");
  };

  const useMetaMask = async () => {
    try {
      const handle = await connectMetaMask();
      setDesk({ client: handle.client, address: handle.address, writable: handle.writable });
      setMode("injected wallet");
      notify("note", "injected wallet attached", shortDesk(handle.address));
    } catch (error) {
      notify("halt", "wallet connect refused", describeFailure(error));
    }
  };

  const watchAddress = (value: string) => {
    const handle = watchDesk(value);
    setDesk(handle);
    setMode("watch only");
    notify("note", "watching another desk book", shortDesk(handle.address));
  };

  const loadFeed = useCallback(
    async (marketId: string): Promise<{ receipt: ResolutionReceipt; feed: EcosystemFeed }> => {
      const client = desk.client;
      const [receipt, feed] = await Promise.all([
        readContract<ResolutionReceipt>(client, "get_resolution_receipt", [marketId]),
        readContract<EcosystemFeed>(client, "get_ecosystem_market_feed", [marketId]),
      ]);
      return { receipt, feed };
    },
    [desk],
  );

  const togglingAudio = () => {
    const next = !silenced;
    setSilenced(next);
    audio.setSilent(next);
    if (!next) audio.play("sweep");
  };

  const basketCount = hedges.filter((item) => item.state === "LOCKED").length;

  return (
    <div className="min-h-screen">
      <TerminalChrome
        stats={stats}
        markets={books}
        desk={desk.address}
        mode={mode}
        silenced={silenced}
        live={!booting && !errors}
        onToggleAudio={togglingAudio}
        onOpenDesk={() => setDeskOpen(true)}
        onRefresh={() => {
          audio.play("tape");
          refresh(desk.client, desk.address).catch((error: unknown) => notify("halt", "reload failed", describeFailure(error)));
        }}
        onSelect={(id) => {
          setSelected(id);
          setWorkspace("books");
          audio.play("sweep");
        }}
      />

      <nav className="border-b border-edge bg-panel/50 px-4">
        <div className="mx-auto flex max-w-[1680px] gap-1">
          <Tab id="books" icon={LayoutGrid} label="macro orderbook and hedge matrix" active={workspace} onSelect={setWorkspace} />
          <Tab id="model" icon={LineChart} label="strike quantization and payoff modeler" active={workspace} onSelect={setWorkspace} />
          <Tab id="telemetry" icon={ScanLine} label="oracle verification and ecosystem feed" active={workspace} onSelect={setWorkspace} />
          <div className="ml-auto flex items-center gap-2">
            <button
              data-testid="listing-open"
              onClick={() => setListingOpen(true)}
              className="flex items-center gap-1.5 border border-edge bg-rack px-2.5 py-1.5 font-mono text-[10px] text-dim transition hover:border-amber/45 hover:text-ink"
            >
              <ArrowDownLeft size={11} /> list a conditional book
            </button>
            <button
              data-testid="toggle-empty-books"
              onClick={() => setShowEmpty((current) => !current)}
              className="border border-edge px-2 py-[2px] font-mono text-[9px] text-dim transition hover:border-cyan/45 hover:text-ink"
              title="Anyone may list a book, so unfunded listings exist on chain"
            >
              {showEmpty
                ? `showing all ${books.length} listings`
                : `${books.length} funded books · ${hiddenBooks} unfunded hidden`}
            </button>
            <span className="font-mono text-[9px] text-dim">
              {basketCount} baskets locked · deposit floor {pgt(MIN_DEPOSIT_WEI)}
            </span>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-[1680px] space-y-3 px-4 py-3">
        {errors ? (
          <div className="border border-ask/40 bg-ask/10 px-3 py-2 font-mono text-[10px] text-ask">
            the terminal could not read the deployment: {errors}
          </div>
        ) : null}

        {workspace === "books" ? (
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <OrderbookMatrix
              markets={books}
              selected={active?.market_id ?? null}
              positions={positions}
              hedges={hedges}
              busy={busy}
              onSelect={(id) => {
                setSelected(id);
                audio.play("tape");
              }}
              onReleaseHedge={onReleaseHedge}
              onOpenWorkspace={() => setWorkspace("model")}
            />
            <div className="space-y-3">
              <LegTicket
                market={active}
                book={book}
                busy={busy}
                writable={desk.writable && mode !== "watch only"}
                onStake={onStake}
                onResolve={onResolve}
                onChallenge={onChallenge}
                onAudit={onAudit}
                onFinalize={onFinalize}
                onClaim={onClaim}
                onRefund={onRefund}
                onSweepRefund={onSweepRefund}
                onOpenTelemetry={() => {
                  setTelemetryOpen(true);
                  void ensurePolicy();
                  audio.play("print");
                }}
              />
              <SolvencyBoard stats={stats} custody={custody} />
            </div>
          </div>
        ) : null}

        {workspace === "model" ? (
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <PayoffCurveModeler market={active} />
            <BasketComposer
              markets={books}
              book={book}
              busy={busy}
              writable={desk.writable && mode !== "watch only"}
              onOpen={(primary, hedge, sideA, sideB, units, native) =>
                native
                  ? run("native basket", "open_conditional_hedge_payable", [primary, hedge, sideA, sideB],
                      BigInt(units) * BigInt(UNIT))
                  : run("basket reserved", "open_conditional_hedge_basket", [
                      primary,
                      hedge,
                      sideA,
                      sideB,
                      BigInt(units) * BigInt(UNIT),
                    ])
              }
              hedges={hedges}
              onRelease={onReleaseHedge}
            />
          </div>
        ) : null}

        {workspace === "telemetry" ? (
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <SolvencyBoard stats={stats} custody={custody} />
              <OrderbookMatrix
                markets={books}
                selected={active?.market_id ?? null}
                positions={positions}
                hedges={hedges}
                busy={busy}
                onSelect={(id) => setSelected(id)}
                onReleaseHedge={onReleaseHedge}
                onOpenWorkspace={() => {
                  setTelemetryOpen(true);
                  void ensurePolicy();
                }}
              />
            </div>
            <div className="rail px-3 py-3">
              <div className="flex items-center gap-2">
                <BookOpenCheck size={13} className="text-cyan" />
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink">
                  verified settlement receipts on this desk session
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                {transactions.length === 0 ? (
                  <p className="font-mono text-[10px] text-dim">
                    nothing signed yet. Open the desk session panel to attach a signing key, then trigger a leg, an
                    adjudication or a refund and the receipt lands here.
                  </p>
                ) : null}
                {transactions.map((item) => (
                  <div key={item.id} className="border border-edge bg-rack px-2.5 py-2 font-mono text-[10px]">
                    <div className="flex items-center gap-2">
                      <span className="text-ink">{item.label}</span>
                      <span className={item.execution === "SUCCESS" ? "text-bid" : "text-ask"}>
                        {item.execution ?? "pending"}
                      </span>
                      <a
                        href={`${EXPLORER_URL}/transactions/${item.hash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto text-dim hover:text-cyan"
                      >
                        {item.hash.slice(0, 16)}...
                      </a>
                    </div>
                  </div>
                ))}
              </div>
              <button
                data-testid="telemetry-open"
                onClick={() => {
                  setTelemetryOpen(true);
                  void ensurePolicy();
                }}
                className="mt-3 w-full border border-amber/40 bg-amber/10 py-2 font-mono text-[10px] text-amber transition hover:bg-amber/20"
              >
                open the full dual source telemetry for PG:{active?.market_id ?? "-"}
              </button>
            </div>
          </div>
        ) : null}

        <footer className="flex flex-wrap items-center gap-3 border-t border-edge px-1 py-3 font-mono text-[9px] text-dim">
          <span className="text-ink">PROPHETGRID FLAGSHIP v1</span>
          <span>{NETWORK_LABEL} chain 61999</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-ink">
            <Github size={10} /> source
          </a>
          <a href={EXPLORER_URL} target="_blank" rel="noreferrer" className="hover:text-ink">
            contract {CONTRACT_ADDRESS.slice(0, 12)}...
          </a>
          <a href="./demo-video-subtitled.mp4" target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-ink">
            <Video size={10} /> subtitled demo reel
          </a>
          <span className="ml-auto">
            settlement authority: live validator consensus. No admin key, no manual clock.
          </span>
        </footer>
      </main>

      <DeskRegistry
        open={deskOpen}
        onClose={() => setDeskOpen(false)}
        address={desk.address}
        mode={mode}
        slot={deskSlot()}
        book={book}
        busy={busy}
        transactions={transactions}
        onSlot={switchSlot}
        onMetaMask={useMetaMask}
        onWatch={watchAddress}
        onDeposit={onDeposit}
        onSweepRefund={onSweepRefund}
        onTransfer={onTransfer}
      />

      <ListingConsole
        open={listingOpen}
        busy={busy !== null}
        writable={desk.writable && mode !== "watch only"}
        onClose={() => setListingOpen(false)}
        onCreate={onCreate}
      />

      <OracleTelemetry
        open={telemetryOpen}
        market={active}
        policy={policy}
        onClose={() => setTelemetryOpen(false)}
        loadFeed={loadFeed}
      />

      <SignalStrip items={signals} onDismiss={(id) => setSignals((current) => current.filter((item) => item.id !== id))} />

      {busy ? (
        <div className="fixed bottom-3 left-3 z-[68] flex items-center gap-2 border border-amber/40 bg-panel px-3 py-2 font-mono text-[10px] text-amber">
          <Loader size={12} className="animate-spin" /> {busy} · waiting for validator consensus
        </div>
      ) : null}
    </div>
  );
}

function Tab({
  id,
  icon: Icon,
  label,
  active,
  onSelect,
}: {
  id: Workspace;
  icon: typeof LayoutGrid;
  label: string;
  active: Workspace;
  onSelect: (value: Workspace) => void;
}) {
  const on = active === id;
  return (
    <button
      data-testid={`tab-${id}`}
      onClick={() => {
        onSelect(id);
        audio.play("tape");
      }}
      className={`flex items-center gap-1.5 border-b-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] transition ${
        on ? "border-amber text-amber" : "border-transparent text-dim hover:text-ink"
      }`}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

function BasketComposer({
  markets,
  book,
  hedges,
  busy,
  writable,
  onOpen,
  onRelease,
}: {
  markets: SettlementSnapshot[];
  book: DeskBook | null;
  hedges: HedgeRow[];
  busy: string | null;
  writable: boolean;
  onOpen: (
    primary: string,
    hedge: string,
    sideA: "YES" | "NO",
    sideB: "YES" | "NO",
    units: number,
    native: boolean,
  ) => void;
  onRelease: (hedge: HedgeRow) => void;
}) {
  const [primary, setPrimary] = useState(markets[0]?.market_id ?? "1");
  const [hedge, setHedge] = useState(markets[1]?.market_id ?? "2");
  const [sideA, setSideA] = useState<"YES" | "NO">("YES");
  const [units, setUnits] = useState(40);
  const [native, setNative] = useState(false);

  const pair = markets.find((row) => row.market_id === primary);
  const leg = markets.find((row) => row.market_id === hedge);
  const reservation = BigInt(units) * BigInt(UNIT);
  const collateral = Number(((reservation - BigInt(CHALLENGE_BOND_WEI)) * 10000n) / 12500n);
  const weightA = pair
    ? pair.mode === "PAYOUT"
      ? sideA === "YES"
        ? pair.yes_payout_bps
        : pair.no_payout_bps
      : 10000
    : undefined;
  const affordable = (book?.balance_pgt ?? 0) >= Number(reservation);
  const ready = Boolean(pair && leg && pair.market_id !== leg.market_id) && writable && (native || affordable);

  return (
    <div className="space-y-3">
      <section className="rail px-3 py-3" data-testid="basket-composer">
        <div className="flex items-center gap-2">
          <LayoutGrid size={13} className="text-lime" />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink">
            cross-market conditional hedge composer
          </span>
        </div>
        <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-dim">
          A basket pairs opposite legs across two correlated books. The desk locks the reservation, and the release
          pays the better weighted leg: the shortfall is absorbed by the protocol fee reserve, never by another desk.
        </p>

        <div className="mt-2.5 grid gap-2 md:grid-cols-2">
          <Selector label="primary book" value={primary} onChange={setPrimary} markets={markets} />
          <Selector label="hedge book" value={hedge} onChange={setHedge} markets={markets} />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="grid-label">leg direction</span>
          {(["YES", "NO"] as const).map((option) => (
            <button
              key={option}
              onClick={() => {
                setSideA(option);
                audio.play("tape");
              }}
              className={`border px-2 py-[2px] font-mono text-[10px] transition ${
                sideA === option
                  ? option === "YES"
                    ? "border-bid/50 bg-bid/10 text-bid"
                    : "border-cyan/50 bg-cyan/10 text-cyan"
                  : "border-edge text-dim hover:text-ink"
              }`}
            >
              primary {option} vs hedge {option === "YES" ? "NO" : "YES"}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-dim">
            <input
              type="checkbox"
              checked={native}
              onChange={(event) => setNative(event.target.checked)}
              className="accent-[#10B981]"
            />
            fund with native deposit
          </label>
        </div>

        <div className="mt-2.5">
          <div className="flex items-baseline justify-between">
            <span className="grid-label">reservation</span>
            <span className="font-mono text-[11px] text-ink">{units} units</span>
          </div>
          <input
            type="range"
            min={12}
            max={80}
            value={units}
            data-testid="basket-units"
            onChange={(event) => setUnits(Number(event.target.value))}
            className="mt-1 w-full"
          />
          <div className="mt-1.5 grid grid-cols-3 gap-px bg-edge/70">
            <Mini label="reservation" value={pgt(reservation)} />
            <Mini label="collateral" value={pgt(collateral)} />
            <Mini label="bounty headroom" value={pgt(Number(reservation) - collateral)} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-2 font-mono text-[9px] text-dim">
            <span>
              primary weight {pair ? `${pair.yes_payout_bps || 10000} bps` : "unsettled"} ·{" "}
              {weightA === undefined ? "modelled at full principal" : `${weightA} bps`}
            </span>
            <span>hedge weight {leg ? `${leg.no_payout_bps || 10000} bps` : "unsettled"}</span>
            <span className={affordable || native ? "text-bid" : "text-ask"}>
              {native ? "native funded" : affordable ? "collateral available" : "insufficient collateral"}
            </span>
          </div>
          <button
            data-testid="basket-open"
            disabled={!ready || busy !== null}
            onClick={() => onOpen(primary, hedge, sideA, sideA === "YES" ? "NO" : "YES", units, native)}
            className="mt-2 w-full border border-lime/45 bg-lime/10 py-2 font-mono text-[10px] text-lime transition enabled:hover:bg-lime/20 disabled:opacity-40"
          >
            reserve the basket
          </button>
        </div>
      </section>

      <section className="rail px-3 py-3">
        <span className="grid-label">basket register on this desk</span>
        <div className="mt-1.5 space-y-1.5">
          {hedges.length === 0 ? (
            <p className="font-mono text-[10px] text-dim">no baskets reserved</p>
          ) : null}
          {hedges.map((item) => (
            <div key={item.hedge_id} className="border border-edge bg-rack px-2.5 py-2 font-mono text-[10px]">
              <div className="flex items-center gap-2">
                <span className="text-ink">BASKET {item.hedge_id}</span>
                <span className={item.state === "LOCKED" ? "text-amber" : "text-bid"}>{item.state}</span>
                <span className="ml-auto text-dim">
                  {pgt(item.paid)} paid · {pgt(item.reservation)} reserved
                </span>
              </div>
              <div className="mt-1 text-dim">
                PG:{item.primary_market_id} {item.primary_side} x PG:{item.hedge_market_id} {item.hedge_side} ·
                weights {item.primary_weight_bps}+{item.hedge_weight_bps}
              </div>
              {item.state === "LOCKED" ? (
                <button
                  onClick={() => onRelease(item)}
                  disabled={busy !== null}
                  className="mt-1.5 w-full border border-lime/40 bg-lime/10 py-1 font-mono text-[9px] text-lime transition enabled:hover:bg-lime/20 disabled:opacity-40"
                >
                  release at epoch {item.unlock_epoch}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Selector({
  label,
  value,
  markets,
  onChange,
}: {
  label: string;
  value: string;
  markets: SettlementSnapshot[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="grid-label">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full border border-edge bg-rack px-2 py-1.5 font-mono text-[10px] text-ink outline-none focus:border-lime/45"
      >
        {markets.map((row) => (
          <option key={row.market_id} value={row.market_id}>
            PG:{row.market_id} {row.category} · strike {row.strike_bps} · pot {pgt(row.pot)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-carbon px-2 py-1.5">
      <div className="grid-label">{label}</div>
      <div className="font-mono text-[11px] text-ink">{value}</div>
    </div>
  );
}
