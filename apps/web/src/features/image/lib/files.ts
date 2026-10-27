// Browser-side helpers: reading image sizes, the file picker, data URLs.

/** Natural pixel size of an image URL, or null if it doesn't load as an image in time. */
export function naturalSizeOf(src: string, timeoutMs = 8000): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (v: { w: number; h: number } | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    img.onload = () => finish({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => finish(null);
    img.decoding = 'async';
    img.src = src;
  });
}

export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  try {
    const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
  } catch {
    return null;
  }
}

export const isImageFile = (f: File) => f.type.startsWith('image/');

/** Opens the OS file picker for images; resolves with the chosen files ([] when cancelled). */
export function pickImageFiles(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
    input.multiple = multiple;
    input.style.display = 'none';
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(Array.from(input.files ?? []).filter(isImageFile)));
    input.addEventListener('cancel', () => done([]));
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * The image a paste refers to, if any: a data URL, a lone http(s) URL, or the <img> of copied
 * HTML when there's no meaningful plain text.
 */
export function imageUrlFromPaste(text: string | null, html: string | null): string | null {
  const t = text?.trim() ?? '';
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(t)) return t;
  if (/^https?:\/\/\S+$/i.test(t)) return t;
  if (html && (!t || /^https?:\/\//i.test(t))) {
    const m = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(html);
    if (m && /^(https?:|data:image\/)/i.test(m[1])) return m[1].replace(/&amp;/g, '&');
  }
  return null;
}
