export function formatTs(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

export function formatTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatKwh(n?: number | null, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)} kWh`;
}

export function formatNum(n?: number | null, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

export function formatPrice(n?: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  let s = n.toFixed(4);
  while (s.length > 1 && s.endsWith("0") && s.split(".")[1]!.length > 2) {
    s = s.slice(0, -1);
  }
  return s;
}

export function formatScore(n?: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

export function formatWei(wei?: string | null): string {
  if (!wei) return "—";
  try {
    const value = BigInt(wei);
    const whole = value / 10n ** 18n;
    const frac = (value % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
    return `${whole.toString()}.${frac}`;
  } catch {
    return wei;
  }
}

export function shortHex(value?: string | null, left = 6, right = 4): string {
  if (!value) return "—";
  if (value.length <= left + right + 2) return value;
  return `${value.slice(0, left + 2)}…${value.slice(-right)}`;
}

export function toLocalInputValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isoFromLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function defaultRange(): { fromLocal: string; toLocal: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 48 * 3600 * 1000);
  return { fromLocal: toLocalInputValue(from), toLocal: toLocalInputValue(to) };
}
