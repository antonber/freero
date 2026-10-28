// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Menu } from './Menu';
import { Select } from './Select';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

// A key pressed right after opening must reach the menu / list, not the board behind it: focus
// has to move in the same commit (deferring it to the next frame also let it steal focus back
// after a fast close).
describe('menus and selects take focus as they open', () => {
  it('a menu focuses its first enabled item in the opening commit', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const items = [
      { id: 'a', label: 'Rename', disabled: true, onSelect: () => {} },
      { id: 'b', label: 'Duplicate', onSelect: () => {} },
    ];
    act(() => root.render(<Menu open onClose={() => {}} anchor={anchor} items={items} />));
    expect(document.activeElement?.hasAttribute('data-fr-item') && document.activeElement.textContent).toBe('Duplicate');
  });

  it('a select focuses the selected option in the opening commit', () => {
    act(() => root.render(<Select options={['Small', 'Medium', 'Large']} value="Medium" onChange={() => {}} aria-label="Size" />));
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Size"]')!.click());
    expect(document.activeElement?.hasAttribute('data-fr-item') && document.activeElement.textContent).toBe('Medium');
  });
});

describe('disabled menu items that explain why', () => {
  it('stay inert when clicked (they are not native-disabled, so they can show their reason)', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    let renamed = 0;
    let closed = 0;
    const items = [
      { id: 'rename', label: 'Rename', disabled: true, disabledReason: 'Only editors can rename this board', onSelect: () => renamed++ },
      { id: 'open', label: 'Open', onSelect: () => {} },
    ];
    act(() => root.render(<Menu open onClose={() => closed++} anchor={anchor} items={items} />));
    const rename = [...document.querySelectorAll<HTMLButtonElement>('[data-fr-item]')].find((b) => b.textContent === 'Rename')!;
    expect(rename.getAttribute('aria-disabled')).toBe('true');
    act(() => rename.click());
    expect({ renamed, closed }).toEqual({ renamed: 0, closed: 0 });
    // The menu opens on the first item that can actually be chosen.
    expect(document.activeElement?.textContent).toBe('Open');
  });
});
