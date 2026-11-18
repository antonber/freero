// A socket's update and the server's corrections of it (facilitation, votes, protected locks,
// attribution, guest edits, content placement) are applied in ONE transaction, so nobody else ever
// receives what a guard undoes. yjs marks any transaction that reads an update as remote
// (`readUpdateV2` sets `transaction.local = false`), and a remote transaction that advances the
// doc's OWN client id makes yjs decide another client is using it: it prints "Changed the client-id
// because another client seems to be using it" and picks a new id. Every correction the server
// wrote therefore gave the board's doc a new client id (one more entry in its state vector each
// time, for the board's lifetime). The corrections are this server's own writes: once the update is
// in, the transaction is local again.
import * as Y from 'yjs';

/** Applies `update` to `doc` inside the caller's transaction `tr`, which stays local for the guards that follow. */
export function applyThenGuard(tr: Y.Transaction, doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update);
  tr.local = true;
}
