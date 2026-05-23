const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const BASE = 1024;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(BASE)), UNITS.length - 1);
  const value = bytes / Math.pow(BASE, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${UNITS[i]}`;
}
