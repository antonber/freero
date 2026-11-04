// Hidden triggers that fill the dropdowns: your workspaces, team workspaces you administer (where
// webhooks live), and your boards.
'use strict';

const { api } = require('../lib/freero');

const workspaces = (z, bundle) => z.request({ url: api(bundle, '/workspaces') }).then((r) => r.data.workspaces);

module.exports = {
  workspaces: {
    key: 'workspaces',
    noun: 'Workspace',
    display: { label: 'Workspaces', description: 'Your workspaces.', hidden: true },
    operation: { perform: workspaces, sample: { id: 'w1', name: 'Design team', kind: 'team', role: 'admin' } },
  },
  admin_workspaces: {
    key: 'admin_workspaces',
    noun: 'Workspace',
    display: { label: 'Team workspaces you administer', description: 'Team workspaces whose webhooks you may manage.', hidden: true },
    operation: {
      perform: (z, bundle) => workspaces(z, bundle).then((ws) => ws.filter((w) => w.kind === 'team' && (w.role === 'owner' || w.role === 'admin'))),
      sample: { id: 'w1', name: 'Design team', kind: 'team', role: 'admin' },
    },
  },
  boards: {
    key: 'boards',
    noun: 'Board',
    display: { label: 'Boards', description: 'Boards you can open.', hidden: true },
    operation: {
      inputFields: [{ key: 'workspace', label: 'Workspace', dynamic: 'workspaces.id.name', required: false }],
      perform: (z, bundle) => {
        const params = { limit: 100 };
        if (bundle.inputData.workspace) params.workspace = bundle.inputData.workspace;
        if (bundle.meta && bundle.meta.page) return []; // one page: the 100 most recently changed
        return z.request({ url: api(bundle, '/boards'), params }).then((r) => r.data.boards);
      },
      sample: { id: 'b1', title: 'Team roadmap', url: 'https://freero.app/board/b1' },
    },
  },
};
