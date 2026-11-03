// Team stickers (#138): images a workspace uploaded into its sticker sets, placed as emoji items
// whose value is `img:/uploads/<name>`. Only our own uploads ever render: a value naming any other
// URL (typed into a board by hand, from a newer client) shows nothing rather than load a third
// party's image. Uploaded SVGs are served sandboxed and drawn with <img>, which never runs script.
export const CUSTOM_PREFIX = 'img:';

const OWN_UPLOAD = /^\/uploads\/[A-Za-z0-9_-]{6,64}\.(?:png|svg|webp|gif)$/;

/** The image a team-sticker value shows, or null (not one, or not one of our uploads). */
export function customSrc(value: string): string | null {
  if (!value.startsWith(CUSTOM_PREFIX)) return null;
  const url = value.slice(CUSTOM_PREFIX.length);
  return OWN_UPLOAD.test(url) ? url : null;
}

export const isCustom = (value: string) => value.startsWith(CUSTOM_PREFIX);
export const customValue = (url: string) => `${CUSTOM_PREFIX}${url}`;

/** What a picked image file is called by default: its name without the extension. */
export function stickerNameOf(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
  return (base || 'Sticker').slice(0, 60);
}

/** Image types a sticker may be (the server checks the bytes again). */
export const STICKER_ACCEPT = 'image/png,image/svg+xml,image/webp,image/gif';
