// The comparison template's placeholder: no real competitor, nothing claimed about anyone. It is
// unpublished (noindex, out of the sitemap, linked from nowhere) and exists so the /vs/ route, the
// layout and the site checks run before the first real comparison is written from
// docs/marketing/competitors/. Copy this file to /vs/<slug>.page.tsx to start a real one.
import { defineComparison } from '../../lib/compare';

export default defineComparison({
  slug: 'example',
  competitor: 'Example Whiteboard',
  checked: '2026-10-28',
  published: false,
  title: 'Freero vs Example Whiteboard (template placeholder)',
  description: 'Placeholder for the comparison page template. Not published; real comparisons are written from checked, dated sources.',
  summary:
    'This page shows the layout of a Freero comparison. Every fact about the other product links to a public source with the date it was checked; every fact about Freero links to its documentation.',
  competitorStronger: ['Replace with what the other product does better, from the fact sheet’s sourced list.'],
  freeroStronger: [
    'You want agents to propose changes that people accept, instead of writing straight to the board.',
    'You want to host the whiteboard yourself, under the MIT licence.',
    'You want two-way Jira, Linear and GitHub sync without a paid plan.',
  ],
  rows: [
    { capability: 'MCP server for AI agents', competitor: { verdict: 'unverified', sources: [] }, freero: { verdict: 'yes', ref: 'docs/mcp.md' } },
    {
      capability: 'Agent edits reviewed by people',
      competitor: { verdict: 'unverified', sources: [] },
      freero: { verdict: 'yes', note: 'read and suggest by default', ref: 'docs/mcp.md' },
    },
    { capability: 'Self-hosting', competitor: { verdict: 'unverified', sources: [] }, freero: { verdict: 'yes', note: 'MIT licence', ref: 'docs/deployment.md' } },
    {
      capability: 'Two-way Jira, Linear and GitHub sync',
      competitor: { verdict: 'unverified', sources: [] },
      freero: { verdict: 'yes', ref: 'docs/trackers.md' },
    },
    {
      capability: 'Built-in AI',
      competitor: { verdict: 'unverified', sources: [] },
      freero: { verdict: 'partial', note: 'on a model provider you configure', ref: 'docs/ai.md' },
    },
  ],
  sources: [{ id: 'S1', title: 'Placeholder source', url: 'https://example.com/', checked: '2026-10-28' }],
});
