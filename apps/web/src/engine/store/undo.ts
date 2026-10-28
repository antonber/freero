// One undo history over several Y.Docs (the shared board doc and the layer docs).
//
// A Y.UndoManager only tracks types of ONE doc, but a single user action can write several docs
// (drag a shared and a private sticky together; a sticky dropped into a hidden frame moves from
// the shared doc to the editors layer). Each doc keeps its own UndoManager; this class records,
// per user action ("step"), which managers got a stack item, and undoes/redoes a step on all of
// them at once. Steps are opened by BoardStore around every local transaction and gesture, so
// everything written inside one becomes one step, exactly as with a single manager.
import type * as Y from 'yjs';

type Step = Set<Y.UndoManager>;

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
    m.on('stack-item-added', (e: { type: 'undo' | 'redo' }) => {
      if (!this.replaying && e.type === 'undo') this.recorded(m);
      this.onChange();
    });
    m.on('stack-item-popped', () => this.onChange());
    m.on('stack-cleared', () => this.onChange());
  }

  /** `m` is gone (its doc was replaced): forget it everywhere. */
  remove(m: Y.UndoManager): void {
    this.managers = this.managers.filter((x) => x !== m);
    for (const s of [...this.undoSteps, ...this.redoSteps]) s.delete(m);
    this.open?.delete(m);
  }

  private recorded(m: Y.UndoManager): void {
    // A new local change voids every redo (Y.UndoManager clears only its own redo stack).
    if (this.redoSteps.length) {
      this.redoSteps = [];
      for (const o of this.managers) if (o !== m && o.redoStack.length) o.clear(false, true);
    }
    if (this.open) {
      this.open.add(m);
      if (this.undoSteps[this.undoSteps.length - 1] !== this.open) this.undoSteps.push(this.open);
      return;
    }
    this.undoSteps.push(new Set([m]));
    // Nobody may merge a later change into an item that is no longer the newest step.
    for (const o of this.managers) if (o !== m) o.stopCapturing();
  }

  /** Everything recorded until the matching endStep() is one step. Nestable. */
  beginStep(): void {
    if (this.depth++ === 0) this.open = new Set();
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
        for (const m of step) {
          m.stopCapturing();
          if (m.undo()) m.redoStack.pop();
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
    this.replay(this.undoSteps, this.redoSteps, (m) => m.undoStack.length > 0, (m) => m.undo());
  }

  redo(): void {
    this.replay(this.redoSteps, this.undoSteps, (m) => m.redoStack.length > 0, (m) => m.redo());
  }

  private replay(from: Step[], to: Step[], has: (m: Y.UndoManager) => boolean, run: (m: Y.UndoManager) => void): void {
    while (from.length) {
      const ms = [...from.pop()!].filter(has);
      if (!ms.length) continue; // that doc's history was cleared meanwhile
      this.replaying = true;
      try {
        for (const m of ms) run(m);
      } finally {
        this.replaying = false;
      }
      to.push(new Set(ms));
      return;
    }
  }

  canUndo(): boolean {
    return this.undoSteps.some((s) => [...s].some((m) => m.undoStack.length > 0));
  }

  canRedo(): boolean {
    return this.redoSteps.some((s) => [...s].some((m) => m.redoStack.length > 0));
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
