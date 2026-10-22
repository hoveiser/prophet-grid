import { useState } from "react";
import { Plus, X } from "lucide-react";

interface CreateMarketModalProps {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (question: string, category: string, primary: string, criteria: string, durationEpochs: number) => void;
}

const CATEGORIES = ["TECH", "AI", "MACRO", "CRYPTO", "SEMICONDUCTORS", "OTHER"];

export function CreateMarketModal({ open, busy, onClose, onCreate }: CreateMarketModalProps) {
  const [question, setQuestion] = useState("Will the next AI benchmark leader report a score above 90 percent on the public eval set?");
  const [category, setCategory] = useState("AI");
  const [primary, setPrimary] = useState("https://raw.githubusercontent.com/openai/openai-python/main/README.md");
  const [criteria, setCriteria] = useState("Resolve YES when the published leaderboard reports a score above 90 percent for the cited eval set, and NO when it does not.");
  const [duration, setDuration] = useState(10);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="create-market-modal">
      <button className="absolute inset-0 bg-obsidian/85 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-[560px] rounded-xl border border-line bg-panel p-5 shadow-panel">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Plus size={15} className="text-yes" />
            <div>
              <div className="text-[12px] font-medium text-ink">Create a conditional market</div>
              <div className="text-[9.5px] text-muted">permissionless, no owner approval required</div>
            </div>
          </div>
          <button onClick={onClose} className="rounded border border-line bg-obsidian/60 p-1.5 text-muted hover:text-ink" aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <label className="mb-1 block text-[9px] uppercase tracking-[0.14em] text-muted">question</label>
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={2}
          className="mb-3 w-full resize-none rounded-md border border-line bg-obsidian/70 px-2.5 py-2 text-[11px] text-ink outline-none focus:border-yes/50"
        />

        <label className="mb-1 block text-[9px] uppercase tracking-[0.14em] text-muted">category</label>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {CATEGORIES.map((option) => (
            <button
              key={option}
              onClick={() => setCategory(option)}
              className={`rounded border px-2 py-1 text-[9.5px] transition ${
                category === option ? "border-yes/40 bg-yes/10 text-yes" : "border-line bg-obsidian/50 text-muted hover:text-ink"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-[9px] uppercase tracking-[0.14em] text-muted">primary source URL</label>
        <input
          value={primary}
          onChange={(event) => setPrimary(event.target.value)}
          className="mb-3 w-full rounded-md border border-line bg-obsidian/70 px-2.5 py-2 font-mono text-[10px] text-ink outline-none focus:border-no/50"
        />

        <label className="mb-1 block text-[9px] uppercase tracking-[0.14em] text-muted">resolution criteria</label>
        <textarea
          value={criteria}
          onChange={(event) => setCriteria(event.target.value)}
          rows={3}
          className="mb-3 w-full resize-none rounded-md border border-line bg-obsidian/70 px-2.5 py-2 text-[10.5px] text-ink outline-none focus:border-amber/50"
        />

        <label className="mb-1 block text-[9px] uppercase tracking-[0.14em] text-muted">trading window duration (epochs, 1 epoch = 60s)</label>
        <input
          type="number"
          min={1}
          max={525600}
          value={duration}
          onChange={(event) => setDuration(Math.min(525600, Math.max(1, Math.floor(Number(event.target.value) || 1))))}
          className="mb-4 w-full rounded-md border border-line bg-obsidian/70 px-2.5 py-2 font-mono text-[10.5px] text-ink outline-none focus:border-no/50"
          aria-label="duration epochs"
        />

        <div className="flex items-center justify-between">
          <span className="text-[9px] text-muted">The contract validates length, category, public URL and duration bounds.</span>
          <button
            onClick={() => onCreate(question, category, primary, criteria, duration)}
            disabled={busy}
            className="rounded-lg border border-yes/40 bg-yes/10 px-4 py-2 text-[11px] font-medium text-yes transition hover:bg-yes/20 disabled:opacity-40"
          >
            {busy ? "deploying..." : "Create market"}
          </button>
        </div>
      </div>
    </div>
  );
}
