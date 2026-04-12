export const INSTANCE_COLORS = {
  slate: { label: "Cinza", class: "bg-slate-500/15 text-slate-700 border-slate-200 hover:bg-slate-500/25", dot: "bg-slate-500", text: "text-slate-700" },
  red: { label: "Vermelho", class: "bg-red-500/15 text-red-700 border-red-200 hover:bg-red-500/25", dot: "bg-red-500", text: "text-red-700" },
  orange: { label: "Laranja", class: "bg-orange-500/15 text-orange-700 border-orange-200 hover:bg-orange-500/25", dot: "bg-orange-500", text: "text-orange-700" },
  amber: { label: "Amarelo", class: "bg-amber-500/15 text-amber-700 border-amber-200 hover:bg-amber-500/25", dot: "bg-amber-500", text: "text-amber-700" },
  green: { label: "Verde", class: "bg-green-500/15 text-green-700 border-green-200 hover:bg-green-500/25", dot: "bg-green-500", text: "text-green-700" },
  emerald: { label: "Esmeralda", class: "bg-emerald-500/15 text-emerald-700 border-emerald-200 hover:bg-emerald-500/25", dot: "bg-emerald-500", text: "text-emerald-700" },
  teal: { label: "Verde-Azul", class: "bg-teal-500/15 text-teal-700 border-teal-200 hover:bg-teal-500/25", dot: "bg-teal-500", text: "text-teal-700" },
  cyan: { label: "Ciano", class: "bg-cyan-500/15 text-cyan-700 border-cyan-200 hover:bg-cyan-500/25", dot: "bg-cyan-500", text: "text-cyan-700" },
  sky: { label: "Céu", class: "bg-sky-500/15 text-sky-700 border-sky-200 hover:bg-sky-500/25", dot: "bg-sky-500", text: "text-sky-700" },
  blue: { label: "Azul", class: "bg-blue-500/15 text-blue-700 border-blue-200 hover:bg-blue-500/25", dot: "bg-blue-500", text: "text-blue-700" },
  indigo: { label: "Índigo", class: "bg-indigo-500/15 text-indigo-700 border-indigo-200 hover:bg-indigo-500/25", dot: "bg-indigo-500", text: "text-indigo-700" },
  violet: { label: "Violeta", class: "bg-violet-500/15 text-violet-700 border-violet-200 hover:bg-violet-500/25", dot: "bg-violet-500", text: "text-violet-700" },
  purple: { label: "Roxo", class: "bg-purple-500/15 text-purple-700 border-purple-200 hover:bg-purple-500/25", dot: "bg-purple-500", text: "text-purple-700" },
  fuchsia: { label: "Fúcsia", class: "bg-fuchsia-500/15 text-fuchsia-700 border-fuchsia-200 hover:bg-fuchsia-500/25", dot: "bg-fuchsia-500", text: "text-fuchsia-700" },
  pink: { label: "Rosa", class: "bg-pink-500/15 text-pink-700 border-pink-200 hover:bg-pink-500/25", dot: "bg-pink-500", text: "text-pink-700" },
  rose: { label: "Rosé", class: "bg-rose-500/15 text-rose-700 border-rose-200 hover:bg-rose-500/25", dot: "bg-rose-500", text: "text-rose-700" },
} as const;

export type InstanceColorKey = keyof typeof INSTANCE_COLORS;

export function getInstanceBadgeStyle(colorKey: string | null) {
  const key = (colorKey as InstanceColorKey) || 'slate';
  return INSTANCE_COLORS[key]?.class || INSTANCE_COLORS.slate.class;
}

// ✅ NOVO: Retorna apenas a classe de cor do texto para instâncias
export function getInstanceTextColor(colorKey: string | null) {
  const key = (colorKey as InstanceColorKey) || 'slate';
  return INSTANCE_COLORS[key]?.text || INSTANCE_COLORS.slate.text;
}

// Estilos de urgência das tags
export const URGENCY_STYLES = {
  1: { 
    label: "Positivo",
    dot: "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]", // Verde neon
    text: "text-green-700"
  },
  2: { 
    label: "OK",
    dot: "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]", // Azul neon
    text: "text-blue-700"
  },
  3: { 
    label: "Ruim",
    dot: "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]", // Vermelho neon
    text: "text-red-700"
  },
  4: { 
    label: "Urgente",
    dot: "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)]", // Laranja neon
    text: "text-orange-700"
  }
} as const;

export type UrgencyLevel = 1 | 2 | 3 | 4;

export function getUrgencyStyle(urgencia: number | null) {
  if (!urgencia || urgencia < 1 || urgencia > 4) {
    return null;
  }
  return URGENCY_STYLES[urgencia as UrgencyLevel];
}