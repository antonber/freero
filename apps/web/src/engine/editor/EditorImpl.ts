// The Editor: single writer of board state. Feature code receives a scoped instance
// (Object.create(engineEditor) with its own `scope`), so collection writes can be checked.
import { nanoid } from 'nanoid';
import { COMMENTER_WRITABLE, type BoardElement, type BoardSettings, type ElementType, type Role } from '@freero/shared';
import type {
  Camera,
  Collection,
  Editor,
  EditorEvent,
  ElementDefinition,
  ElementPatch,
  ElementsSnapshot,
  FitOptions,
  FollowTarget,
  Host,
  HostUser,
  NewElement,
  Point,
  Rect,
  TextPart,
} from '../api';
import type { EngineCore } from '../runtime/core';
import { ROLE_RANK } from '../runtime/core';
import { boundsOf, elementAABB, localToWorld, rectCenter, rectUnion, visualAABB } from '../geometry/geometry';
import { elementsInRect, hitTestElements, HIT_TOLERANCE_PX } from '../geometry/spatial';
import { findFreeSpot } from '../geometry/freeSpot';
import {
  clampZoom,
  fitRectInArea,
  lerpCamera,
  MAX_ZOOM,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from '../camera/camera';
import { createCollection } from '../store/collections';
import { safeArea } from '../camera/safeArea';
import {
  parseClipboardHtml,
  placeAt,
  remapElements,
  serializeClipboard,
  translateElement,
  type ClipboardPayload,
} from './clipboard';
import { applyFormatToHtml, formatStateOfHtml } from '../text/formatHtml';
import { EMPTY_FORMAT_STATE, type FormatCommand, type TextFormatState } from '../text/session';
import { richTextToPlain } from '../text/sanitize';
import { runFollowers } from './followers';
import { listShortcuts } from '../runtime/shortcutList';
import { createArrangeState, hasArrangers, runArrangers, type ArrangeState } from './arrange';

const EMPTY_OPTIONS = Object.freeze({}) as Record<string, unknown>;
const CAMERA_ANIM_MS = 320;

export class EditorImpl implements Editor {
  /**
   * Mutable state shared by the engine editor and every scoped editor. Scoped editors are
   * Object.create(engineEditor): assigning `this.x = …` on one would shadow it on that instance
   * only, so all mutable state lives in this object and is only ever mutated, never reassigned.
   */
  private readonly shared: {
    collections: Map<string, Collection<unknown>>;
    camAnim: number | null;
    /** Where the running camera animation ends (null when none runs): see cameraTarget(). */
    camTarget: Camera | null;
    /** Where the last paste landed and how many times in a row it landed there (see pastePayload). */
    lastPaste: { at: Point; n: number } | null;
    lastDenied: number;
    editingGesture: boolean;
    movingTimer: ReturnType<typeof setTimeout> | null;
    /** >0 while a user gesture (wheel, pan, zoom control) is writing the camera: see asUser(). */
    userCamera: number;
    /** Local changes waiting for the containers' arrange pass (see editor/arrange.ts). */
    arrange: ArrangeState;
    /** A font re-measure waits for the next local change (redo steps existed): see renormalizeMeasured(). */
    remeasurePending: boolean;
  } = { collections: new Map(), camAnim: null, camTarget: null, lastPaste: null, lastDenied: 0, editingGesture: false, movingTimer: null, userCamera: 0, arrange: createArrangeState(), remeasurePending: false };

  /**
   * A local change wrote/removed `ids` (called inside its store transaction): containers with
   * `arrange` re-lay out now, in that transaction, or when the open gesture / outermost
   * Editor.transact ends (so a drag never re-stacks under the pointer, and a feature's
   * multi-step transaction is never laid out half-done).
   */
  private touched(ids: Iterable<string>, created = false): void {
    const state = this.shared.arrange;
    if (state.running || !hasArrangers(this.core)) return;
    // Remember each element as it was before the first change of this pass (null: new).
    for (const id of ids) if (!state.before.has(id)) state.before.set(id, created ? null : (this.core.store.getElement(id) ?? null));
  }

  /** After a local write: run the pass now unless a gesture or Editor.transact is still open. */
  private settle(): void {
    const state = this.shared.arrange;
    if (state.running || !state.before.size || this.core.store.inGesture() || state.depth) return;
    this.flushArrange();
  }

  private flushArrange(): void {
    runArrangers(this.core, this.shared.arrange, (patches) => this.updateMany(patches));
  }

  /**
   * Flags the camera as moving for a short while: the world layer is promoted (will-change)
   * so pans/zooms are composited instead of repainting every element; once it settles the
   * browser re-rasterizes crisply.
   */
  private markCameraMoving() {
    const ui = this.core.ui;
    if (!ui.getState().cameraMoving) ui.setState({ cameraMoving: true });
    if (this.shared.movingTimer) clearTimeout(this.shared.movingTimer);
    this.shared.movingTimer = setTimeout(() => {
      this.shared.movingTimer = null;
      if (this.shared.camAnim === null) ui.setState({ cameraMoving: false });
    }, 180);
  }

  constructor(
    readonly core: EngineCore,
    readonly scope: string,
  ) {}

  // ------------------------------------------------------------------ identity & roles
  get host(): Host {
    return this.core.hostRef.current;
  }
  get boardId(): string {
    return this.core.hostRef.current.board.id;
  }
  get user(): HostUser {
    return this.core.hostRef.current.user;
  }

  getRole(): Role {
    return this.core.store.serverRole ?? this.core.hostRef.current.board.role;
  }

  can(minRole: Role): boolean {
    return ROLE_RANK[this.getRole()] >= ROLE_RANK[minRole];
  }

  /** True if the user may edit board content; otherwise shows a (rate-limited) toast. */
  guardWrite(): boolean {
    if (this.can('editor')) return true;
    const now = Date.now();
    if (now - this.shared.lastDenied > 2500) {
      this.shared.lastDenied = now;
      const role = this.getRole();
      this.host.notify(
        role === 'commenter' ? 'You can comment on this board, but not edit it.' : 'This board is view-only for you.',
        'info',
      );
    }
    return false;
  }

  // ------------------------------------------------------------------ element reads
  getElement<T extends BoardElement = BoardElement>(id: string): T | undefined {
    return this.core.store.getElement(id) as T | undefined;
  }

  getElements(): BoardElement[] {
    return this.core.store.getOrdered();
  }

  getDefinition(type: ElementType): ElementDefinition<any> | undefined {
    return this.core.registry.elements.get(type)?.def;
  }

  /** Feature name that registered an element type ('engine' if unknown). */
  featureOf(type: ElementType): string {
    return this.core.registry.elements.get(type)?.feature ?? 'engine';
  }

  /** True when the element's definition says it isn't on the board right now (ElementDefinition.hidden). */
  isOffBoard(el: BoardElement): boolean {
    const reg = this.core.registry.elements.get(el.type);
    return !!reg?.def.hidden && !!reg.def.hidden(el, this.core.scoped(reg.feature));
  }

  /**
   * Not shown to this viewer: off the board (isOffBoard), or hidden for this viewer only
   * (setViewHidden) — itself, a container it sits in, or what it is drawn against (hiddenWith).
   */
  isHidden(el: BoardElement): boolean {
    return this.viewFiltered(el, this.core.ui.getState().viewHidden) || this.isOffBoard(el);
  }

  /** In the view filter: itself or a container, or (one level) an element it is drawn against. */
  private viewFiltered(el: BoardElement, vh: ReadonlySet<string>): boolean {
    if (!vh.size) return false;
    if (this.inHiddenChain(el, vh)) return true;
    const deps = this.core.registry.elements.get(el.type)?.def.hiddenWith?.(el);
    if (deps)
      for (const id of deps) {
        const dep = id ? this.core.store.getElement(id) : undefined;
        if (dep && this.inHiddenChain(dep, vh)) return true;
      }
    return false;
  }

  /** The element or a container it sits in is in the view filter. */
  private inHiddenChain(el: BoardElement, vh: ReadonlySet<string>): boolean {
    let cur: BoardElement | undefined = el;
    for (let depth = 0; cur && depth < 16; depth++) {
      if (vh.has(cur.id)) return true;
      cur = cur.frameId ? this.core.store.getElement(cur.frameId) : undefined;
    }
    return false;
  }

  isViewHidden(id: string): boolean {
    const el = this.getElement(id);
    return !!el && this.viewFiltered(el, this.core.ui.getState().viewHidden);
  }

  /** Elements in render order without hidden ones (what hit tests, marquee, bounds, culling see). */
  getVisibleElements(): BoardElement[] {
    const all = this.getElements();
    if (!this.core.ui.getState().viewHidden.size && ![...this.core.registry.elements.values()].some((r) => r.def.hidden)) return all;
    return all.filter((el) => !this.isHidden(el));
  }

  setViewHidden(ids: string[], hidden: boolean): void {
    const cur = this.core.ui.getState().viewHidden;
    const next = new Set(cur);
    for (const id of ids) {
      if (hidden) next.add(id);
      else next.delete(id);
    }
    if (next.size === cur.size && [...next].every((id) => cur.has(id))) return;
    this.core.ui.setState({ viewHidden: next, hoverId: null });
    // What the viewer can no longer see can't stay selected (Delete would act on it unseen).
    const sel = this.getSelection();
    const seen = sel.filter((id) => {
      const el = this.getElement(id);
      return !!el && !this.isHidden(el);
    });
    if (seen.length !== sel.length) this.select(seen);
  }

  getViewHidden(): string[] {
    return [...this.core.ui.getState().viewHidden];
  }

  getBounds(ids?: string[], opts: { visual?: boolean } = {}): Rect | null {
    const els = ids
      ? ids.map((id) => this.getElement(id)).filter((e): e is BoardElement => !!e && !this.isHidden(e))
      : this.getVisibleElements();
    return opts.visual ? this.visualBoundsOf(els) : boundsOf(els);
  }

  /** Union of the elements' boxes including what each draws outside it (visualOutset). */
  visualBoundsOf(els: BoardElement[]): Rect | null {
    const zoom = this.getCamera().zoom;
    return rectUnion(els.map((el) => visualAABB(el, this.getDefinition(el.type)?.visualOutset?.(el, zoom))));
  }


  hitTest(point: Point, opts: { exclude?: string[]; types?: ElementType[] } = {}): BoardElement | null {
    const zoom = this.core.ui.getState().camera.zoom;
    return hitTestElements(this.getVisibleElements(), point, (t) => this.getDefinition(t), {
      ...opts,
      tolerance: HIT_TOLERANCE_PX / zoom,
    });
  }

  elementsInRect(rect: Rect, mode: 'intersect' | 'contain' = 'intersect'): BoardElement[] {
    return elementsInRect(this.getVisibleElements(), rect, mode);
  }

  getAnchorPoint(id: string, anchor: 'top' | 'right' | 'bottom' | 'left'): Point | null {
    const el = this.getElement(id);
    if (!el) return null;
    const def = this.getDefinition(el.type);
    const local = def?.anchorPoint
      ? def.anchorPoint(el, anchor)
      : anchor === 'top'
        ? { x: el.w / 2, y: 0 }
        : anchor === 'bottom'
          ? { x: el.w / 2, y: el.h }
          : anchor === 'left'
            ? { x: 0, y: el.h / 2 }
            : { x: el.w, y: el.h / 2 };
    return localToWorld(el, local);
  }

  // ------------------------------------------------------------------ element writes
  private normalized<T extends BoardElement>(el: T, prev?: T): T {
    const def = this.getDefinition(el.type);
    if (!def?.normalize) return el;
    // Measured with the fonts available now; re-measured once web fonts load (see fonts.ts).
    this.core.measured.add(el.id);
    const patch = def.normalize(el as never, prev as never);
    return patch ? ({ ...el, ...patch } as T) : el;
  }

  /**
   * Web fonts finished loading: re-runs normalize for the elements THIS client measured (and
   * nobody changed since), so text sized with fallback fonts gets its real frame. Never an undo
   * step of its own (it joins the last one, see BoardStore.transactDerived, so undo keeps
   * working for those elements) and only by this client — never for everyone's elements, so
   * clients with different fonts can't fight over frames.
   */
  renormalizeMeasured(): void {
    const { measured, store } = this.core;
    if (!measured.size || !this.can('editor')) return;
    if (store.undoManager.redoStack.length) {
      // Writing now would discard the redo steps: re-measure with the user's next change.
      if (!this.shared.remeasurePending) {
        this.shared.remeasurePending = true;
        const off = store.subscribeLocalChanges(() => {
          off();
          this.shared.remeasurePending = false;
          queueMicrotask(() => this.renormalizeMeasured());
        });
      }
      return;
    }
    const next: BoardElement[] = [];
    for (const id of [...measured]) {
      const el = store.getElement(id);
      const def = el && this.getDefinition(el.type);
      if (!el || !def?.normalize) {
        measured.delete(id);
        continue;
      }
      // prev = el: nothing changed but the measurement.
      const patch = def.normalize(el as never, el as never) as Record<string, unknown> | null;
      const cur = el as unknown as Record<string, unknown>;
      if (patch && Object.keys(patch).some((k) => patch[k] !== cur[k])) next.push({ ...el, ...patch, id: el.id, type: el.type } as BoardElement);
    }
    if (!next.length) return;
    store.transactDerived(() => {
      for (const el of next) store.setElement(el);
      runFollowers(this.core, next.map((el) => el.id), []);
    });
  }

  private build(el: NewElement, z: number, now: number): BoardElement {
    const def = this.getDefinition(el.type);
    const base = (def?.defaults() ?? {}) as Partial<BoardElement>;
    const full = {
      ...base,
      ...el,
      id: el.id ?? nanoid(),
      z: el.z ?? z,
      rotation: el.rotation ?? 0,
      createdBy: el.createdBy ?? this.user.id,
      createdAt: el.createdAt ?? now,
      updatedAt: now,
    } as BoardElement;
    return this.normalized(full);
  }

  create<T extends ElementType>(el: NewElement<T>, opts?: { select?: boolean }): string {
    return this.createMany([el as NewElement], opts)[0] ?? '';
  }

  createMany(els: NewElement[], opts?: { select?: boolean }): string[] {
    if (!els.length || !this.guardWrite()) return [];
    const now = Date.now();
    let z = this.core.store.maxZ();
    let built = els.map((e) => this.build(e, ++z, now));
    // Created by a grid-snapping tool's pointer event: land on the grid like a snapped drag
    // (top-left of everything created at once, moved together).
    const grid = this.core.interaction.createGrid;
    if (grid) {
      const b = rectUnion(built.map(elementAABB))!;
      const dx = Math.round(b.x / grid) * grid - b.x;
      const dy = Math.round(b.y / grid) * grid - b.y;
      if (dx || dy) built = built.map((el) => translateElement(el, dx, dy));
    }
    this.core.store.transact(() => {
      this.touched(built.map((b) => b.id), true);
      for (const el of built) this.core.store.setElement(el);
      this.adoptIntoContainers(built.map((b) => b.id));
      this.settle();
    });
    const ids = built.map((b) => b.id);
    if (opts?.select) this.select(ids);
    return ids;
  }

  update<T extends BoardElement = BoardElement>(id: string, patch: ElementPatch<T>): void {
    this.updateMany([{ id, patch: patch as ElementPatch }]);
  }

  updateMany(patches: Array<{ id: string; patch: ElementPatch }>): void {
    if (!patches.length || !this.guardWrite()) return;
    const store = this.core.store;
    const now = Date.now();
    const next: BoardElement[] = [];
    for (const { id, patch } of patches) {
      const cur = store.getElement(id);
      if (!cur) continue;
      let changed = false;
      for (const k in patch) {
        if ((patch as Record<string, unknown>)[k] !== (cur as unknown as Record<string, unknown>)[k]) {
          changed = true;
          break;
        }
      }
      if (!changed) continue;
      next.push(this.normalized({ ...cur, ...patch, id: cur.id, type: cur.type, updatedAt: now } as BoardElement, cur));
    }
    if (!next.length) return;
    store.transact(() => {
      this.touched(next.map((el) => el.id));
      for (const el of next) store.setElement(el);
      runFollowers(this.core, next.map((el) => el.id), []);
      this.settle();
    });
  }

  /**
   * The container (frame) an element whose center is at `p` belongs to: the innermost visible
   * container holding the point, ignoring `exclude`. The one membership rule for drops, creates,
   * duplicates and pastes.
   */
  containerAt(p: Point, exclude?: ReadonlySet<string>): BoardElement | null {
    let best: BoardElement | null = null;
    for (const el of this.getVisibleElements()) {
      if (exclude?.has(el.id) || !this.getDefinition(el.type)?.container) continue;
      const r = elementAABB(el);
      if (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) continue;
      if (!best || r.w * r.h < best.w * best.h) best = el;
    }
    return best;
  }

  /**
   * New elements land in the container under their center, like an element dropped there: a
   * sticky made inside a frame moves, exports and presents with it. Elements already pointing at
   * an existing container (a template's children, a pasted frame's children) keep it. Runs inside
   * the creating transaction, so it shares its undo step.
   */
  private adoptIntoContainers(ids: string[]): void {
    const store = this.core.store;
    const isContainer = (el: BoardElement | undefined) => !!el && !!this.getDefinition(el.type)?.container;
    if (!this.getElements().some(isContainer)) return;
    for (const id of ids) {
      const el = store.getElement(id);
      if (!el || isContainer(el) || isContainer(el.frameId ? store.getElement(el.frameId) : undefined)) continue;
      const frame = this.containerAt(rectCenter(elementAABB(el)));
      if ((frame?.id ?? null) !== (el.frameId ?? null)) store.setElement({ ...el, frameId: frame?.id ?? null });
    }
  }

  /**
   * Ids plus, recursively, the children of any container among them and the elements attached
   * to any of them (`attachedTo`: reaction stamps) — everything that travels with them.
   */
  withChildren(ids: string[]): string[] {
    const out = new Set(ids);
    const all = this.getElements();
    const isContainer = (el: BoardElement | undefined) => !!el && !!this.getDefinition(el.type)?.container;
    if (!all.some((el) => el.attachedTo) && !ids.some((id) => isContainer(this.getElement(id)))) return [...out];
    const riders = new Map<string, BoardElement[]>();
    const add = (key: string, el: BoardElement) => {
      const list = riders.get(key);
      if (list) list.push(el);
      else riders.set(key, [el]);
    };
    for (const el of all) {
      if (el.attachedTo) add(el.attachedTo, el);
      if (el.frameId && isContainer(this.getElement(el.frameId))) add(el.frameId, el);
    }
    const queue = [...out];
    while (queue.length) {
      for (const el of riders.get(queue.pop()!) ?? []) {
        if (out.has(el.id)) continue;
        out.add(el.id);
        queue.push(el.id);
      }
    }
    return [...out];
  }

  /** withChildren plus, recursively, every definition's removeWith (a mind-map node's subtree). */
  withDependents(ids: string[]): string[] {
    const out = new Set(this.withChildren(ids));
    const queue = [...out];
    while (queue.length) {
      const el = this.getElement(queue.pop()!);
      const reg = el && this.core.registry.elements.get(el.type);
      if (!el || !reg?.def.removeWith) continue;
      for (const id of this.withChildren(reg.def.removeWith(el, this.core.scoped(reg.feature)))) {
        if (out.has(id) || !this.getElement(id)) continue;
        out.add(id);
        queue.push(id);
      }
    }
    return [...out];
  }

  remove(ids: string[]): void {
    if (!ids.length || !this.guardWrite()) return;
    const all = this.withDependents(ids);
    const editing = this.getEditingId();
    if (editing && all.includes(editing)) this.stopEditing();
    this.core.store.transact(() => {
      this.touched(all);
      for (const id of all) this.core.store.deleteElement(id);
      runFollowers(this.core, [], all);
      this.settle();
    });
    const gone = new Set(all);
    if ([...gone].some((id) => this.core.ui.getState().viewHidden.has(id))) {
      this.core.ui.setState({ viewHidden: new Set([...this.core.ui.getState().viewHidden].filter((id) => !gone.has(id))) });
    }
    const sel = this.getSelection();
    if (sel.some((id) => gone.has(id))) this.core.ui.setState({ selection: sel.filter((id) => !gone.has(id)) });
  }

  transact(fn: () => void): void {
    // Containers re-lay out once the whole transaction is written, never from a half-done state.
    // Inside the same Yjs transaction, so the re-layout shares the change's undo step.
    const state = this.shared.arrange;
    state.depth++;
    try {
      this.core.store.transact(() => {
        fn();
        if (state.depth === 1 && !this.core.store.inGesture()) this.flushArrange();
      });
    } finally {
      state.depth--;
    }
  }

  moveBy(moves: Array<{ id: string; dx: number; dy: number }>): void {
    if (!moves.length || !this.guardWrite()) return;
    const delta = new Map<string, Point>();
    for (const m of moves) if ((m.dx || m.dy) && Number.isFinite(m.dx) && Number.isFinite(m.dy)) delta.set(m.id, { x: m.dx, y: m.dy });
    // A container's children travel with it, unless they were given their own move.
    for (const [id, d] of [...delta]) for (const child of this.withChildren([id])) if (!delta.has(child)) delta.set(child, d);
    const patches: Array<{ id: string; patch: ElementPatch }> = [];
    const moved: string[] = [];
    for (const [id, d] of delta) {
      const el = this.getElement(id);
      if (!el || el.locked) continue;
      const t = translateElement(el, d.x, d.y);
      const patch: Record<string, unknown> = { x: t.x, y: t.y };
      if (t.type === 'connector') {
        patch.start = t.start;
        patch.end = t.end;
        if (t.waypoints) patch.waypoints = t.waypoints;
      }
      patches.push({ id, patch: patch as ElementPatch });
      moved.push(id);
    }
    if (!patches.length) return;
    this.transact(() => {
      this.updateMany(patches);
      // Same membership rule as a drop: an element now centered in another container joins it.
      const movedSet = new Set(moved);
      const membership: Array<{ id: string; patch: ElementPatch }> = [];
      for (const id of moved) {
        const el = this.getElement(id);
        if (!el || this.getDefinition(el.type)?.container || (el.frameId && movedSet.has(el.frameId))) continue;
        const fid = this.containerAt(rectCenter(elementAABB(el)), movedSet)?.id ?? null;
        if ((el.frameId ?? null) !== fid) membership.push({ id, patch: { frameId: fid } });
      }
      this.updateMany(membership);
    });
  }

  /** Every local write until endGesture() becomes one undo step. Used by tools and the text editor. */
  beginGesture(): void {
    this.core.store.beginGesture();
  }

  endGesture(): void {
    // Containers re-lay out before the step closes: the drop and the re-stack are one undo.
    if (this.core.store.isOutermostGesture()) this.flushArrange();
    this.core.store.endGesture();
  }

  cancelGesture(): void {
    if (this.core.store.isOutermostGesture()) this.shared.arrange.before.clear();
    this.core.store.cancelGesture();
  }

  bringToFront(ids: string[]): void {
    if (!ids.length || !this.guardWrite()) return;
    const els = this.withChildren(ids)
      .map((id) => this.getElement(id)!)
      .filter(Boolean)
      .sort((a, b) => a.z - b.z);
    let z = this.core.store.maxZ();
    this.updateMany(els.map((el) => ({ id: el.id, patch: { z: ++z } })));
  }

  sendToBack(ids: string[]): void {
    if (!ids.length || !this.guardWrite()) return;
    const els = ids
      .map((id) => this.getElement(id)!)
      .filter(Boolean)
      .sort((a, b) => b.z - a.z);
    let z = this.core.store.minZ();
    this.updateMany(els.map((el) => ({ id: el.id, patch: { z: --z } })));
  }

  duplicate(ids: string[], offset?: Point): string[] {
    if (!ids.length || !this.guardWrite()) return [];
    const all = this.withChildren(ids);
    const source = all.map((id) => this.getElement(id)!).filter(Boolean).sort((a, b) => a.z - b.z);
    if (!source.length) return [];
    const zoom = this.getCamera().zoom;
    const d = offset ?? { x: Math.max(24, 20 / zoom), y: Math.max(24, 20 / zoom) };
    const { elements, idMap } = remapElements(source, () => nanoid());
    const moved = elements.map((el) => translateElement(el, d.x, d.y));
    let z = this.core.store.maxZ();
    const now = Date.now();
    const built = moved.map((el) => ({ ...el, z: ++z, createdBy: this.user.id, createdAt: now, updatedAt: now }));
    const content = this.copyContentOf(source);
    this.core.store.transact(() => {
      this.touched(built.map((b) => b.id), true);
      for (const el of built) this.core.store.setElement(el);
      this.adoptIntoContainers(built.map((b) => b.id));
      this.pasteContentInto(built, idMap, content);
      this.settle();
    });
    const top = ids.map((id) => idMap.get(id)!).filter(Boolean);
    this.select(top);
    return top;
  }

  group(ids: string[]): void {
    if (ids.length < 2 || !this.guardWrite()) return;
    const gid = nanoid();
    this.updateMany(ids.map((id) => ({ id, patch: { groupId: gid } })));
  }

  ungroup(ids: string[]): void {
    if (!ids.length || !this.guardWrite()) return;
    const groups = new Set(ids.map((id) => this.getElement(id)?.groupId).filter(Boolean));
    const members = this.getElements().filter((el) => el.groupId && groups.has(el.groupId));
    this.updateMany(members.map((el) => ({ id: el.id, patch: { groupId: null } })));
  }

  undo(): void {
    // Undo writes elements/settings: never for viewers/commenters (the server would drop the
    // update and reject everything that depends on it afterwards).
    if (!this.guardWrite()) return;
    if (this.getEditingId()) this.stopEditing();
    this.core.store.undo();
  }

  redo(): void {
    if (!this.guardWrite()) return;
    if (this.getEditingId()) this.stopEditing();
    this.core.store.redo();
  }

  canUndo(): boolean {
    return this.can('editor') && this.core.store.canUndo();
  }

  canRedo(): boolean {
    return this.can('editor') && this.core.store.canRedo();
  }

  // ------------------------------------------------------------------ clipboard
  /** Builds the clipboard payload for ids (with frame children), or null when empty. */
  buildClipboard(ids: string[]): { html: string; text: string; payload: ClipboardPayload } | null {
    const snapshot = this.exportElements(ids);
    if (!snapshot) return null;
    const { elements } = snapshot;
    const text = elements
      .map((el) => {
        const def = this.getDefinition(el.type);
        if (def?.toPlainText) return def.toPlainText(el);
        const field = def?.textField;
        return field ? richTextToPlain(String((el as unknown as Record<string, unknown>)[field] ?? '')) : '';
      })
      .filter(Boolean)
      .join('\n');
    const payload: ClipboardPayload = { app: 'freero', version: 1, boardId: this.boardId, ...snapshot };
    const s = serializeClipboard(payload, text);
    return { ...s, payload };
  }

  exportElements(ids?: string[]): ElementsSnapshot | null {
    const all = this.withChildren(ids ?? this.getElements().map((el) => el.id));
    const elements = all.map((id) => this.getElement(id)!).filter(Boolean).sort((a, b) => a.z - b.z);
    if (!elements.length) return null;
    const content = this.copyContentOf(elements);
    return { elements, ...(content ? { content } : {}) };
  }

  insertElements(snapshot: ElementsSnapshot, opts: { at?: Point } = {}): string[] {
    return this.insertSnapshot(snapshot, (elements) => {
      if (opts.at) return placeAt(elements, opts.at);
      const b = boundsOf(elements);
      if (!b) return elements;
      const spot = this.findFreeSpot({ w: b.w, h: b.h });
      const dx = Math.round(spot.x - b.x);
      const dy = Math.round(spot.y - b.y);
      return elements.map((el) => translateElement(el, dx, dy));
    });
  }

  /**
   * The one insertion path for copied content (paste, drop, templates): fresh ids with internal
   * references remapped, placed by `place`, created in one transaction with their copied content,
   * adopted into containers; selects and returns the top-level ids.
   */
  private insertSnapshot(snapshot: ElementsSnapshot, place: (elements: BoardElement[]) => BoardElement[]): string[] {
    if (!this.guardWrite()) return [];
    const known = snapshot.elements.filter((el) => this.core.registry.elements.has(el.type));
    if (!known.length) return [];
    const { elements, idMap } = remapElements(known, () => nanoid());
    const placed = place(elements);
    let z = this.core.store.maxZ();
    const now = Date.now();
    const built = placed.map((el) => ({ ...el, z: ++z, createdBy: this.user.id, createdAt: now, updatedAt: now }));
    this.core.store.transact(() => {
      this.touched(built.map((b) => b.id), true);
      for (const el of built) this.core.store.setElement(el);
      this.adoptIntoContainers(built.map((b) => b.id));
      this.pasteContentInto(built, idMap, snapshot.content);
      this.settle();
    });
    // Select top-level inserted elements (not children of inserted frames).
    const insertedIds = new Set(built.map((b) => b.id));
    const top = built.filter((el) => !el.frameId || !insertedIds.has(el.frameId)).map((el) => el.id);
    this.select(top);
    return top;
  }

  /** [additive] ElementDefinition.copyContent of each source element that has one, by source id. */
  private copyContentOf(source: BoardElement[]): Record<string, unknown> | undefined {
    let out: Record<string, unknown> | undefined;
    for (const el of source) {
      const reg = this.core.registry.elements.get(el.type);
      if (!reg?.def.copyContent) continue;
      const c = reg.def.copyContent(el as never, this.core.scoped(reg.feature));
      if (c !== undefined) (out ??= {})[el.id] = c;
    }
    return out;
  }

  /** Hands copied content to pasteContent of each new copy (call inside the creating transaction). */
  private pasteContentInto(built: BoardElement[], idMap: Map<string, string>, content: Record<string, unknown> | undefined): void {
    if (!content) return;
    const byNew = new Map([...idMap].map(([from, to]) => [to, from]));
    for (const el of built) {
      const from = byNew.get(el.id);
      const reg = this.core.registry.elements.get(el.type);
      if (!from || !(from in content) || !reg?.def.pasteContent) continue;
      try {
        reg.def.pasteContent(el as never, content[from], this.core.scoped(reg.feature));
      } catch (err) {
        console.error(`pasteContent of '${el.type}' failed`, err);
      }
    }
  }

  copy(ids?: string[]): void {
    const target = ids ?? this.getSelection();
    const data = this.buildClipboard(target);
    if (!data) return;
    this.core.clipboard.memory = { payload: data.payload, text: data.text };
    // Prefer a synchronous copy event (works from menus during a user gesture).
    this.core.clipboard.copyIds = target;
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    this.core.clipboard.copyIds = null;
    if (!ok && navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      navigator.clipboard
        .write([
          new ClipboardItem({
            'text/html': new Blob([data.html], { type: 'text/html' }),
            'text/plain': new Blob([data.text || ' '], { type: 'text/plain' }),
          }),
        ])
        .catch(() => undefined);
    }
  }

  cut(ids?: string[]): void {
    if (!this.guardWrite()) return;
    const target = ids ?? this.getSelection();
    this.copy(target);
    this.remove(target);
  }

  paste(at?: Point): void {
    if (!this.guardWrite()) return;
    const point = at ?? this.pastePoint();
    const fallback = () => {
      const mem = this.core.clipboard.memory;
      if (mem) this.pastePayload(mem.payload, point);
    };
    if (!navigator.clipboard?.read) return fallback();
    navigator.clipboard
      .read()
      .then(async (items) => {
        const files: File[] = [];
        let text: string | null = null;
        let html: string | null = null;
        for (const item of items) {
          for (const type of item.types) {
            const blob = await item.getType(type);
            if (type === 'text/plain') text = await blob.text();
            else if (type === 'text/html') html = await blob.text();
            else files.push(new File([blob], `pasted.${type.split('/')[1] ?? 'bin'}`, { type }));
          }
        }
        await this.importData({ files, text, html }, point);
      })
      .catch(fallback);
  }

  /** Where paste/drops land: the pointer if it's over the canvas, else the viewport center. */
  pastePoint(): Point {
    const p = this.core.pointer.getState();
    return p.inside && p.world ? p.world : this.getViewportCenter();
  }

  pastePayload(payload: ClipboardPayload, at: Point): string[] {
    return this.insertSnapshot(payload, (elements) => {
      // Pasting again without moving the pointer cascades each copy down-right instead of stacking
      // it exactly on the previous one (where it would look like nothing happened).
      const prev = this.shared.lastPaste;
      const n = prev && Math.abs(prev.at.x - at.x) < 0.5 && Math.abs(prev.at.y - at.y) < 0.5 ? prev.n + 1 : 0;
      this.shared.lastPaste = { at, n };
      const step = (24 * n) / this.getCamera().zoom;
      return placeAt(elements, { x: at.x + step, y: at.y + step });
    });
  }

  /**
   * Engine-native payload first, then feature importers by priority (images claim files,
   * text claims plain text…). Used by paste and drag-and-drop.
   */
  async importData(data: { files: File[]; text: string | null; html: string | null }, at: Point): Promise<boolean> {
    if (!this.guardWrite()) return false;
    const payload = parseClipboardHtml(data.html);
    if (payload) {
      this.pastePayload(payload, at);
      return true;
    }
    const mem = this.core.clipboard.memory;
    if (mem && !data.files.length && data.text !== null && data.text === mem.text && !data.html) {
      this.pastePayload(mem.payload, at);
      return true;
    }
    for (const { def, feature } of this.core.registry.importers) {
      try {
        if (await def.importData!(this.core.scoped(feature), data, at)) return true;
      } catch (err) {
        console.error(`importData of '${def.type}' failed`, err);
      }
    }
    if (data.files.length || data.text || data.html) this.host.notify("Freero can't paste that here yet.", 'info');
    return false;
  }

  // ------------------------------------------------------------------ selection & editing
  getSelection(): string[] {
    return this.core.ui.getState().selection;
  }

  select(ids: string[], mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
    const store = this.core.store;
    const valid = ids.filter((id) => {
      const el = store.getElement(id);
      return !!el && !this.isHidden(el);
    });
    const cur = this.getSelection();
    let next: string[];
    if (mode === 'replace') next = [...new Set(valid)];
    else if (mode === 'add') next = [...new Set([...cur, ...valid])];
    else {
      const set = new Set(cur);
      const allIn = valid.every((id) => set.has(id));
      for (const id of valid) {
        if (allIn) set.delete(id);
        else set.add(id);
      }
      next = [...set];
    }
    if (next.length === cur.length && next.every((id, i) => id === cur[i])) return;
    const editing = this.getEditingId();
    if (editing && !next.includes(editing)) this.stopEditing();
    this.core.ui.setState({ selection: next });
  }

  clearSelection(): void {
    this.select([]);
  }

  getEditingId(): string | null {
    return this.core.ui.getState().editingId;
  }

  getEditingPart(): string | null {
    return this.getEditingId() ? this.core.ui.getState().editingPart : null;
  }

  getTextParts(id: string): TextPart[] {
    const el = this.getElement(id);
    const reg = el && this.core.registry.elements.get(el.type);
    if (!el || !reg) return [];
    const out: TextPart[] = [];
    const field = reg.def.textField;
    if (field) out.push({ part: null, html: String((el as unknown as Record<string, unknown>)[field] ?? '') });
    if (reg.def.textParts) out.push(...reg.def.textParts(el as never, this.core.scoped(reg.feature)));
    return out;
  }

  setTextParts(id: string, parts: TextPart[]): void {
    const first = this.getElement(id);
    const reg = first && this.core.registry.elements.get(first.type);
    if (!parts.length || !reg || !this.guardWrite()) return;
    const owner = this.core.scoped(reg.feature);
    this.transact(() => {
      for (const { part, html } of parts) {
        // Live element each time: an earlier write in this transaction may have changed it.
        const el = this.getElement(id);
        if (!el) return;
        if (part === null) {
          if (reg.def.textField) this.update(id, { [reg.def.textField]: html } as ElementPatch);
        } else reg.def.writeTextPart?.(el as never, part, html, owner);
      }
    });
  }

  startEditing(id: string, opts: { selectAll?: boolean; initialText?: string; part?: string } = {}): void {
    const el = this.getElement(id);
    if (!el) return;
    const def = this.getDefinition(el.type);
    const part = opts.part ?? null;
    if (!def || (!def.textField && !part)) return;
    if (!this.guardWrite()) return;
    if (el.locked) {
      this.host.notify('Unlock this item to edit it.', 'info');
      return;
    }
    const cur = this.getEditingId();
    // Another element, or another part of this one: that edit session ends (its own undo step).
    if (cur && (cur !== id || this.getEditingPart() !== part)) this.stopEditing();
    if (!this.shared.editingGesture) {
      this.shared.editingGesture = true;
      this.core.store.beginGesture();
    }
    const prev = this.core.ui.getState().editRequest;
    this.core.ui.setState({
      selection: [id],
      editingId: id,
      editingPart: part,
      editRequest: { id, selectAll: opts.selectAll, initialText: opts.initialText, part: part ?? undefined, nonce: (prev?.nonce ?? 0) + 1 },
      hoverId: null,
    });
  }

  stopEditing(): void {
    const id = this.getEditingId();
    if (!id) return;
    this.core.text?.flush();
    const part = this.core.ui.getState().editingPart;
    this.core.ui.setState({ editingId: null, editRequest: null, editingPart: null });
    const el = this.getElement(id);
    const def = el && this.getDefinition(el.type);
    if (el && !part && def?.removeWhenEmpty && def.textField) {
      const text = richTextToPlain(String((el as unknown as Record<string, unknown>)[def.textField] ?? '')).trim();
      if (!text) this.remove([id]);
    }
    if (this.shared.editingGesture) {
      this.shared.editingGesture = false;
      this.endGesture();
    }
    // Return focus to the canvas so shortcuts keep working.
    this.core.dom.viewport?.focus({ preventScroll: true });
  }

  formatText(cmd: FormatCommand, value?: string): void {
    if (!this.guardWrite()) return;
    const session = this.core.text;
    if (session && this.getEditingId() === session.id) {
      session.exec(cmd, value);
      this.core.ui.setState((s) => ({ textStateVersion: s.textStateVersion + 1 }));
      return;
    }
    const patches: Array<{ id: string; patch: ElementPatch }> = [];
    for (const id of this.getSelection()) {
      const el = this.getElement(id);
      const field = el && this.getDefinition(el.type)?.textField;
      if (!el || !field) continue;
      const html = String((el as unknown as Record<string, unknown>)[field] ?? '');
      if (!html && cmd !== 'bullets' && cmd !== 'numbers') continue;
      patches.push({ id, patch: { [field]: applyFormatToHtml(html, cmd, value) } as ElementPatch });
    }
    // Toggle consistently across a multi-selection: decide from the first element's state.
    this.updateMany(patches);
  }

  getTextFormatState(): TextFormatState {
    const session = this.core.text;
    if (session && this.getEditingId() === session.id) return session.state();
    for (const id of this.getSelection()) {
      const el = this.getElement(id);
      const field = el && this.getDefinition(el.type)?.textField;
      if (el && field) return formatStateOfHtml(String((el as unknown as Record<string, unknown>)[field] ?? ''));
    }
    return EMPTY_FORMAT_STATE;
  }

  // ------------------------------------------------------------------ camera
  getCamera(): Camera {
    return this.core.ui.getState().camera;
  }

  /** Immediate camera write (no animation, cancels a running animation). */
  setCameraNow(camera: Camera): void {
    if (this.writeCamera(camera)) this.cameraChanged();
  }

  /** The follow loop's camera writes: everything else that moves the camera ends following. */
  applyFollowCamera(camera: Camera): void {
    this.writeCamera(camera);
  }

  /**
   * Runs `fn` as a USER camera change (wheel, pan, pinch, zoom controls and shortcuts, minimap):
   * camera writes inside it emit 'camera-user'.
   */
  asUser<T>(fn: () => T): T {
    this.shared.userCamera++;
    try {
      return fn();
    } finally {
      this.shared.userCamera--;
    }
  }

  private writeCamera(camera: Camera): boolean {
    if (this.shared.camAnim !== null) {
      cancelAnimationFrame(this.shared.camAnim);
      this.shared.camAnim = null;
      this.shared.camTarget = null;
    }
    const zoom = clampZoom(camera.zoom);
    if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y) || !Number.isFinite(zoom)) return false;
    this.markCameraMoving();
    this.core.ui.setState({ camera: { x: camera.x, y: camera.y, zoom } });
    return true;
  }

  /** After every camera write except the follow loop's: reports user moves, ends following. */
  private cameraChanged(): void {
    if (this.shared.userCamera > 0) this.core.emitter.emit('camera-user');
    if (this.core.ui.getState().following) this.follow(null);
  }

  setCamera(camera: Camera, opts?: { animate?: boolean }): void {
    const target = { ...camera, zoom: clampZoom(camera.zoom) };
    if (!opts?.animate || typeof requestAnimationFrame === 'undefined') return this.setCameraNow(target);
    if (this.shared.camAnim !== null) cancelAnimationFrame(this.shared.camAnim);
    const from = this.getCamera();
    const viewport = this.getViewportSize();
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / CAMERA_ANIM_MS);
      this.markCameraMoving();
      this.core.ui.setState({ camera: lerpCamera(from, target, t, viewport) });
      if (t < 1) this.shared.camAnim = requestAnimationFrame(step);
      else {
        this.shared.camAnim = null;
        this.shared.camTarget = null;
        this.core.ui.setState({ camera: target });
      }
    };
    this.shared.camTarget = target;
    this.shared.camAnim = requestAnimationFrame(step);
    this.cameraChanged();
  }

  getViewportSize(): { width: number; height: number } {
    return this.core.ui.getState().viewport;
  }

  screenToWorld(p: Point): Point {
    return screenToWorld(this.getCamera(), p);
  }

  worldToScreen(p: Point): Point {
    return worldToScreen(this.getCamera(), p);
  }

  /**
   * The camera the view is heading to: the running animation's end, else the current camera.
   * Zoom steps start from it, so pressing Ctrl+− three times quickly zooms out three steps
   * instead of re-aiming at the first step from a mid-animation zoom.
   */
  cameraTarget(): Camera {
    return this.shared.camTarget ?? this.getCamera();
  }

  zoomTo(zoom: number, screenCenter?: Point): void {
    const vp = this.getViewportSize();
    const c = screenCenter ?? { x: vp.width / 2, y: vp.height / 2 };
    this.setCamera(zoomAt(this.cameraTarget(), zoom, c), { animate: true });
  }

  zoomToFit(ids?: string[], opts: FitOptions = {}): void {
    const b = this.getBounds(ids && ids.length ? ids : undefined, { visual: true });
    const area = this.fitArea(opts.area);
    if (!b) {
      // Empty board: the origin in the middle of the free area, at 100%.
      const c = rectCenter(area);
      this.setCamera({ x: -c.x, y: -c.y, zoom: 1 }, { animate: opts.animate ?? true });
      return;
    }
    this.setCamera(fitRectInArea(b, area, opts.padding ?? 80, opts.maxZoom ?? 1), { animate: opts.animate ?? true });
  }

  zoomToRect(rect: Rect, opts: FitOptions = {}): void {
    this.setCamera(fitRectInArea(rect, this.fitArea(opts.area), opts.padding ?? 40, opts.maxZoom ?? MAX_ZOOM), {
      animate: opts.animate ?? true,
    });
  }

  private fitArea(area: FitOptions['area']): Rect {
    const vp = this.getViewportSize();
    return area === 'viewport' ? { x: 0, y: 0, w: vp.width, h: vp.height } : this.getSafeArea();
  }

  getSafeArea(): Rect {
    return safeArea(this.core);
  }

  follow(target: FollowTarget | null): void {
    const ui = this.core.ui;
    const cur = ui.getState().following;
    if (!target && !cur) return;
    if (target && cur && cur.userId === target.userId && cur.clientId === target.clientId) return;
    if (target && this.shared.camAnim !== null) {
      // A camera animation in flight would fight the mirror.
      cancelAnimationFrame(this.shared.camAnim);
      this.shared.camAnim = null;
      this.shared.camTarget = null;
    }
    ui.setState({ following: target ? { userId: target.userId, clientId: target.clientId } : null });
    this.core.store.setPresence({ following: target ? target.userId : null });
  }

  getFollowing(): FollowTarget | null {
    return this.core.ui.getState().following;
  }

  getViewportCenter(): Point {
    const vp = this.getViewportSize();
    return this.screenToWorld({ x: vp.width / 2, y: vp.height / 2 });
  }

  findFreeSpot(size: { w: number; h: number }, opts: { near?: Point; gap?: number } = {}): Point {
    const obstacles = this.getElements().map(elementAABB);
    // "In view" = the part of the screen the chrome leaves free, not under the toolbar or dock.
    const safe = this.getSafeArea();
    const a = this.screenToWorld({ x: safe.x, y: safe.y });
    const b = this.screenToWorld({ x: safe.x + safe.w, y: safe.y + safe.h });
    const visible = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    return findFreeSpot(obstacles, size, opts.near ?? this.getViewportCenter(), opts.gap ?? 48, visible);
  }

  // ------------------------------------------------------------------ tools
  getToolId(): string {
    return this.core.ui.getState().toolId;
  }

  setTool(id: string): void {
    const reg = this.core.registry.toolsById.get(id);
    if (!reg) {
      console.warn(`Unknown tool '${id}'`);
      return;
    }
    if (!this.can(reg.def.minRole ?? 'editor')) {
      this.guardWrite();
      return;
    }
    if (reg.def.onSelect) {
      // Act-now tool: do it, keep the current tool.
      if (this.getEditingId()) this.stopEditing();
      reg.def.onSelect(this.core.scoped(reg.feature));
      return;
    }
    const prevId = this.getToolId();
    if (prevId === id) return;
    const prev = this.core.registry.toolsById.get(prevId);
    if (this.getEditingId()) this.stopEditing();
    if (prev) {
      const ed = this.core.scoped(prev.feature);
      prev.def.onCancel?.(ed);
      prev.def.onDeactivate?.(ed);
    }
    this.core.ui.setState({ toolId: id, hoverId: null, guides: [], gaps: [], marquee: null });

    reg.def.onActivate?.(this.core.scoped(reg.feature));
  }

  getToolOptions<T = Record<string, unknown>>(toolId: string): T {
    return (this.core.ui.getState().toolOptions[toolId] ?? EMPTY_OPTIONS) as T;
  }

  setToolOptions(toolId: string, patch: Record<string, unknown>): void {
    this.core.ui.setState((s) => ({
      toolOptions: { ...s.toolOptions, [toolId]: { ...(s.toolOptions[toolId] ?? {}), ...patch } },
    }));
  }

  // ------------------------------------------------------------------ commands
  runCommand(id: string, args?: Record<string, unknown>): void {
    const reg = this.core.registry.commands.get(id);
    if (!reg) {
      console.warn(`Unknown command '${id}'`);
      return;
    }
    const ed = this.core.scoped(reg.feature);
    if (!this.can(reg.def.minRole ?? 'editor')) {
      this.guardWrite();
      return;
    }
    if (reg.def.when && !reg.def.when(ed)) return;
    reg.def.run(ed, args);
  }

  getShortcuts() {
    return listShortcuts(this.core.registry, (r) => this.can(r));
  }

  // ------------------------------------------------------------------ settings
  getSettings(): BoardSettings {
    return this.core.store.getSettings();
  }

  updateSettings(patch: Partial<BoardSettings>): void {
    if (!this.guardWrite()) return;
    this.core.store.updateSettings(patch);
  }

  // ------------------------------------------------------------------ collections
  collection<T>(name: string): Collection<T> {
    const key = `${this.scope}\u0000${name}`;
    let c = this.shared.collections.get(key);
    if (!c) {
      c = createCollection<unknown>(this.core.store, name, this.scope, {
        ownerOf: (n) => this.core.registry.collectionOwners.get(n),
        canWrite: (n) => {
          if (this.can('editor')) return true;
          if (this.getRole() === 'commenter' && (COMMENTER_WRITABLE as readonly string[]).includes(n)) return true;
          return this.guardWrite();
        },
      });
      this.shared.collections.set(key, c);
    }
    return c as Collection<T>;
  }

  // ------------------------------------------------------------------ presence
  getPeers() {
    return this.core.store.getPeers();
  }

  setPresenceExt(value: unknown): void {
    const cur = this.core.store.getLocalPresence();
    this.core.store.setPresence({ ext: { ...(cur.ext ?? {}), [this.scope]: value } });
  }

  // ------------------------------------------------------------------ export
  renderToDataUrl(opts: {
    ids?: string[];
    rect?: Rect;
    format: 'png' | 'svg' | 'jpeg';
    scale?: number;
    background?: string | null;
    padding?: number;
    skipFonts?: boolean;
    onMissingImages?: (count: number) => void;
  }): Promise<string> {
    if (!this.core.renderExport) return Promise.reject(new Error('Board renderer is not mounted.'));
    return this.core.renderExport(opts);
  }

  // ------------------------------------------------------------------ UI state
  openDock(panelId: string | null): void {
    this.core.ui.setState({ dock: panelId });
  }

  getDock(): string | null {
    return this.core.ui.getState().dock;
  }

  openPanel(id: string, props?: Record<string, unknown>): void {
    const reg = this.core.registry.panelsById.get(id);
    if (!reg) {
      console.warn(`Unknown panel '${id}'`);
      return;
    }
    if (!this.can(reg.def.minRole ?? 'viewer')) return;
    if (reg.def.slot === 'dock-right') this.openDock(id);
    else if (reg.def.slot === 'dialog') this.core.ui.setState({ dialog: { id, props } });
    else console.warn(`Panel '${id}' lives in the '${reg.def.slot}' slot, which is always mounted; only dialog and dock panels open.`);
  }

  closePanel(id?: string): void {
    const s = this.core.ui.getState();
    if (s.dialog && (!id || s.dialog.id === id)) this.core.ui.setState({ dialog: null });
    if (id && s.dock === id) this.openDock(null);
  }

  setChromeHidden(hidden: boolean): void {
    if (this.core.ui.getState().chromeHidden === hidden) return;
    this.core.ui.setState(hidden ? { chromeHidden: true, contextMenu: null, hoverId: null } : { chromeHidden: false });
  }

  isChromeHidden(): boolean {
    return this.core.ui.getState().chromeHidden;
  }

  on(event: EditorEvent, cb: () => void): () => void {
    return this.core.emitter.on(event, cb);
  }

  // ------------------------------------------------------------------ internal helpers
  /** Expands ids to whole groups (selecting one member selects the group). */
  expandGroups(ids: string[]): string[] {
    const groups = new Set(ids.map((id) => this.getElement(id)?.groupId).filter(Boolean));
    if (!groups.size) return ids;
    const out = new Set(ids);
    for (const el of this.getElements()) if (el.groupId && groups.has(el.groupId)) out.add(el.id);
    return [...out];
  }

  /** Center of an element's AABB. */
  centerOf(id: string): Point | null {
    const el = this.getElement(id);
    return el ? rectCenter(elementAABB(el)) : null;
  }
}
