// One undo history over several Y.Docs (the shared board doc and the layer docs).
//
// A Y.UndoManager only tracks types of ONE doc, but a single user action can write several docs
// (drag a shared and a private sticky together; a sticky dropped into a hidden frame moves from
// the shared doc to the editors layer). Each doc keeps its own UndoManager; this class records,
// per user action ("step"), the exact stack items it pushed on each manager, and undoes/redoes a
// step on all of them at once. Steps are opened by BoardStore around every local transaction and
// gesture, so everything written inside one becomes one step, exactly as with a single manager.
//
// A step pops exactly its own stack items, one at a time. Y.UndoManager.undo() / redo() alone
// keep popping until some item changes something: an item a collaborator has since overwritten
// changes nothing, so the manager would go on into an OLDER step's item on that doc only, taking
// back half of that step and leaving the history paired with the wrong items. Here an item that
// changes nothing is simply consumed; a step whose every item was overwritten is consumed by one
// Undo that changes nothing (it never falls through to the step before it).
import type * as Y from 'yjs';

type StackItem = Y.UndoManager['undoStack'][number];
/** Per manager, the stack items the step pushed there, bottom to top. */
type Step = Map<Y.UndoManager, StackItem[]>;
type Direction = 'undo' | 'redo';

const stackOf = (m: Y.UndoManager, dir: Direction): StackItem[] => (dir === 'undo' ? m.undoStack : m.redoStack);

/** True when `items` are exactly the top of `stack` (they are not once that history was cleared). */
const onTop = (stack: StackItem[], items: StackItem[]): boolean =>
  items.length > 0 && items.length <= stack.length && items.every((it, i) => stack[stack.length - items.length + i] === it);

export class UndoHistory {
  private undoSteps: Step[] = [];
  private redoSteps: Step[] = [];
  /** The step being recorded (inside a transaction or gesture), not yet on undoSteps if empty. */
  private open: Step | null = null;
  private depth = 0;
  private replaying = false;
  private managers: Y.UndoManager[] = [];

  constructor(private onChange: () => void) {}

  add(m: Y.UndoManager): void {
    this.managers.push(m);
    // While replaying, the stacks are mid-update: one change notice follows the whole step.
    const changed = () => {
      if (!this.replaying) this.onChange();
    };
    m.on('stack-item-added', (e: { type: 'undo' | 'redo'; stackItem: StackItem }) => {
      if (!this.replaying && e.type === 'undo') this.recorded(m, e.stackItem);
      changed();
    });
    m.on('stack-item-popped', changed);
    m.on('stack-cleared', changed);
  }

  /** `m` is gone (its doc was replaced): forget it everywhere. */
  remove(m: Y.UndoManager): void {
    this.managers = this.managers.filter((x) => x !== m);
    for (const s of [...this.undoSteps, ...this.redoSteps]) s.delete(m);
    this.open?.delete(m);
  }

  private recorded(m: Y.UndoManager, item: StackItem): void {
    // A new local change voids every redo (Y.UndoManager clears only its own redo stack).
    if (this.redoSteps.length) {
      this.redoSteps = [];
      for (const o of this.managers) if (o !== m && o.redoStack.length) o.clear(false, true);
    }
    if (this.open) {
      const items = this.open.get(m);
      if (items) items.push(item);
      else this.open.set(m, [item]);
      if (this.undoSteps[this.undoSteps.length - 1] !== this.open) this.undoSteps.push(this.open);
      return;
    }
    this.undoSteps.push(new Map([[m, [item]]]));
    // Nobody may merge a later change into an item that is no longer the newest step.
    for (const o of this.managers) if (o !== m) o.stopCapturing();
  }

  /** Everything recorded until the matching endStep() is one step. Nestable. */
  beginStep(): void {
    if (this.depth++ === 0) this.open = new Map();
  }

  endStep(): void {
    if (this.depth === 0) return;
    if (--this.depth === 0) this.open = null;
  }

  /** Reverts the open step's writes and forgets it (no undo or redo entry), then closes it. */
  cancelOpenStep(): void {
    const step = this.open;
    if (step && step.size && this.undoSteps[this.undoSteps.length - 1] === step) {
      this.undoSteps.pop();
      this.replaying = true;
      try {
        for (const [m, items] of step) {
          m.stopCapturing();
          if (!onTop(m.undoStack, items)) continue;
          const reverts = this.popItems(m, items.length, 'undo');
          if (reverts.length) m.redoStack = m.redoStack.filter((r) => !reverts.includes(r));
        }
      } finally {
        this.replaying = false;
      }
      this.onChange();
    }
    this.depth = 0;
    this.open = null;
  }

  undo(): void {
    this.replay(this.undoSteps, this.redoSteps, 'undo');
  }

  redo(): void {
    this.replay(this.redoSteps, this.undoSteps, 'redo');
  }

  /** The step's parts whose items are still on their manager's stack (a cleared history has none). */
  private live(step: Step, dir: Direction): Array<[Y.UndoManager, StackItem[]]> {
    return [...step].filter(([m, items]) => onTop(stackOf(m, dir), items));
  }

  private replay(from: Step[], to: Step[], dir: Direction): void {
    while (from.length) {
      const parts = this.live(from.pop()!, dir);
      if (!parts.length) continue; // that doc's history was cleared meanwhile
      const done: Step = new Map();
      this.replaying = true;
      try {
        for (const [m, items] of parts) {
          const made = this.popItems(m, items.length, dir);
          if (made.length) done.set(m, made);
        }
      } finally {
        this.replaying = false;
      }
      // Everything in it overwritten by collaborators: nothing to take back, and nothing to redo.
      if (done.size) to.push(done);
      this.onChange();
      return;
    }
  }

  /**
   * Undoes (or redoes) exactly the top `n` items of `m`'s stack, one at a time, and returns the
   * items that pushed on the opposite stack (bottom to top). The manager is shown a one-item stack
   * each time, so an item that changes nothing can't make it go on into the items below.
   */
  private popItems(m: Y.UndoManager, n: number, dir: Direction): StackItem[] {
    const made: StackItem[] = [];
    for (let i = 0; i < n; i++) {
      const rest = stackOf(m, dir);
      const one = [rest.pop()!];
      const opposite = stackOf(m, dir === 'undo' ? 'redo' : 'undo');
      const before = opposite.length;
      if (dir === 'undo') m.undoStack = one;
      else m.redoStack = one;
      try {
        if (dir === 'undo') m.undo();
        else m.redo();
      } finally {
        // Unless something cleared the stack meanwhile (then it stays cleared).
        if (dir === 'undo' && m.undoStack === one) m.undoStack = rest;
        if (dir === 'redo' && m.redoStack === one) m.redoStack = rest;
      }
      const now = stackOf(m, dir === 'undo' ? 'redo' : 'undo');
      if (now === opposite && now.length > before) made.push(now[now.length - 1]);
    }
    return made;
  }

  canUndo(): boolean {
    return this.undoSteps.some((s) => this.live(s, 'undo').length > 0);
  }

  canRedo(): boolean {
    return this.redoSteps.some((s) => this.live(s, 'redo').length > 0);
  }

  stopCapturing(): void {
    for (const m of this.managers) m.stopCapturing();
  }

  setCaptureTimeout(ms: number): void {
    for (const m of this.managers) m.captureTimeout = ms;
  }

  clear(): void {
    this.undoSteps = [];
    this.redoSteps = [];
    for (const m of this.managers) m.clear();
  }
}
