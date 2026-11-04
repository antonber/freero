import { Globe } from 'lucide-react';
import { defineCommands } from '@engine';
import { PUBLISH_DIALOG } from './panel';
import { t } from './messages';

export default defineCommands([
  {
    // #162: the board as a public template, reviewed before anyone sees it. Editors only: the
    // server checks the same (and the workspace's sharing and downloads policies).
    id: 'gallery.publish',
    label: t('publishToTheCommunityGallery'),
    icon: Globe,
    menus: ['board'],
    minRole: 'editor',
    when: (editor) => !!editor.host.gallery,
    run: (editor) => editor.openPanel(PUBLISH_DIALOG),
  },
]);
