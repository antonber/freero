// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { cardDraft, type CardElement } from '@freero/shared';
import { createTestBoard, type ElementDefinition, type FeatureBundle, type FormatDefinition, type PanelDefinition, type TestBoard } from '@engine';
import manifest from './feature';
import cardDef from './element';
import cardFormat from './format';
import cardPanel from './panel';
import commands from './commands';
import { DETAILS_PANEL } from './lib/constants';
import { DESC, PAD, TITLE, cardLayout } from './lib/layout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bundle: FeatureBundle = {
  manifest,
  elements: [cardDef as unknown as ElementDefinition],
  tools: [],
  formats: [cardFormat as FormatDefinition],
  panels: [cardPanel as PanelDefinition],
  commands,
};
const NOTES = 'Owner: Dana\nLead: Sam\nNext: send term sheet';

let board: TestBoard | null = null;
let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  board?.destroy();
  board = null;
  document.body.innerHTML = '';
});

/** An owner (ann, replica 0) and a viewer (vic, replica 1) of a board with one card, as the MCP add_cards tool writes it. */
function boardWithCard(description = NOTES) {
  board = createTestBoard({ users: ['ann', 'vic'], roles: ['owner', 'viewer'], features: [bundle] });
  const [ann, vic] = board.editors('card');
  const { id: _id, ...draft } = cardDraft({ text: 'Acme Corp', description, dueDate: '2026-11-13' }, 'x', 0, 0, 300, null);
  const id = ann.create(draft as never);
  board.sync();
  return { ann, vic, id, card: () => ann.getElement<CardElement>(id)! };
}

function render(el: Parameters<Root['render']>[0]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
}

const descriptionArea = () => document.querySelector('textarea[aria-label="Card description"]') as HTMLTextAreaElement;

function type(area: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('opening a card', () => {
  it('a double-click on the description opens the details (a viewer’s too) without editing the title; on the title it edits the title', () => {
    const { ann, vic, id, card } = boardWithCard();
    const { titleLines } = cardLayout(card());
    const onTitle = { x: 120, y: PAD.top + TITLE.line / 2 };
    const onDescription = { x: 120, y: PAD.top + titleLines * TITLE.line + DESC.gap + DESC.line };
    const doubleClick = (user: number, at: { x: number; y: number }) => {
      board!.click(user, at);
      board!.click(user, at, { count: 2 });
    };

    board!.click(0, onTitle); // selected first: its first click must not start editing the title
    doubleClick(0, onDescription);
    expect(board!.dialog(0)).toEqual({ id: DETAILS_PANEL, props: { id } });
    expect(ann.getEditingId()).toBeNull();

    ann.closePanel();
    doubleClick(0, onTitle);
    expect(ann.getEditingId()).toBe(id);
    expect(board!.dialog(0)).toBeNull();
    ann.stopEditing();

    doubleClick(1, onDescription);
    expect(board!.dialog(1)).toEqual({ id: DETAILS_PANEL, props: { id } });
    expect(vic.getEditingId()).toBeNull();
  });

  it('the expand button shows only while the description is cut off, and opens the details without selecting the card', async () => {
    // The browser's layout, as the line clamp leaves it: a long description overflows its 3 lines.
    const lines = (el: HTMLElement) => Math.ceil((el.textContent ?? '').length / 40);
    const desc = (el: HTMLElement) => el.classList.contains('fr-card__desc');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get(this: HTMLElement) { return desc(this) ? lines(this) * 18 : 0; } });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return desc(this) ? Math.min(3, lines(this)) * 18 : 0; } });
    const frame = () => act(() => new Promise<void>((r) => setTimeout(r, 40)));
    const expand = () => document.querySelector<HTMLButtonElement>('.fr-card__expand');
    try {
      const { ann, id } = boardWithCard('Call Dana on Monday');
      render(board!.element(0, id));
      await frame();
      expect(expand()).toBeNull();

      act(() => ann.update<CardElement>(id, { description: 'Scope, owners and risks. '.repeat(12) }));
      await frame();
      expect(expand()).not.toBeNull();
      act(() => expand()!.click());
      expect(board!.dialog(0)).toEqual({ id: DETAILS_PANEL, props: { id } });
      expect(ann.getSelection()).toEqual([]);

      act(() => ann.update<CardElement>(id, { description: 'Done.' }));
      await frame();
      expect(expand()).toBeNull();
    } finally {
      delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    }
  });

  it('a viewer reads the whole description and the fields in the details but cannot change them', () => {
    board = createTestBoard({ users: ['ann', 'vic'], roles: ['owner', 'viewer'], features: [bundle] });
    const [ann, vic] = board.editors('card');
    const prio = { id: 'f_prio', name: 'Priority', type: 'select', options: [{ id: 'o_p1', label: 'P1', color: '#F5A524' }] };
    const kid = ann.create({ type: 'kanban', x: 0, y: 0, w: 304, h: 300, title: 'Sprint', colW: 280, columns: [{ id: 'c1', title: 'To do', status: 'todo', color: '#8A89A3' }], fields: [prio] } as never);
    const id = ann.create({ type: 'card', x: 22, y: 110, w: 260, h: 90, title: 'Fix login', description: NOTES.replace(/\n/g, '<br>'), color: '#5B3FF0', status: 'todo', frameId: kid } as never);
    board.sync();
    render(board.panel(1, DETAILS_PANEL, { id }));
    const area = descriptionArea();
    expect(area.value).toBe(NOTES);
    expect(area.readOnly).toBe(true);
    const label = [...document.querySelectorAll('label')].find((l) => l.textContent === 'Priority')!;
    expect((document.getElementById(label.htmlFor) as HTMLButtonElement).disabled).toBe(true);
    type(area, `${NOTES}\nRisk: legal`);
    act(() => root!.unmount());
    root = null;
    expect(vic.getElement<CardElement>(id)!.description).toBe(NOTES.replace(/\n/g, '<br>'));
  });
});

describe('fields in card details', () => {
  it('picking a Priority in card details writes it to the card in one undo step; a field deleted from the kanban leaves the details, its value kept on the card', () => {
    board = createTestBoard({ users: ['ann'], features: [bundle] });
    const [ed] = board.editors('card');
    const columns = [{ id: 'c1', title: 'To do', status: 'todo', color: '#8A89A3' }];
    const prio = { id: 'f_prio', name: 'Priority', type: 'select', options: [{ id: 'o_p0', label: 'P0', color: '#E5484D' }, { id: 'o_p1', label: 'P1', color: '#F5A524' }] };
    const kid = ed.create({ type: 'kanban', x: 0, y: 0, w: 304, h: 300, title: 'Sprint', colW: 280, columns, fields: [prio] } as never);
    const id = ed.create({ type: 'card', x: 22, y: 110, w: 260, h: 90, title: 'Fix login', description: '', color: '#5B3FF0', status: 'todo', frameId: kid } as never);
    render(board.panel(0, DETAILS_PANEL, { id }));
    const control = (name: string) => {
      const label = [...document.querySelectorAll('label')].find((l) => l.textContent === name);
      return label ? (document.getElementById(label.htmlFor) as HTMLButtonElement) : null;
    };
    act(() => control('Priority')!.click());
    act(() => ([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent === 'P1') as HTMLButtonElement).click());
    expect(ed.getElement<CardElement>(id)!.values).toEqual({ f_prio: 'o_p1' });
    expect(control('Priority')!.textContent).toContain('P1');

    act(() => ed.update(kid, { fields: [] } as never));
    expect(control('Priority')).toBeNull();
    expect(ed.getElement<CardElement>(id)!.values).toEqual({ f_prio: 'o_p1' });
    act(() => ed.undo()); // the field comes back, with the value
    act(() => ed.undo()); // the pick
    expect(ed.getElement<CardElement>(id)!.values ?? {}).toEqual({});
  });
});

describe('card notes survive the details', () => {
  it('opening a card’s details and closing them untouched keeps its notes as they were, formatting included', () => {
    const { ann, id, card } = boardWithCard();
    ann.update<CardElement>(id, { description: 'Owner: <b>Dana</b><br>Next: send term sheet' });
    render(board!.panel(0, DETAILS_PANEL, { id }));
    expect(descriptionArea().value).toBe('Owner: Dana\nNext: send term sheet');
    act(() => descriptionArea().focus());
    act(() => descriptionArea().blur());
    act(() => root!.unmount());
    root = null;
    expect(card().description).toBe('Owner: <b>Dana</b><br>Next: send term sheet');
  });

  it('notes typed in the details are kept when the dialog closes mid-edit', () => {
    const { id, card } = boardWithCard();
    render(board!.panel(0, DETAILS_PANEL, { id }));
    expect(descriptionArea().value).toBe(NOTES);
    type(descriptionArea(), `${NOTES}\nRisk: legal`);
    act(() => root!.unmount());
    root = null;
    expect(card().description).toBe('Owner: Dana<br>Lead: Sam<br>Next: send term sheet<br>Risk: legal');
  });
});
