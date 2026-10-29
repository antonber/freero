// Public API of modules/unfurl [S2]: link previews for pasted URLs and images placed by URL
// (no tables), and the SSRF-safe fetch behind them, for other modules that fetch a URL someone
// else chose (apiauth: OAuth client metadata documents).
export { unfurl } from './service';
export { isBlockedAddress, checkUrl, safeFetch, UnfurlError, type FetchFailure, type FetchOptions, type Fetched, type Resolver } from './fetch';
