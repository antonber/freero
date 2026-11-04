// Search: Find Board (by title words, optionally in one workspace).
'use strict';

const { api } = require('../lib/freero');

module.exports = {
  find_board: {
    key: 'find_board',
    noun: 'Board',
    display: { label: 'Find Board', description: 'Finds a board you can open by words in its title.' },
    operation: {
      inputFields: [
        { key: 'q', label: 'Title', required: true },
        { key: 'workspace', label: 'Workspace', required: false, dynamic: 'workspaces.id.name' },
      ],
      perform: async (z, bundle) => {
        const params = { q: bundle.inputData.q, limit: 10 };
        if (bundle.inputData.workspace) params.workspace = bundle.inputData.workspace;
        const r = await z.request({ url: api(bundle, '/boards'), params });
        return r.data.boards;
      },
      sample: { id: 'b1', title: 'Team roadmap', description: '', url: 'https://freero.app/board/b1', role: 'editor', workspaceId: 'w1' },
    },
  },
};
