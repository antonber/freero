// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { cardDraft, type CardElement } from '@freero/shared';
import { createTestBoard, type ElementDefinition, type FeatureBundle, type FormatDefinition, type TestBoard } from '@engine';
import manifest from './feature';
import cardDef from './element';
import cardFormat from './format';

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
