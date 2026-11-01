export function monthBins(createdAt: number[]) {
  const m = new Map<number, number>();
  for (const t of createdAt) { const d = new Date(t * 1000); const k = d.getUTCFullYear() * 12 + d.getUTCMonth(); m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, count]) => {
    const y = Math.floor(k / 12), mo = k % 12;
    return { key: k, label: `${y}-${String(mo + 1).padStart(2, "0")}`, count, start: Date.UTC(y, mo, 1) / 1000, end: Date.UTC(y, mo + 1, 1) / 1000 - 1 };
  });
}
export function gradeBins(grade: number[]) { const b = [0, 0, 0, 0]; for (const g of grade) b[Math.min(3, Math.max(0, Math.round(g)))]++; return b; }
