export function shortenAddress(address: string, head = 6, tail = 4) {
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}

export function formatSignedPercent(value: number) {
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}
