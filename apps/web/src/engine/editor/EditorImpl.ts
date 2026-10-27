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
  Host,
  HostUser,
  NewElement,
  Point,
  Rect,
} from '../api';
import type { EngineCore } from '../runtime/core';
import { ROLE_RANK } from '../runtime/core';
import { boundsOf, elementAABB, localToWorld, rectCenter } from '../geometry/geometry';
import { elementsInRect, hitTestElements } from '../geometry/spatial';
import {
  clampZoom,
  fitRect,
  lerpCamera,
  MAX_ZOOM,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from '../camera/camera';
import { createCollection } from '../store/collections';
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
    lastDenied: number;
    editingGesture: boolean;
    movingTimer: ReturnType<typeof setTimeout> | null;
  } = { collections: new Map(), camAnim: null, lastDenied: 0, editingGesture: false, movingTimer: null };

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

  getBounds(ids?: string[]): Rect | null {
    const els = ids ? ids.map((id) => this.getElement(id)).filter((e): e is BoardElement => !!e) : this.getElements();
    return boundsOf(els);
  }

  hitTest(point: Point, opts: { exclude?: string[]; types?: ElementType[] } = {}): BoardElement | null {
    const zoom = this.core.ui.getState().camera.zoom;
    return hitTestElements(this.getElements(), point, (t) => this.getDefinition(t), {
      ...opts,
      tolerance: 3 / zoom,
    });
  }

  elementsInRect(rect: Rect, mode: 'intersect' | 'contain' = 'intersect'): BoardElement[] {
    return elementsInRect(this.getElements(), rect, mode);
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
  private normalized<T extends BoardElement>(el: T): T {
    const def = this.getDefinition(el.type);
    const patch = def?.normalize?.(el as never);
    return patch ? ({ ...el, ...patch } as T) : el;
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
    const built = els.map((e) => this.build(e, ++z, now));
    this.core.store.transact(() => {
      for (const el of built) this.core.store.setElement(el);
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
      next.push(this.normalized({ ...cur, ...patch, id: cur.id, type: cur.type, updatedAt: now } as BoardElement));
    }
    if (!next.length) return;
    store.transact(() => {
      for (const el of next) store.setElement(el);
      runFollowers(this.core, next.map((el) => el.id), []);
    });
  }

  /** Ids plus the (recursive) children of any container among them. */
  withChildren(ids: string[]): string[] {
    const out = new Set(ids);
    const containers = ids.filter((id) => {
      const el = this.getElement(id);
      return el && this.getDefinition(el.type)?.container;
    });
    if (!containers.length) return [...out];
    const queue = [...containers];
    const all = this.getElements();
    while (queue.length) {
      const fid = queue.pop()!;
      for (const el of all) {
        if (el.frameId === fid && !out.has(el.id)) {
          out.add(el.id);
          if (this.getDefinition(el.type)?.container) queue.push(el.id);
        }
      }
    }
    return [...out];
  }

  remove(ids: string[]): void {
    if (!ids.length || !this.guardWrite()) return;
    const all = this.withChildren(ids);
    const editing = this.getEditingId();
    if (editing && all.includes(editing)) this.stopEditing();
    this.core.store.transact(() => {
      for (const id of all) this.core.store.deleteElement(id);
      runFollowers(this.core, [], all);
    });
    const gone = new Set(all);
    const sel = this.getSelection();
    if (sel.some((id) => gone.has(id))) this.core.ui.setState({ selection: sel.filter((id) => !gone.has(id)) });
  }

  transact(fn: () => void): void {
    this.core.store.transact(fn);
  }

  /** Every local write until endGesture() becomes one undo step. Used by tools and the text editor. */
  beginGesture(): void {
    this.core.store.beginGesture();
  }

  endGesture(): void {
    this.core.store.endGesture();
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
    this.core.store.transact(() => {
      for (const el of built) this.core.store.setElement(el);
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
    const all = this.withChildren(ids);
    const elements = all.map((id) => this.getElement(id)!).filter(Boolean).sort((a, b) => a.z - b.z);
    if (!elements.length) return null;
    const text = elements
      .map((el) => {
        const def = this.getDefinition(el.type);
        if (def?.toPlainText) return def.toPlainText(el);
        const field = def?.textField;
        return field ? richTextToPlain(String((el as unknown as Record<string, unknown>)[field] ?? '')) : '';
      })
      .filter(Boolean)
      .join('\n');
    const payload: ClipboardPayload = { app: 'freero', version: 1, boardId: this.boardId, elements };
    const s = serializeClipboard(payload, text);
    return { ...s, payload };
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
    if (!this.guardWrite()) return [];
    const known = payload.elements.filter((el) => this.core.registry.elements.has(el.type));
    if (!known.length) return [];
    const { elements } = remapElements(known, () => nanoid());
    const placed = placeAt(elements, at);
    let z = this.core.store.maxZ();
    const now = Date.now();
    const built = placed.map((el) => ({ ...el, z: ++z, createdBy: this.user.id, createdAt: now, updatedAt: now }));
    this.core.store.transact(() => {
      for (const el of built) this.core.store.setElement(el);
    });
    // Select top-level pasted elements (not children of pasted frames).
    const pastedIds = new Set(built.map((b) => b.id));
    const top = built.filter((el) => !el.frameId || !pastedIds.has(el.frameId)).map((el) => el.id);
    this.select(top);
    return top;
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
    const valid = ids.filter((id) => store.getElement(id));
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

  startEditing(id: string, opts: { selectAll?: boolean; initialText?: string } = {}): void {
    const el = this.getElement(id);
    if (!el) return;
    const def = this.getDefinition(el.type);
    if (!def?.textField) return;
    if (!this.guardWrite()) return;
    if (el.locked) {
      this.host.notify('Unlock this item to edit it.', 'info');
      return;
    }
    const cur = this.getEditingId();
    if (cur && cur !== id) this.stopEditing();
    if (!this.shared.editingGesture) {
      this.shared.editingGesture = true;
      this.core.store.beginGesture();
    }
    const prev = this.core.ui.getState().editRequest;
    this.core.ui.setState({
      selection: [id],
      editingId: id,
      editRequest: { id, selectAll: opts.selectAll, initialText: opts.initialText, nonce: (prev?.nonce ?? 0) + 1 },
      hoverId: null,
    });
  }

  stopEditing(): void {
    const id = this.getEditingId();
    if (!id) return;
    this.core.text?.flush();
    this.core.ui.setState({ editingId: null, editRequest: null });
    const el = this.getElement(id);
    const def = el && this.getDefinition(el.type);
    if (el && def?.removeWhenEmpty && def.textField) {
      const text = richTextToPlain(String((el as unknown as Record<string, unknown>)[def.textField] ?? '')).trim();
      if (!text) this.remove([id]);
    }
    if (this.shared.editingGesture) {
      this.shared.editingGesture = false;
      this.core.store.endGesture();
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
    if (this.shared.camAnim !== null) {
      cancelAnimationFrame(this.shared.camAnim);
      this.shared.camAnim = null;
    }
    const zoom = clampZoom(camera.zoom);
    if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y) || !Number.isFinite(zoom)) return;
    this.markCameraMoving();
    this.core.ui.setState({ camera: { x: camera.x, y: camera.y, zoom } });
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
        this.core.ui.setState({ camera: target });
      }
    };
    this.shared.camAnim = requestAnimationFrame(step);
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

  zoomTo(zoom: number, screenCenter?: Point): void {
    const vp = this.getViewportSize();
    const c = screenCenter ?? { x: vp.width / 2, y: vp.height / 2 };
    this.setCamera(zoomAt(this.getCamera(), zoom, c), { animate: true });
  }

  zoomToFit(ids?: string[], opts: { padding?: number; animate?: boolean; maxZoom?: number } = {}): void {
    const b = this.getBounds(ids && ids.length ? ids : undefined);
    const vp = this.getViewportSize();
    if (!b) {
      this.setCamera({ x: -vp.width / 2, y: -vp.height / 2, zoom: 1 }, { animate: opts.animate ?? true });
      return;
    }
    this.setCamera(fitRect(b, vp, opts.padding ?? 80, opts.maxZoom ?? 1), { animate: opts.animate ?? true });
  }

  zoomToRect(rect: Rect, opts: { padding?: number; animate?: boolean } = {}): void {
    this.setCamera(fitRect(rect, this.getViewportSize(), opts.padding ?? 40, MAX_ZOOM), {
      animate: opts.animate ?? true,
    });
  }

  getViewportCenter(): Point {
    const vp = this.getViewportSize();
    return this.screenToWorld({ x: vp.width / 2, y: vp.height / 2 });
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
    const prevId = this.getToolId();
    if (prevId === id) return;
    const prev = this.core.registry.toolsById.get(prevId);
    if (this.getEditingId()) this.stopEditing();
    if (prev) {
      const ed = this.core.scoped(prev.feature);
      prev.def.onCancel?.(ed);
      prev.def.onDeactivate?.(ed);
    }
    this.core.ui.setState({ toolId: id, hoverId: null, guides: [], marquee: null });
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
  runCommand(id: string): void {
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
    reg.def.run(ed);
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
