// File naming and browser download helpers.

const ILLEGAL = /[<>:"/\|?*\u0000-\u001f]+/g;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * A file name safe on Windows, macOS and Linux, derived from the board title:
 * "Q3 / Q4 plan?" + " - frames" + "pdf" -> "Q3 - Q4 plan - frames.pdf".
 */
export function exportFileName(boardTitle: string, ext: string, suffix = ''): string {
  let base = boardTitle.replace(ILLEGAL, ' - ').replace(/\s+/g, ' ').replace(/(\s*-\s*)+/g, ' - ');
  base = base.replace(/^[\s.-]+|[\s.-]+$/g, '').slice(0, 80).trim();
  if (!base || RESERVED.test(base)) base = 'Freero board';
  return `${base}${suffix ? ` - ${suffix}` : ''}.${ext}`;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(5, comma); // after "data:"
  const mime = meta.split(';')[0] || 'application/octet-stream';
  const payload = dataUrl.slice(comma + 1);
  if (meta.includes(';base64')) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
