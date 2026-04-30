// AquaGuard shared design tokens
// Import these instead of repeating hex values across components.

export const COLOR = {
  bg:           "#020c17",
  bgCard:       "#060f1e",
  bgPanel:      "#030e1c",
  bgBar:        "#040f20",
  bgDark:       "#030c18",
  bgDeep:       "#020a14",
  accent:       "#00aacc",
  accentDim:    "rgba(0,170,210,0.12)",
  normal:       "#00e676",
  warning:      "#ffab40",
  distress:     "#ff3b55",
  waterline:    "#00d4ff",
  gemini:       "#a78bfa",
  textHigh:     "#c8e4f8",
  textMid:      "#3a6880",
  textLow:      "#1e4060",
  textDim:      "#0e2a3d",
  borderBase:   "rgba(0,170,210,0.12)",
  borderFaint:  "rgba(0,170,210,0.07)",
};

export const STATUS_TOKENS = {
  normal:   { color: COLOR.normal,   glow: "rgba(0,230,118,0.25)",  label: "NORMAL",   bg: "rgba(0,230,118,0.07)"  },
  warning:  { color: COLOR.warning,  glow: "rgba(255,171,64,0.25)", label: "WARNING",  bg: "rgba(255,171,64,0.07)" },
  distress: { color: COLOR.distress, glow: "rgba(255,59,85,0.3)",   label: "DISTRESS", bg: "rgba(255,59,85,0.07)"  },
};

export const RISK_TOKENS = {
  low:    { color: COLOR.normal,   label: "LOW",    bg: "rgba(0,230,118,0.07)",  border: "rgba(0,230,118,0.22)"  },
  medium: { color: COLOR.warning,  label: "MEDIUM", bg: "rgba(255,171,64,0.07)", border: "rgba(255,171,64,0.22)" },
  high:   { color: COLOR.distress, label: "HIGH",   bg: "rgba(255,59,85,0.07)",  border: "rgba(255,59,85,0.25)"  },
};

export const FONT = {
  mono: "'JetBrains Mono', 'Consolas', monospace",
  ui:   "'Inter', system-ui, sans-serif",
};

export const ANIM = {
  pulse:  "1.8s",
  fast:   "0.9s",
  medium: "1.4s",
  sweep:  "5s",
};
