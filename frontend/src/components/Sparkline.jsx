export default function Sparkline({ data = [], width = 120, height = 24, color = "#00e676", strokeWidth = 1.5 }) {
  if (data.length < 2) {
    return (
      <svg width={width} height={height} style={{ display: "block" }}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2}
          stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = pad + ((1 - (v - min) / range) * (height - pad * 2));
    return [x, y];
  });

  const pathD = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  const areaD =
    pathD +
    ` L${points[points.length - 1][0].toFixed(1)},${height}` +
    ` L${points[0][0].toFixed(1)},${height} Z`;

  // Gradient ID keyed by color to avoid namespace collisions
  const gradId = `sc_grad_${color.replace("#", "")}`;

  const [endX, endY] = points[points.length - 1];

  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.00" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinecap="round" strokeLinejoin="round" />
      <circle
        cx={endX} cy={endY} r={2.5} fill={color}
        style={{ filter: `drop-shadow(0 0 3px ${color})` }}
      />
    </svg>
  );
}
