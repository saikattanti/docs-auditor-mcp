let findingCounter = 0;

export function nextFindingId(prefix: string): string {
  findingCounter += 1;
  return `${prefix}-${findingCounter}`;
}

export function resetFindingIds(): void {
  findingCounter = 0;
}
