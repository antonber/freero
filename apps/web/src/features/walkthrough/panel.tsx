import { definePanel } from '@engine';
import { CaptionsDialog } from './lib/CaptionsDialog';
import { CAPTIONS_ID, LIST_ID, START_ID } from './lib/ids';
import { ListPanel, TopbarButton } from './lib/List';
import { PlayerOverlay } from './lib/Player';
import { RecordingOverlay, StartDialog } from './lib/Recording';
import './walkthrough.css';

export default [
  definePanel({ id: LIST_ID, slot: 'dock-right', order: 58, minRole: 'viewer', Component: ListPanel }),
  definePanel({ id: 'walkthrough.topbar', slot: 'topbar-right', order: 25, minRole: 'viewer', Component: TopbarButton }),
  /** Choosing camera / voice only and asking for the devices. */
  definePanel({ id: START_ID, slot: 'dialog', order: 0, minRole: 'editor', Component: StartDialog }),
  definePanel({ id: CAPTIONS_ID, slot: 'dialog', order: 0, minRole: 'viewer', Component: CaptionsDialog }),
  definePanel({ id: 'walkthrough.recording', slot: 'screen-overlay', order: 40, minRole: 'viewer', Component: RecordingOverlay }),
  definePanel({ id: 'walkthrough.player', slot: 'screen-overlay', order: 41, minRole: 'viewer', Component: PlayerOverlay }),
];
