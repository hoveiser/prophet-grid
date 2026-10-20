interface GaugeProps {
  valueBps: number;
  size?: number;
  label?: string;
  tone?: "yes" | "no" | "amber";
}

const TONE_STROKE: Record<string, string> = {
  yes: "#34D399",
  no: "#22D3EE",
  amber: "#FBBF24",
};

export function Gauge({ valueBps, size = 240, label = "implied YES", tone = "yes" }: GaugeProps) {
  const clamped = Math.max(0, Math.min(10000, valueBps));
  const percent = clamped / 100;
  const radius = 78;
  const cx = 110;
  const cy = 104;
  const angle = Math.PI * (1 - percent / 100);
  const needleX = cx + radius * Math.cos(angle);
  const needleY = cy - radius * Math.sin(angle);
  const stroke = TONE_STROKE[tone];

  return (
    <svg width={size} height={size * 0.62} viewBox="0 0 220 136" role="img" aria-label={`${label} ${percent.toFixed(1)} percent`}>
      <defs>
        <linearGradient id="gauge-arc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#22D3EE" />
          <stop offset="50%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#34D399" />
        </linearGradient>
        <filter id="gauge-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke="#16213A"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke="url(#gauge-arc)"
        strokeWidth="10"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${percent} 100`}
        filter="url(#gauge-glow)"
      />

      {[0, 25, 50, 75, 100].map((tick) => {
        const tickAngle = Math.PI * (1 - tick / 100);
        const inner = radius - 16;
        const x1 = cx + inner * Math.cos(tickAngle);
        const y1 = cy - inner * Math.sin(tickAngle);
        const x2 = cx + (radius - 6) * Math.cos(tickAngle);
        const y2 = cy - (radius - 6) * Math.sin(tickAngle);
        return (
          <g key={tick}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#31456B" strokeWidth={tick === 50 ? 2 : 1} />
            <text
              x={cx + (radius + 13) * Math.cos(tickAngle)}
              y={cy - (radius + 13) * Math.sin(tickAngle) + 3}
              fill="#5F7699"
              fontSize="8"
              textAnchor="middle"
              fontFamily="ui-monospace, monospace"
            >
              {tick}
            </text>
          </g>
        );
      })}

      <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke={stroke} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="4.5" fill={stroke} />
      <circle cx={cx} cy={cy} r="9" fill="none" stroke={stroke} strokeOpacity="0.35" strokeWidth="1" />

      <text x={cx} y={cy - 22} fill="#E6EDF7" fontSize="20" textAnchor="middle" fontFamily="ui-monospace, monospace">
        {percent.toFixed(1)}%
      </text>
      <text x={cx} y={cy - 8} fill="#5F7699" fontSize="7.5" textAnchor="middle" letterSpacing="1.6">
        {label.toUpperCase()}
      </text>
    </svg>
  );
}
