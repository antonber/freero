// How realtime/repo.ts stores board content of a workspace with an encryption key (#159; modules/keys).
// Every blob written for a board is sealed when the board's workspace has a key (`sealerFor`:
// throws, so nothing is written, when that key can't be used — never written in the clear), and
// every sealed blob read is opened with the data key its row names (`openStored`). The additional
// data binds a blob to its workspace, board, table and layer: a blob copied into another board,
// another table or another person's private layer never opens.
import { boardWorkspaceId } from '../boards/index';
import { KeyUnavailableError, keysInUse, openSealed, sealerFor as keySealerFor } from '../keys/index';
import { uploadNamesIn } from '../uploads/index';

export type BlobTable = 'doc' | 'update' | 'snapshot' | 'layer' | 'layer_update';

const aadOf = (workspaceId: string, boardId: string, table: BlobTable, layer: string) => `freero.board-blob.v1\0${workspaceId}\0${boardId}\0${table}\0${layer}`;

export interface StoredBlob {
  data: Buffer;
  /** '<workspaceId>:<dataKeyVersion>', or null when stored as is. */
  sealedWith: string | null;
}

export interface BoardSealer {
  /** The data key new rows of the board are sealed with (null: stored as is). */
  ref: string | null;
  seal(table: BlobTable, plain: Uint8Array, layer?: string): StoredBlob;
  /** Upload names in what was sealed so far (to keep in board_sealed_refs). */
  refs: Set<string>;
}

const toBuffer = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength);

/**
 * Every sealed blob starts with these bytes: as a Yjs update they are a varint too large to read,
 * so code that doesn't know about sealing (an instance from an older release during a rolling
 * deploy) fails on a sealed row at once — it never applies ciphertext as content and compacts it
 * away.
 */
export const SEALED_PREFIX = Buffer.alloc(9, 0xff);

/**
 * How to store new content of the board: sealed for its workspace (or for `workspaceId`, the
 * workspace it is about to move to), or as is when that workspace has no key. Throws
 * KeyUnavailableError when the workspace has a key that can't be used.
 */
export async function sealerFor(boardId: string, workspaceId?: string | null): Promise<BoardSealer> {
  // No workspace ever had a key (WORKSPACE_KEYS off, the default): stored as is, no lookups.
  const ws = (await keysInUse()) ? (workspaceId ?? (await boardWorkspaceId(boardId))) : null;
  const sealer = ws ? await keySealerFor(ws) : null;
  const refs = new Set<string>();
  if (!sealer || !ws) return { ref: null, refs, seal: (_t, plain) => ({ data: toBuffer(plain), sealedWith: null }) };
  return {
    ref: sealer.ref,
    refs,
    seal(table, plain, layer = '') {
      // latin1 maps every byte to one char, so the ASCII URL inside the binary update reads as is.
      for (const n of uploadNamesIn(toBuffer(plain).toString('latin1'))) refs.add(n);
      return { data: Buffer.concat([SEALED_PREFIX, sealer.seal(aadOf(ws, boardId, table, layer), plain)]), sealedWith: sealer.ref };
    },
  };
}

/** The content of a stored row. Throws KeyUnavailableError when it is sealed and can't be opened. */
export async function openStored(boardId: string, table: BlobTable, data: Uint8Array, sealedWith: string | null, layer = ''): Promise<Uint8Array> {
  if (sealedWith === null) return new Uint8Array(data);
  const workspaceId = sealedWith.slice(0, sealedWith.lastIndexOf(':'));
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (!b.subarray(0, SEALED_PREFIX.length).equals(SEALED_PREFIX)) throw new KeyUnavailableError(workspaceId, 'a stored blob is not sealed as its row says');
  return new Uint8Array(await openSealed(sealedWith, aadOf(workspaceId, boardId, table, layer), b.subarray(SEALED_PREFIX.length)));
}

export { KeyUnavailableError };
