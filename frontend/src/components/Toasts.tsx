import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

export interface ToastItem {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  detail?: string;
}

interface ToastsProps {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}

export function Toasts({ items, onDismiss }: ToastsProps) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[360px] flex-col gap-2">
      {items.map((item) => {
        const tone =
          item.tone === "success"
            ? { border: "border-yes/40", bg: "bg-yes/10", text: "text-yes", Icon: CheckCircle2 }
            : item.tone === "error"
              ? { border: "border-danger/40", bg: "bg-danger/10", text: "text-danger", Icon: AlertTriangle }
              : { border: "border-no/40", bg: "bg-no/10", text: "text-no", Icon: Info };
        const Icon = tone.Icon;
        return (
          <div
            key={item.id}
            className={`pointer-events-auto animate-rise rounded-lg border ${tone.border} ${tone.bg} bg-panel/95 p-3 shadow-panel backdrop-blur`}
            data-testid="toast"
          >
            <div className="flex items-start gap-2">
              <Icon size={14} className={`mt-0.5 ${tone.text}`} />
              <div className="min-w-0 flex-1">
                <div className={`text-[11px] font-medium ${tone.text}`}>{item.title}</div>
                {item.detail ? <div className="mt-0.5 break-words text-[10px] leading-relaxed text-muted">{item.detail}</div> : null}
              </div>
              <button onClick={() => onDismiss(item.id)} className="rounded p-0.5 text-muted hover:text-ink" aria-label="Dismiss">
                <X size={12} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
