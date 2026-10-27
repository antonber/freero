// Mounts feature panels into a named chrome slot, each inside its feature scope.
import type { PanelSlot } from '../api';
import { ScopeContext, useCore } from '../context';
import { useRole } from '../hooks';
import { ROLE_RANK } from '../runtime/core';

export function PanelSlotView({ slot, className }: { slot: PanelSlot; className?: string }) {
  const core = useCore();
  const role = useRole();
  const list = (core.registry.panels.get(slot) ?? []).filter(
    (p) => ROLE_RANK[role] >= ROLE_RANK[p.def.minRole ?? 'viewer'],
  );
  if (!list.length) return null;
  const items = list.map(({ def, feature }) => (
    <ScopeContext.Provider key={def.id} value={feature}>
      <def.Component editor={core.scoped(feature)} />
    </ScopeContext.Provider>
  ));
  return className ? <div className={className}>{items}</div> : <>{items}</>;
}
