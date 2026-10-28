// Left floating toolbar: built-in + feature tools by order, "+" more-tools grid,
// the active tool's Options flyout, undo/redo at the bottom.
import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Plus, Redo2, Undo2 } from 'lucide-react';
import { IconButton, Popover } from '@ui';
import { ScopeContext, useCore } from '../context';
import { useRole, useToolId } from '../hooks';
import { ROLE_RANK } from '../runtime/core';
import type { Registered } from '../runtime/registry';
import type { ToolDefinition } from '../api';

/** Gap kept between the tool Options flyout and the window edges (px). */
const FLYOUT_MARGIN = 12;

export function Toolbar() {
  const core = useCore();
  const toolId = useToolId();
  const role = useRole();
  useStore(core.ui, (s) => s.undoVersion);
  const editor = core.editor;
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const barRef = useRef<HTMLDivElement>(null);
  const [optionsTop, setOptionsTop] = useState<number | null>(null);

  const allowed = (t: Registered<ToolDefinition>) => ROLE_RANK[role] >= ROLE_RANK[t.def.minRole ?? 'editor'];
  const tools = core.registry.tools.filter(allowed);
  const main = tools.filter((t) => t.def.placement === 'main');
  const more = tools.filter((t) => t.def.placement === 'more');
  const activeMore = more.find((t) => t.def.id === toolId);
  const canEdit = ROLE_RANK[role] >= ROLE_RANK.editor;
  const active = core.registry.toolsById.get(toolId);
  const Options = active?.def.Options;

  useLayoutEffect(() => {
    const btn = buttons.current.get(toolId);
    const bar = barRef.current;
    if (!btn || !bar || !Options) return setOptionsTop(null);
    const b = btn.getBoundingClientRect();
    const r = bar.getBoundingClientRect();
    setOptionsTop(b.top - r.top);
  }, [toolId, Options]);

  // Keep the flyout inside the window: it starts level with its tool button and slides up when it
  // would run past the bottom (tall pickers), re-checked whenever its content resizes.
  const optionsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = optionsRef.current;
    const bar = barRef.current;
    if (!box || !bar || optionsTop === null) return;
    const fit = () => {
      const barTop = bar.getBoundingClientRect().top;
      const h = box.offsetHeight;
      const maxTop = window.innerHeight - FLYOUT_MARGIN - h - barTop;
      box.style.top = `${Math.round(Math.max(FLYOUT_MARGIN - barTop, Math.min(optionsTop, maxTop)))}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [optionsTop, toolId]);

  const toolButton = (t: Registered<ToolDefinition>) => (
    <IconButton
      key={t.def.id}
      ref={(el) => {
        if (el) buttons.current.set(t.def.id, el);
        else buttons.current.delete(t.def.id);
      }}
      icon={t.def.icon}
      label={t.def.label}
      shortcut={t.def.shortcut?.toUpperCase()}
      tooltipSide="right"
      active={toolId === t.def.id}
      onClick={() => editor.setTool(t.def.id)}
    />
  );

  return (
    <div className="fr-toolbar" ref={barRef} data-fr-chrome="" data-fr-occludes="" data-fr-region="tools" role="region" aria-label="Tools and history">
      <div className="fr-toolbar__group" role="toolbar" aria-label="Tools" aria-orientation="vertical">
        {main.map(toolButton)}
        {more.length > 0 && (
          <>
            {/* While a "more" tool is active, this button wears its icon (and anchors its Options),
                so picking one never grows the toolbar and shifts every other button. */}
            <IconButton
              ref={(el) => {
                moreRef.current = el;
                if (!activeMore) return;
                if (el) buttons.current.set(activeMore.def.id, el);
                else buttons.current.delete(activeMore.def.id);
              }}
              icon={activeMore?.def.icon ?? Plus}
              label={activeMore ? `${activeMore.def.label} · More tools` : 'More tools'}
              shortcut={activeMore?.def.shortcut?.toUpperCase()}
              tooltipSide="right"
              active={moreOpen || !!activeMore}
              onClick={() => setMoreOpen((o) => !o)}
            />
            <Popover
              open={moreOpen}
              onClose={() => setMoreOpen(false)}
              anchor={moreRef.current}
              side="right"
              align="start"
              offset={14}
              className="fr-moretools"
              aria-label="More tools"
            >
              <div className="fr-moretools__title">More tools</div>
              <div className="fr-moretools__grid">
                {more.map((t) => (
                  <button
                    key={t.def.id}
                    type="button"
                    className={`fr-moretools__item${toolId === t.def.id ? ' is-active' : ''}`}
                    onClick={() => {
                      editor.setTool(t.def.id);
                      setMoreOpen(false);
                    }}
                  >
                    <t.def.icon size={22} strokeWidth={1.8} />
                    <span>{t.def.label}</span>
                  </button>
                ))}
              </div>
            </Popover>
          </>
        )}
      </div>
      {canEdit && (
        <div className="fr-toolbar__group">
          <IconButton
            icon={Undo2}
            label="Undo"
            shortcut="Mod+Z"
            tooltipSide="right"
            disabled={!editor.canUndo()}
            onClick={() => editor.undo()}
          />
          <IconButton
            icon={Redo2}
            label="Redo"
            shortcut="Mod+Shift+Z"
            tooltipSide="right"
            disabled={!editor.canRedo()}
            onClick={() => editor.redo()}
          />
        </div>
      )}
      {Options && optionsTop !== null && active && (
        <div ref={optionsRef} className="fr-tool-options" style={{ top: optionsTop }} data-fr-chrome="">
          <ScopeContext.Provider value={active.feature}>
            <Options editor={core.scoped(active.feature)} />
          </ScopeContext.Provider>
        </div>
      )}
    </div>
  );
}
