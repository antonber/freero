const stamp = () => `[freero ${new Date().toISOString().slice(11, 19)}]`;

export function log(...args: unknown[]): void {
  console.log(stamp(), ...args);
}

export function logError(...args: unknown[]): void {
  console.error(stamp(), ...args);
}
