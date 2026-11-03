// Freero's few uses of the Microsoft Teams JavaScript library (@microsoft/teams-js, MIT), in one
// place. The library talks to Teams by postMessage and accepts answers only from Teams' own origins
// (its list, or this page's own origin), so a page that isn't framed by Teams never gets a context
// here — and the sign-in results these pages hand back reach only Teams.
import { app, authentication, meeting, pages } from '@microsoft/teams-js';
import type { ColorTheme } from '../lib/theme';

export type TeamsSurface = 'content' | 'settings' | 'sidePanel' | 'meetingStage' | 'authentication' | 'other';

export interface TeamsInfo {
  surface: TeamsSurface;
  theme: ColorTheme;
  /** 'web' (a browser tab), 'desktop', 'android', 'ios', … */
  client: string;
  inMeeting: boolean;
}

/** Teams' theme as Freero's: Teams' dark and high-contrast themes are dark. */
export const teamsTheme = (t: string | undefined): ColorTheme => (t === 'dark' || t === 'contrast' ? 'dark' : 'light');

let started: Promise<TeamsInfo | null> | null = null;

/**
 * Connects to Teams once per page: the page's surface (tab, configuration, meeting side panel or
 * stage, sign-in window), theme and client. Null when Teams doesn't answer within `timeoutMs` —
 * the page isn't running inside Teams.
 */
export function connectTeams(timeoutMs = 5000): Promise<TeamsInfo | null> {
  started ??= (async () => {
    try {
      await Promise.race([app.initialize(), new Promise((_, reject) => setTimeout(() => reject(new Error('Teams did not answer')), timeoutMs))]);
      const ctx = await app.getContext();
      const fc = String(ctx.page.frameContext ?? '');
      const surface: TeamsSurface = (['content', 'settings', 'sidePanel', 'meetingStage', 'authentication'] as const).find((s) => s === fc) ?? 'other';
      return { surface, theme: teamsTheme(ctx.app.theme), client: String(ctx.app.host.clientType ?? 'web'), inMeeting: !!ctx.meeting?.id };
    } catch {
      return null;
    }
  })();
  return started;
}

/** Tells Teams the page has loaded (it hides its own loading indicator). */
export function teamsLoaded(): void {
  void app.notifySuccess();
}

export function onTeamsTheme(handler: (theme: ColorTheme) => void): void {
  app.registerOnThemeChangeHandler((t) => handler(teamsTheme(t)));
}

/**
 * Opens one of Freero's own pages in Teams' sign-in window and waits for what it hands back
 * (`finishTeamsSignIn`). Null when the person closed the window.
 */
export async function teamsSignInWindow(path: string, size = { width: 480, height: 680 }): Promise<string | null> {
  try {
    return await authentication.authenticate({ url: new URL(path, window.location.origin).href, ...size });
  } catch {
    return null;
  }
}

/** In Teams' sign-in window: hands `result` back to the Teams page that opened it (and closes the window). */
export function finishTeamsSignIn(result: string): void {
  authentication.notifySuccess(result);
}

/** In Teams' sign-in window: ends it without a result. */
export function cancelTeamsSignIn(reason: string): void {
  authentication.notifyFailure(reason);
}

// ---- the tab's configuration page ----

export function onTeamsConfigSave(save: () => Promise<void>): void {
  pages.config.registerOnSaveHandler((event) => {
    save().then(
      () => event.notifySuccess(),
      (e: unknown) => event.notifyFailure(e instanceof Error ? e.message : String(e)),
    );
  });
}

export function setTeamsConfigValid(valid: boolean): void {
  pages.config.setValidityState(valid);
}

export function setTeamsConfig(config: { entityId: string; contentUrl: string; websiteUrl: string; suggestedDisplayName: string }): Promise<void> {
  return pages.config.setConfig(config);
}

// ---- meetings ----

/** Whether this person may share the app to the meeting stage (organisers and presenters). */
export function canShareToStage(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      meeting.getAppContentStageSharingCapabilities((err, result) => resolve(!err && !!result?.doesAppHaveSharePermission));
    } catch {
      resolve(false);
    }
  });
}

/** Shows `url` (one of this app's pages) on the meeting stage, for everyone in the meeting. */
export function shareToStage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      meeting.shareAppContentToStage((err, ok) => resolve(!err && !!ok), url);
    } catch {
      resolve(false);
    }
  });
}
