import { useState, type ReactNode } from "react";
import { FilePlus2, Loader } from "lucide-react";
import { GRID_STEP_BPS } from "../config";
import { bps } from "../lib/format";
import { corridorFor, snapGrid } from "../lib/payoff";

interface Props {
  open: boolean;
  busy: boolean;
  writable: boolean;
  onClose: () => void;
  onCreate: (draft: Draft) => void;
}

export interface Draft {
  question: string;
  category: string;
  primary: string;
  secondary: string;
  criteria: string;
  strike: number;
  corridor: number;
  closeWindow: number;
  challengeWindow: number;
  timeoutMargin: number;
}

const TEMPLATE: Draft = {
  question:
    "Does the euro area HICP core print stay at or below half of the 5 percent convergence corridor for the reporting month?",
  category: "MACRO",
  primary: "https://epp.eurostat.ec.europa.eu/cache/ITY_OFFPUB/euro-indic/EN/euro-indic-2026-06.pdf",
  secondary: "https://ec.europa.eu/economy_finance/indicators/index_en.htm",
  criteria:
    "Report the observed core print as an integer from 0 to 10000, where 10000 is the full 5 percent corridor and 0 is zero inflation. Use only figures printed in the documents. Resolve YES when the print is at or below the strike minus the corridor, NO when it is above the strike plus the corridor, and refund when the two documents contradict each other.",
  strike: 5000,
  corridor: 1000,
  closeWindow: 900,
  challengeWindow: 180,
  timeoutMargin: 3600,
};

export function ListingConsole({ open, busy, writable, onClose, onCreate }: Props) {
  const [draft, setDraft] = useState<Draft>(TEMPLATE);

  if (!open) return null;
  const snapped = snapGrid(draft.strike);
  const corridor = Math.max(GRID_STEP_BPS, snapGrid(draft.corridor));
  const { lower, upper } = corridorFor(snapped < 0 ? 0 : snapped, corridor);
  const valid =
    draft.question.length >= 12 &&
    draft.criteria.length >= 24 &&
    draft.primary.startsWith("https://") &&
    draft.secondary.startsWith("https://") &&
    draft.primary !== draft.secondary &&
    snapped >= 0 &&
    corridor >= GRID_STEP_BPS;

  return (
    <div className="fixed inset-0 z-[62] flex items-center justify-center bg-carbon/80 p-4 backdrop-blur" onClick={onClose}>
      <div
        data-testid="listing-console"
        className="max-h-[92vh] w-full max-w-[720px] overflow-y-auto border border-edge bg-panel shadow-lit"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2.5">
          <FilePlus2 size={13} className="text-amber" />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink">
            conditional book intake
          </span>
          <span className="ml-auto font-mono text-[9px] text-dim">any desk may list; no listing authority exists</span>
        </div>

        <div className="space-y-2.5 px-3 py-3">
          <Field label="instrument question" hint="states the event and the reporting period">
            <textarea
              data-testid="listing-question"
              rows={2}
              value={draft.question}
              onChange={(event) => setDraft({ ...draft, question: event.target.value })}
              className="w-full resize-none border border-edge bg-rack px-2 py-1.5 font-mono text-[10px] text-ink outline-none focus:border-amber/45"
            />
          </Field>

          <div className="grid gap-2.5 md:grid-cols-2">
            <Field label="category" hint="drives the desk colour coding">
              <input
                data-testid="listing-category"
                value={draft.category}
                onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                className="w-full border border-edge bg-rack px-2 py-1.5 font-mono text-[10px] text-ink outline-none focus:border-amber/45"
              />
            </Field>
            <Field label="settlement rules" hint="how both sources are read into one print">
              <textarea
                data-testid="listing-criteria"
                rows={4}
                value={draft.criteria}
                onChange={(event) => setDraft({ ...draft, criteria: event.target.value })}
                className="w-full resize-none border border-edge bg-rack px-2 py-1.5 font-mono text-[10px] text-ink outline-none focus:border-amber/45"
              />
            </Field>
          </div>

          <div className="grid gap-2.5 md:grid-cols-2">
            <Field label="primary official source" hint="https only, public host">
              <input
                data-testid="listing-primary"
                value={draft.primary}
                onChange={(event) => setDraft({ ...draft, primary: event.target.value })}
                className="w-full border border-edge bg-rack px-2 py-1.5 font-mono text-[10px] text-ink outline-none focus:border-amber/45"
              />
            </Field>
            <Field label="secondary corroboration source" hint="must differ from the primary">
              <input
                data-testid="listing-secondary"
                value={draft.secondary}
                onChange={(event) => setDraft({ ...draft, secondary: event.target.value })}
                className="w-full border border-edge bg-rack px-2 py-1.5 font-mono text-[10px] text-ink outline-none focus:border-amber/45"
              />
            </Field>
          </div>

          <div className="grid gap-2.5 md:grid-cols-3">
            <Field label="quantized strike baseline" hint={`${snapped} bps snapped`}>
              <input
                type="number"
                step={GRID_STEP_BPS}
                min={0}
                max={10000}
                data-testid="listing-strike"
                value={draft.strike}
                onChange={(event) => setDraft({ ...draft, strike: Number(event.target.value) })}
                className="w-full border border-edge bg-rack px-2 py-1.5 font-mono text-[10px] text-ink outline-none focus:border-amber/45"
              />
            </Field>
            <Field label="scalar corridor" hint={`${corridor} bps, band ${bps(lower)} to ${bps(upper)}`}>
              <input
                type="number"
                step={GRID_STEP_BPS}
                min={GRID_STEP_BPS}
                max={5000}
                data-testid="listing-corridor"
                value={draft.corridor}
                onChange={(event) => setDraft({ ...draft, corridor: Number(event.target.value) })}
                className="w-full border border-edge bg-rack px-2 py-1.5 font-mono text-[10px] text-ink outline-none focus:border-amber/45"
              />
            </Field>
            <Field label="intake window" hint={`${draft.closeWindow}s floor 60s`}>
              <input
                type="number"
                step={60}
                min={60}
                data-testid="listing-close"
                value={draft.closeWindow}
                onChange={(event) => setDraft({ ...draft, closeWindow: Number(event.target.value) })}
                className="w-full border border-edge bg-rack px-2 py-1.5 font-mono text-[10px] text-ink outline-none focus:border-amber/45"
              />
            </Field>
          </div>

          <div className="grid gap-2.5 md:grid-cols-2">
            <Field label="challenge window" hint={`${draft.challengeWindow}s before claims open`}>
              <input
                type="number"
                step={60}
                min={60}
                data-testid="listing-challenge"
                value={draft.challengeWindow}
                onChange={(event) => setDraft({ ...draft, challengeWindow: Number(event.target.value) })}
                className="w-full border border-edge bg-rack px-2 py-1.5 font-mono text-[10px] text-ink outline-none focus:border-amber/45"
              />
            </Field>
            <Field label="resolution timeout margin" hint="principal refund opens after this">
              <input
                type="number"
                step={60}
                min={60}
                data-testid="listing-margin"
                value={draft.timeoutMargin}
                onChange={(event) => setDraft({ ...draft, timeoutMargin: Number(event.target.value) })}
                className="w-full border border-edge bg-rack px-2 py-1.5 font-mono text-[10px] text-ink outline-none focus:border-amber/45"
              />
            </Field>
          </div>

          <div className="flex items-center gap-2">
            <span className={`font-mono text-[10px] ${valid ? "text-bid" : "text-ask"}`}>
              {valid ? "intake passes the contract validation rules" : "intake is incomplete or off grid"}
            </span>
            <button
              onClick={onClose}
              className="ml-auto border border-edge px-3 py-1.5 font-mono text-[10px] text-dim transition hover:text-ink"
            >
              discard
            </button>
            <button
              data-testid="listing-submit"
              disabled={!valid || busy || !writable}
              onClick={() => onCreate({ ...draft, strike: snapped, corridor })}
              className="flex items-center gap-1.5 border border-amber/45 bg-amber/10 px-3 py-1.5 font-mono text-[10px] text-amber transition enabled:hover:bg-amber/20 disabled:opacity-40"
            >
              {busy ? <Loader size={11} className="animate-spin" /> : <FilePlus2 size={11} />}
              list the book
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="grid-label">{label}</span>
      {children}
      <span className="mt-0.5 block font-mono text-[9px] text-dim">{hint}</span>
    </label>
  );
}
