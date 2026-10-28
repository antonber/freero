// Test-only authoritative DNS server (UDP) that answers TXT questions from a table the test fills
// in, so `npm run verify` checks domain verification through the server's real resolver (pointed
// here with SSO_DNS_SERVERS) instead of skipping the lookup. Everything else: no answer (NODATA).
import dgram from 'node:dgram';

const TXT = 16;

function readName(buf, offset) {
  const labels = [];
  let i = offset;
  while (buf[i] !== 0) {
    labels.push(buf.subarray(i + 1, i + 1 + buf[i]).toString('ascii'));
    i += buf[i] + 1;
  }
  return { name: labels.join('.').toLowerCase(), end: i + 1 };
}

export async function startMockDns({ port = 0, host = '127.0.0.1' } = {}) {
  const records = new Map(); // name -> string[]
  const socket = dgram.createSocket('udp4');
  socket.on('message', (msg, rinfo) => {
    try {
      const { name, end } = readName(msg, 12);
      const qtype = msg.readUInt16BE(end);
      const question = msg.subarray(12, end + 4);
      const answers = qtype === TXT ? (records.get(name) ?? []) : [];
      const header = Buffer.alloc(12);
      msg.copy(header, 0, 0, 2); // id
      header.writeUInt16BE(0x8400 | (msg.readUInt16BE(2) & 0x0100) | (records.has(name) || answers.length ? 0 : 3), 2); // QR AA (+RD), NXDOMAIN if unknown
      header.writeUInt16BE(1, 4);
      header.writeUInt16BE(answers.length, 6);
      const rrs = answers.map((text) => {
        const chunks = [];
        for (let i = 0; i < text.length || i === 0; i += 255) {
          const c = Buffer.from(text.slice(i, i + 255), 'utf8');
          chunks.push(Buffer.from([c.length]), c);
        }
        const rdata = Buffer.concat(chunks);
        const rr = Buffer.alloc(12);
        rr.writeUInt16BE(0xc00c, 0); // pointer to the question's name
        rr.writeUInt16BE(TXT, 2);
        rr.writeUInt16BE(1, 4); // IN
        rr.writeUInt32BE(60, 6);
        rr.writeUInt16BE(rdata.length, 10);
        return Buffer.concat([rr, rdata]);
      });
      socket.send(Buffer.concat([header, question, ...rrs]), rinfo.port, rinfo.address);
    } catch {
      /* malformed query: no answer */
    }
  });
  await new Promise((resolve) => socket.bind(port, host, resolve));
  return {
    server: `${host}:${socket.address().port}`,
    /** Publishes (or with [] removes) the TXT strings at `name`. */
    setTxt: (name, values) => (values.length ? records.set(name.toLowerCase(), values) : records.delete(name.toLowerCase())),
    close: () => new Promise((resolve) => socket.close(() => resolve())),
  };
}
