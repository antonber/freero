// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { cardDraft, type CardElement } from '@freero/shared';
import { createTestBoard, type ElementDefinition, type FeatureBundle, type FormatDefinition, type TestBoard } from '@engine';
import manifest from './feature';
import cardDef from './element';
import cardFormat from './format';
import commands from './commands';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bundle: FeatureBundle = { manifest, elements: [cardDef as unknown as ElementDefinition], tools: [], formats: [cardFormat as FormatDefinition], panels: [], commands: [] };
const NOTES = 'Owner: Dana\nLead: Sam\nNext: send term sheet';

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
  document.body.innerHTML = '';
});

/** A card exactly as the MCP add_cards / import_from_tracker tools write it, and its toolbar shown as when it is clicked. */
function clickedCard() {
  board = createTestBoard({ users: ['ann'], features: [bundle] });
  const [ed] = board.editors('card');
  const { id: _id, ...draft } = cardDraft({ text: 'Acme Corp', description: NOTES, dueDate: '2026-11-13' }, 'x', 0, 0, 300, null);
  const id = ed.create(draft as never);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const Format = cardFormat.Component;
  act(() => root.render(<Format editor={ed} selection={[ed.getElement<CardElement>(id)!]} />));
  const notes = () => ed.getElement<CardElement>(id)!.description;
  return { ed, id, root, notes };
}

describe('fields in card details', () => {
  it('picking a Priority in card details writes it to the card in one undo step; a field deleted from the kanban leaves the details, its value kept on the card', () => {
    board = createTestBoard({ users: ['ann'], features: [{ ...bundle, commands }] });
    const [ed] = board.editors('card');
    const columns = [{ id: 'c1', title: 'To do', status: 'todo', color: '#8A89A3' }];
    const prio = { id: 'f_prio', name: 'Priority', type: 'select', options: [{ id: 'o_p0', label: 'P0', color: '#E5484D' }, { id: 'o_p1', label: 'P1', color: '#F5A524' }] };
    const kid = ed.create({ type: 'kanban', x: 0, y: 0, w: 304, h: 300, title: 'Sprint', colW: 280, columns, fields: [prio] } as never);
    const id = ed.create({ type: 'card', x: 22, y: 110, w: 260, h: 90, title: 'Fix login', description: '', color: '#5B3FF0', status: 'todo', frameId: kid } as never);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const Format = cardFormat.Component;
    const render = () => act(() => root.render(<Format editor={ed} selection={[ed.getElement<CardElement>(id)!]} />));
    render();
    act(() => (document.querySelector('[aria-label="Open details"]') as HTMLButtonElement).click());
    const control = (name: string) => {
      const label = [...document.querySelectorAll('label')].find((l) => l.textContent === name);
      return label ? (document.getElementById(label.htmlFor) as HTMLButtonElement) : null;
    };
    act(() => control('Priority')!.click());
    act(() => ([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent === 'P1') as HTMLButtonElement).click());
    expect(ed.getElement<CardElement>(id)!.values).toEqual({ f_prio: 'o_p1' });
    render();
    expect(control('Priority')!.textContent).toContain('P1');

    ed.update(kid, { fields: [] } as never);
    render();
    expect(control('Priority')).toBeNull();
    expect(ed.getElement<CardElement>(id)!.values).toEqual({ f_prio: 'o_p1' });
    ed.undo(); // the field comes back, with the value
    ed.undo(); // the pick
    expect(ed.getElement<CardElement>(id)!.values ?? {}).toEqual({});
    act(() => root.unmount());
  });
});

describe('card notes survive selection', () => {
  it('clicking a card and clicking away does not wipe the notes the MCP tools wrote', () => {
    const { root, notes } = clickedCard();
    const before = notes();
    expect(before).toContain('Next: send term sheet');
    // Deselecting unmounts the card's format toolbar (the details editor was never opened).
    act(() => root.unmount());
    expect(notes()).toBe(before);
  });

  it('notes typed in Open details are kept when the card is deselected mid-edit', () => {
    const { root, notes } = clickedCard();
    act(() => (document.querySelector('[aria-label="Open details"]') as HTMLButtonElement).click());
    const area = document.querySelector('textarea[aria-label="Card description"]') as HTMLTextAreaElement;
    expect(area.value).toBe(NOTES);
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(area, `${NOTES}\nRisk: legal`);
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => root.unmount());
    expect(notes()).toBe('Owner: Dana<br>Lead: Sam<br>Next: send term sheet<br>Risk: legal');
  });
});
