// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tooltip } from './Tooltip';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const tip = () => document.querySelector('[role="tooltip"]');

// WCAG 2.2 1.4.13 (content on hover): a tooltip can be read with the pointer resting on it, and
// Escape dismisses it without moving the pointer or focus.
it('a tooltip stays while the pointer moves onto it, and Escape dismisses it', () => {
  act(() =>
    root.render(
      <Tooltip content="Bring to front">
        <button type="button">Front</button>
      </Tooltip>,
    ),
  );
  const button = host.querySelector('button')!;
  act(() => {
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    vi.advanceTimersByTime(600);
  });
  expect(tip()?.textContent).toBe('Bring to front');

  // Off the button and onto the tooltip.
  act(() => {
    button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: tip() }));
    tip()!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: button }));
    vi.advanceTimersByTime(1000);
  });
  expect(tip()).not.toBeNull();

  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  expect(tip()).toBeNull();
});
