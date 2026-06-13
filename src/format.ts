export function formatNumber(n: number, maxDecimals = 2): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: maxDecimals });
}
