/**
 * DOM-free mutation ledger for one AutoTransition microtask batch.
 *
 * Records insert/remove intent without layout writes. Same-batch cancel rules:
 * - insert then remove (never in `before`) → drop (transient)
 * - remove then insert (was in `before`) → cancel exit → persist (move path)
 *
 * Layout-affecting work (exit freeze) must happen later at flush commit, not here.
 */

export type MutationLedger<T, ExitMeta> = {
  pendingEnters: Set<T>;
  pendingExits: Map<T, ExitMeta>;
  /** True when an Element child was inserted/removed/reordered in this batch. */
  hasElementMutation: boolean;
};

export function createMutationLedger<T, ExitMeta>(): MutationLedger<T, ExitMeta> {
  return {
    pendingEnters: new Set<T>(),
    pendingExits: new Map<T, ExitMeta>(),
    hasElementMutation: false,
  };
}

export type NoteRemoveResult<ExitMeta> =
  | { action: "already-exiting" }
  | { action: "drop-transient-enter" }
  | { action: "schedule-exit"; meta: ExitMeta };

export type NoteInsertResult<ExitMeta> =
  | { action: "cancel-exit"; meta: ExitMeta }
  | { action: "enter" }
  | { action: "persist" };

/**
 * Note an element remove. Does not perform DOM or style writes.
 *
 * @param wasPresentBefore - node had a rect in the batch `before` snapshot
 * @param isAlreadyExiting - node is already in the long-lived exiting set (previous batches)
 */
export function noteElementRemove<T, ExitMeta>(
  ledger: MutationLedger<T, ExitMeta>,
  node: T,
  options: {
    wasPresentBefore: boolean;
    isAlreadyExiting: boolean;
    createExitMeta: () => ExitMeta;
  },
): NoteRemoveResult<ExitMeta> {
  if (options.isAlreadyExiting) {
    return { action: "already-exiting" };
  }

  ledger.hasElementMutation = true;

  if (ledger.pendingEnters.delete(node) && !options.wasPresentBefore) {
    return { action: "drop-transient-enter" };
  }

  const meta = options.createExitMeta();
  ledger.pendingExits.set(node, meta);
  return { action: "schedule-exit", meta };
}

/**
 * Note an element insert/append. Does not perform DOM or style writes beyond the
 * caller's actual insert. Cancels a same-batch pending exit when the same node returns.
 */
export function noteElementInsert<T, ExitMeta>(
  ledger: MutationLedger<T, ExitMeta>,
  node: T,
  options: {
    wasPresentBefore: boolean;
  },
): NoteInsertResult<ExitMeta> {
  ledger.hasElementMutation = true;

  const pendingExit = ledger.pendingExits.get(node);
  if (pendingExit !== undefined) {
    ledger.pendingExits.delete(node);
    return { action: "cancel-exit", meta: pendingExit };
  }

  if (!options.wasPresentBefore) {
    ledger.pendingEnters.add(node);
    return { action: "enter" };
  }

  return { action: "persist" };
}

export function isLedgerEmpty<T, ExitMeta>(ledger: MutationLedger<T, ExitMeta>): boolean {
  return !ledger.hasElementMutation && ledger.pendingEnters.size === 0 && ledger.pendingExits.size === 0;
}
