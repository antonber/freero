// The landing page's illustration (original artwork, inline SVG so it costs no request): a board
// frame with sticky notes, a person's cursor, an agent's cursor labelled the way Freero labels it
// ("<App> for <Person>"), and the agent's proposal waiting as dashed ghosts with Accept / Reject.
const INK = '#17162b';

function Note({ x, y, fill, lines, rot = 0 }: { x: number; y: number; fill: string; lines: string[]; rot?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect width="120" height="104" rx="5" fill={fill} />
      {lines.map((l, i) => (
        <text key={i} x="12" y={30 + i * 20} fontSize="15" fontWeight="600" fill={INK}>
          {l}
        </text>
      ))}
    </g>
  );
}

function Ghost({ x, y, lines }: { x: number; y: number; lines: string[] }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="120" height="80" rx="5" fill="#eeeaff" stroke="#5b3ff0" strokeWidth="2" strokeDasharray="6 5" />
      {lines.map((l, i) => (
        <text key={i} x="12" y={30 + i * 20} fontSize="15" fontWeight="600" fill="#3f26c4">
          {l}
        </text>
      ))}
    </g>
  );
}

function Cursor({ x, y, color, label, width }: { x: number; y: number; color: string; label: string; width: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M0 0 L0 22 L6 17 L10 26 L14 24 L10 15 L18 15 Z" fill={color} stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
      <rect x="14" y="24" width={width} height="26" rx="13" fill={color} />
      <text x="26" y="42" fontSize="14" fontWeight="600" fill="#fff">
        {label}
      </text>
    </g>
  );
}

export function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 620 440" role="img" aria-labelledby="hero-art-title hero-art-desc" fontFamily="Inter, system-ui, sans-serif">
      <title id="hero-art-title">A Freero board shared by a person and an agent</title>
      <desc id="hero-art-desc">
        A frame called Launch retro holds sticky notes. Maria’s cursor is on the board, and so is an agent’s cursor labelled “Claude for Maria”. The agent has
        proposed two new notes, shown as dashed outlines with buttons to accept or reject them.
      </desc>
      <rect x="0" y="0" width="620" height="440" rx="18" fill="#ffffff" />
      <rect x="16" y="16" width="588" height="408" rx="12" fill="#f3f2f8" />
      <g fill="#cdcbdc">
        {Array.from({ length: 15 }, (_, i) => Array.from({ length: 10 }, (_, j) => <circle key={`${i}-${j}`} cx={36 + i * 40} cy={36 + j * 40} r="1.6" />))}
      </g>
      <rect x="40" y="56" width="300" height="300" rx="8" fill="#ffffff" stroke="#cfcde0" />
      <text x="40" y="46" fontSize="14" fontWeight="600" fill="#4b4a63">
        Launch retro
      </text>
      <Note x={60} y={80} fill="#ffe58a" lines={['Demo went', 'smoothly']} rot={-2} />
      <Note x={196} y={78} fill="#b8f5e2" lines={['Docs were', 'late again']} rot={2} />
      <Note x={60} y={212} fill="#ffd0e1" lines={['Too many', 'handoffs']} rot={1} />
      <Note x={196} y={214} fill="#d9d0ff" lines={['Ship smaller', 'batches']} rot={-1} />
      <text x="372" y="72" fontSize="13" fontWeight="600" fill="#3f26c4">
        Proposed by Claude for Maria
      </text>
      <Ghost x={372} y={84} lines={['Theme:', 'handoffs']} />
      <Ghost x={372} y={176} lines={['Action: docs', 'in the sprint']} />
      <g transform="translate(372 272)">
        <rect width="150" height="40" rx="20" fill="#ffffff" stroke="#cfcde0" />
        <rect x="6" y="6" width="70" height="28" rx="14" fill="#5b3ff0" />
        <text x="18" y="25" fontSize="13" fontWeight="600" fill="#fff">
          Accept
        </text>
        <text x="90" y="25" fontSize="13" fontWeight="600" fill="#4b4a63">
          Reject
        </text>
      </g>
      <Cursor x={300} y={300} color="#d6336c" label="Maria" width={64} />
      <Cursor x={458} y={150} color="#5b3ff0" label="Claude for Maria" width={132} />
      <g transform="translate(40 380)">
        <circle cx="12" cy="12" r="12" fill="#d6336c" />
        <text x="7" y="17" fontSize="13" fontWeight="700" fill="#fff">
          M
        </text>
        <circle cx="38" cy="12" r="12" fill="#1c7ed6" />
        <text x="33" y="17" fontSize="13" fontWeight="700" fill="#fff">
          L
        </text>
        <rect x="56" y="0" width="24" height="24" rx="7" fill="#5b3ff0" />
        <text x="62" y="17" fontSize="12" fontWeight="700" fill="#fff">
          AI
        </text>
        <text x="92" y="17" fontSize="13" fill="#4b4a63">
          2 people and an agent on this board
        </text>
      </g>
    </svg>
  );
}
