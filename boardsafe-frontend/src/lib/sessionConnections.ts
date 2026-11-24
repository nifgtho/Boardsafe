// Explicit synchronous cleanup before logout and before memory credentials expire.
const connections = new Set<() => void>();
export function registerSessionConnection(close: () => void) {
  connections.add(close);
  return () => { connections.delete(close); };
}
export function closeSessionConnections() {
  for (const close of connections) close();
  connections.clear();
}
