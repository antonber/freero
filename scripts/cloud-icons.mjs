#!/usr/bin/env node
// Vendors the cloud architecture icon sets Freero bundles (#4) from each vendor's OFFICIAL package,
// so the icon library offers them as built-in, read-only packs. Which sets may be bundled, and why,
// is docs/design/cloud-icons.md; the notices are THIRD_PARTY_NOTICES.md. Run:
//
//   npm run icons:cloud                        download every set's official package and regenerate
//   npm run icons:cloud -- --only aws,azure    some sets
//   npm run icons:cloud -- --from <dir>        use packages downloaded before (<dir>/<set>.zip)
//
// Each package is downloaded into a new, empty temporary directory and read IN MEMORY: nothing in it
// is extracted, run or trusted. Every SVG goes through `sanitizeSvg` (@freero/shared icons.ts), the
// same reduction an uploaded pack gets, with its colours kept (the vendors' terms: use the icons as
// they are, never recoloured); nothing else about a drawing is changed. Writes, per set,
// apps/web/src/features/icons/lib/cloud/<set>.json (the drawings, a chunk of their own) and the
// manifest beside them (where each set came from, its licence, how many icons), which
// scripts/license-check.mjs reads. Commit the result; review THIRD_PARTY_NOTICES.md if a vendor's
// terms changed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { CLOUD_ICON_SETS, ICON_LIMITS, sanitizeSvg } from '../packages/shared/src/icons.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT = path.join(ROOT, 'apps/web/src/features/icons/lib/cloud');

const words = (s) => s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
/** A folder name as a section heading, in sentence case ("ai + machine learning" → "AI + machine learning"). */
const capital = (s) =>
  s
    .split(' ')
    .map((w, i) => ({ ai: 'AI', iot: 'IoT', devops: 'DevOps' })[w.toLowerCase()] ?? (i ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');

async function get(url, as = 'buffer') {
  const res = await fetch(url, { headers: { 'user-agent': 'freero-cloud-icons (+https://github.com/antonber/freero)' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return as === 'text' ? res.text() : as === 'json' ? res.json() : Buffer.from(await res.arrayBuffer());
}

/** The first link on an official download page that matches `re` (the package's file name changes with each release). */
async function linkOn(page, re) {
  const html = await get(page, 'text');
  const m = re.exec(html);
  if (!m) throw new Error(`${page}: no download link matching ${re} (did the page change? see docs/design/cloud-icons.md)`);
  return m[0].replace(/&amp;/g, '&');
}

// Kubernetes' file names are abbreviations; the icons README names each object by its kind.
const K8S = {
  api: 'API server', 'c-c-m': 'Cloud controller manager', 'c-m': 'Controller manager', 'k-proxy': 'Kube-proxy', kubelet: 'Kubelet', sched: 'Scheduler',
  'control-plane': 'Control plane', node: 'Node', etcd: 'etcd',
  'c-role': 'ClusterRole', cm: 'ConfigMap', crb: 'ClusterRoleBinding', crd: 'CustomResourceDefinition', cronjob: 'CronJob', deploy: 'Deployment',
  ds: 'DaemonSet', ep: 'Endpoints', group: 'Group', hpa: 'HorizontalPodAutoscaler', ing: 'Ingress', job: 'Job', limits: 'LimitRange',
  netpol: 'NetworkPolicy', ns: 'Namespace', pod: 'Pod', psp: 'PodSecurityPolicy', pv: 'PersistentVolume', pvc: 'PersistentVolumeClaim',
  quota: 'ResourceQuota', rb: 'RoleBinding', role: 'Role', rs: 'ReplicaSet', sa: 'ServiceAccount', sc: 'StorageClass', secret: 'Secret',
  sts: 'StatefulSet', svc: 'Service', user: 'User', vol: 'Volume',
};

/**
 * The sets. `pick(entry)` names an SVG the set takes ({ name, group, keywords? }) or skips it (null).
 * Google Cloud is NOT here: its official page grants no licence to copy or redistribute its icons
 * (docs/design/cloud-icons.md), and scripts/license-check.mjs fails if a set for it appears.
 */
const SETS = [
  {
    id: 'aws',
    licence: 'LicenseRef-AWS-Architecture-Icons',
    terms: 'https://aws.amazon.com/architecture/icons/',
    async source() {
      const url = await linkOn(this.terms, /https:\/\/d1\.awsstatic\.com\/[^"'\s]*Icon-package_[^"'\s]*\.zip/);
      return { url, version: /Icon-package_(\d{8})/.exec(url)?.[1] ?? null };
    },
    pick(entry) {
      const p = entry.split('/');
      const file = p[p.length - 1].replace(/\.svg$/i, '');
      // Service icons at 64 px (the same drawing at every size), every resource icon in its light version.
      if (/^Architecture-Service-Icons/.test(p[0]) && p[2] === '64') return { name: words(file.replace(/^Arch_/, '').replace(/_64$/, '')), group: capital(words(p[1].replace(/^Arch_/, ''))) };
      if (/^Resource-Icons/.test(p[0]) && !/_Dark$/.test(file)) {
        const [service, ...resource] = file.replace(/^Res_/, '').replace(/_48(_Light)?$/, '').split('_');
        const group = words(p[1].replace(/^Res_/, ''));
        return { name: [words(service), ...resource.map(words)].join(' – '), group: capital(group === 'IoT' ? 'Internet of things' : group) };
      }
      if (/^Category-Icons/.test(p[0]) && /_64$/.test(p[1] ?? '')) return { name: `${words(file.replace(/^Arch-Category_/, '').replace(/_64$/, ''))} (category)`, group: 'Categories' };
      // Group icons (VPC, subnet, region…) without the AWS logo ones: a logo is a trademark, not a diagram icon.
      if (/^Architecture-Group-Icons/.test(p[0]) && !/logo/i.test(file) && !/_Dark$/.test(file)) return { name: `${words(file.replace(/_32$/, ''))} (group)`, group: 'Groups' };
      return null;
    },
  },
  {
    id: 'azure',
    licence: 'LicenseRef-Azure-Architecture-Icons',
    terms: 'https://learn.microsoft.com/en-us/azure/architecture/icons/',
    async source() {
      const url = await linkOn(this.terms, /https:\/\/arch-center\.azureedge\.net\/icons\/Azure_Public_Service_Icons_V\d+\.zip/);
      return { url, version: /_(V\d+)\.zip$/.exec(url)?.[1] ?? null };
    },
    pick(entry) {
      const m = /\/Icons\/([^/]+)\/\d+-icon-service-([^/]+)\.svg$/i.exec(entry);
      return m ? { name: words(m[2]), group: capital(m[1]) } : null;
    },
  },
  {
    id: 'kubernetes',
    licence: 'CC-BY-4.0',
    terms: 'https://github.com/kubernetes/community/tree/master/icons',
    async source() {
      const commit = await get('https://api.github.com/repos/kubernetes/community/commits/main', 'json');
      return { url: `https://codeload.github.com/kubernetes/community/zip/${commit.sha}`, version: commit.sha };
    },
    pick(entry) {
      // The unlabeled resources and infrastructure; the control plane comes labeled only (its text
      // labels aren't drawing primitives and drop out, which leaves the unlabeled glyph).
      const m = /\/icons\/svg\/(resources|infrastructure_components|control_plane_components)\/(labeled|unlabeled)\/([a-z-]+)\.svg$/.exec(entry);
      if (!m || (m[2] === 'labeled' && m[1] !== 'control_plane_components') || !K8S[m[3]]) return null;
      return { name: K8S[m[3]], group: { resources: 'Resources', infrastructure_components: 'Infrastructure', control_plane_components: 'Control plane' }[m[1]], keywords: m[3].replace(/-/g, ' ') };
    },
  },
];

// The sets are the ones @freero/shared names (CLOUD_ICON_SETS): the app shows exactly those.
for (const s of SETS) if (!CLOUD_ICON_SETS.some((c) => c.id === s.id)) throw new Error(`${s.id}: add it to CLOUD_ICON_SETS (packages/shared/src/icons.ts) first`);
for (const c of CLOUD_ICON_SETS) if (!SETS.some((s) => s.id === c.id)) throw new Error(`${c.id}: CLOUD_ICON_SETS names a set this script doesn't make`);

const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const from = arg('--from');
const only = arg('--only')?.split(',');
const manifestFile = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { sets: [] };

fs.mkdirSync(OUT, { recursive: true });
for (const set of SETS) {
  if (only && !only.includes(set.id)) continue;
  let data;
  let source;
  if (from) {
    data = fs.readFileSync(path.join(from, `${set.id}.zip`));
    source = manifest.sets.find((s) => s.id === set.id)?.source ?? { url: null, version: null };
  } else {
    source = await set.source();
    // A new, empty directory per package; deleted afterwards. The bytes are only ever read here.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `freero-cloud-icons-${set.id}-`));
    try {
      console.log(`${set.id}: ${source.url}`);
      fs.writeFileSync(path.join(dir, 'package.zip'), await get(source.url));
      data = fs.readFileSync(path.join(dir, 'package.zip'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const picked = new Map();
  const files = unzipSync(new Uint8Array(data), {
    filter(f) {
      if (!/\.svg$/i.test(f.name) || /(^|\/)(__MACOSX\/|\._)/.test(f.name) || f.originalSize > ICON_LIMITS.svgChars) return false;
      const p = set.pick(f.name);
      if (p) picked.set(f.name, p);
      return !!p;
    },
  });
  const decoder = new TextDecoder();
  const icons = [];
  const skipped = [];
  const seen = new Set();
  for (const name of Object.keys(files).sort()) {
    const { name: label, group, keywords } = picked.get(name);
    const out = sanitizeSvg(decoder.decode(files[name]), { keepColours: true });
    if (!out.ok) {
      skipped.push(`${name}: ${out.reason}`);
      continue;
    }
    const iconName = label.slice(0, ICON_LIMITS.name);
    // Azure files one icon under several categories: keep its first.
    if (seen.has(iconName)) continue;
    seen.add(iconName);
    icons.push(keywords ? [iconName, group, out.viewBox, out.nodes, keywords] : [iconName, group, out.viewBox, out.nodes]);
  }
  icons.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const body = JSON.stringify({ id: set.id, icons });
  fs.writeFileSync(path.join(OUT, `${set.id}.json`), `${body}\n`);
  const entry = {
    id: set.id,
    name: CLOUD_ICON_SETS.find((c) => c.id === set.id).name,
    licence: set.licence,
    terms: set.terms,
    source: { ...source, sha256: crypto.createHash('sha256').update(data).digest('hex'), retrieved: new Date().toISOString().slice(0, 10) },
    icons: icons.length,
  };
  manifest.sets = [...manifest.sets.filter((s) => s.id !== set.id), entry].sort((a, b) => SETS.findIndex((s) => s.id === a.id) - SETS.findIndex((s) => s.id === b.id));
  console.log(`${set.id}: ${icons.length} icons, ${(body.length / 1024).toFixed(0)} KB${skipped.length ? `; skipped ${skipped.length}:\n  ${skipped.join('\n  ')}` : ''}`);
}
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
