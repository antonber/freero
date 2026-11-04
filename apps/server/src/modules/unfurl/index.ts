// Public API of modules/unfurl [S2]: link previews for pasted URLs and images placed by URL
// (no tables), and the SSRF-safe fetch behind them, for other modules that fetch a URL someone
// else chose (apiauth: OAuth client metadata documents).
export { unfurl } from './service';
// Items the public API makes from a URL (#170): an image copied into the caller's uploads, a link card's preview.
export { importImageFromUrl, embedPreview, imageSize } from './boardItems';
// A remote image's checked bytes without storing them (GIF previews, #139).
export { fetchRemoteImage } from './image';
export { isBlockedAddress, checkUrl, safeFetch, UnfurlError, type FetchFailure, type FetchOptions, type Fetched, type Resolver } from './fetch';
