import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

export interface Signal {
  id: number;
  tone: "ok" | "halt" | "note";
  title: string;
  detail?: string;
}

interface Props {
  items: Signal[];
  onDismiss: (id: number) => void;
}

export function SignalStrip({ items, onDismiss }: Props) {
  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-[70] flex w-[380px] flex-col gap-1.5">
      {items.map((item) => {
        const skin =
          item.tone === "ok"
            ? { border: "border-bid/45", bg: "bg-bid/10", text: "text-bid", Icon: CheckCircle2 }
            : item.tone === "halt"
              ? { border: "border-ask/45", bg: "bg-ask/10", text: "text-ask", Icon: AlertTriangle }
              : { border: "border-cyan/45", bg: "bg-cyan/10", text: "text-cyan", Icon: Info };
        const Icon = skin.Icon;
        return (
          <div
            key={item.id}
            className={`pointer-events-auto animate-rollup border ${skin.border} ${skin.bg} px-3 py-2 backdrop-blur`}
          >
            <div className="flex items-start gap-2">
              <Icon size={13} className={`mt-0.5 ${skin.text}`} />
              <div className="flex-1">
                <div className="font-mono text-[11px] text-ink">{item.title}</div>
                {item.detail ? (
                  <div className="mt-0.5 break-words font-mono text-[10px] text-dim">{item.detail}</div>
                ) : null}
              </div>
              <button onClick={() => onDismiss(item.id)} className="text-dim transition hover:text-ink">
                <X size={12} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
