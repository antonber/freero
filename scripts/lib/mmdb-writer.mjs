// Test-only: writes a tiny MaxMind DB (.mmdb, format 2.0) so `npm run verify` can exercise the
// GeoIP session locations with a real database file, without shipping or downloading MaxMind data.
// Supports IPv4 networks and the data types a City record needs (maps, strings, unsigned ints,
// arrays). Spec: https://maxmind.github.io/MaxMind-DB/
//
//   writeMmdb(file, [{ cidr: '203.0.113.0/24', data: { city: { names: { en: 'Lyon' } }, country: { … } } }])

import fs from 'node:fs';

const METADATA_MARKER = Buffer.from([0xab, 0xcd, 0xef, ...Buffer.from('MaxMind.com')]);

function control(type, size) {
  const extended = type > 7;
  const head = extended ? 0 : type << 5;
  let sizeBytes = [];
  let sizeBits = size;
  if (size >= 29 && size < 285) {
    sizeBits = 29;
    sizeBytes = [size - 29];
  } else if (size >= 285) {
    throw new Error('mmdb-writer: values this large are not supported');
  }
  return Buffer.from([head | sizeBits, ...(extended ? [type - 7] : []), ...sizeBytes]);
}

function uintBytes(n) {
  const bytes = [];
  let v = BigInt(n);
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  return Buffer.from(bytes);
}

/** Encodes a value: strings (2), maps (7), arrays (11), unsigned ints as uint32 (6) or { uint64 } (9), { uint16 } (5). */
function encode(value) {
  if (typeof value === 'string') {
    const b = Buffer.from(value, 'utf8');
    return Buffer.concat([control(2, b.length), b]);
  }
  if (Array.isArray(value)) return Buffer.concat([control(11, value.length), ...value.map(encode)]);
  if (value && typeof value === 'object' && 'uint16' in value) {
    const b = uintBytes(value.uint16);
    return Buffer.concat([control(5, b.length), b]);
  }
  if (value && typeof value === 'object' && 'uint64' in value) {
    const b = uintBytes(value.uint64);
    return Buffer.concat([control(9, b.length), b]);
  }
  if (typeof value === 'number') {
    const b = uintBytes(value);
    return Buffer.concat([control(6, b.length), b]);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return Buffer.concat([control(7, entries.length), ...entries.flatMap(([k, v]) => [encode(k), encode(v)])]);
  }
  throw new Error(`mmdb-writer: cannot encode ${typeof value}`);
}

function ipv4Bits(ip) {
  const n = ip.split('.').reduce((acc, part) => (acc << 8n) | BigInt(Number(part)), 0n);
  return Array.from({ length: 32 }, (_, i) => Number((n >> BigInt(31 - i)) & 1n));
}

export function writeMmdb(file, networks, { databaseType = 'Freero-Test-City' } = {}) {
  // Data section: one record per network.
  const chunks = [];
  let offset = 0;
  const dataOffsets = networks.map(({ data }) => {
    const b = encode(data);
    chunks.push(b);
    const at = offset;
    offset += b.length;
    return at;
  });
  const dataSection = Buffer.concat(chunks);

  // Search tree: nodes of [left, right]; a record is { node } | { data } | null (no data).
  const nodes = [[null, null]];
  networks.forEach(({ cidr }, i) => {
    const [ip, prefix] = cidr.split('/');
    const bits = ipv4Bits(ip).slice(0, Number(prefix));
    let node = 0;
    bits.forEach((bit, depth) => {
      if (depth === bits.length - 1) {
        nodes[node][bit] = { data: dataOffsets[i] };
        return;
      }
      const rec = nodes[node][bit];
      if (rec && 'node' in rec) {
        node = rec.node;
      } else {
        nodes.push([null, null]);
        nodes[node][bit] = { node: nodes.length - 1 };
        node = nodes.length - 1;
      }
    });
  });
  const nodeCount = nodes.length;
  const value = (rec) => (rec === null ? nodeCount : 'node' in rec ? rec.node : nodeCount + 16 + rec.data);
  const tree = Buffer.alloc(nodeCount * 6);
  nodes.forEach(([l, r], i) => {
    tree.writeUIntBE(value(l), i * 6, 3);
    tree.writeUIntBE(value(r), i * 6 + 3, 3);
  });

  const metadata = encode({
    node_count: nodeCount,
    record_size: { uint16: 24 },
    ip_version: { uint16: 4 },
    database_type: databaseType,
    languages: ['en'],
    binary_format_major_version: { uint16: 2 },
    binary_format_minor_version: { uint16: 0 },
    build_epoch: { uint64: Math.floor(Date.now() / 1000) },
    description: { en: 'Freero test GeoIP database' },
  });
  fs.writeFileSync(file, Buffer.concat([tree, Buffer.alloc(16), dataSection, METADATA_MARKER, metadata]));
}
