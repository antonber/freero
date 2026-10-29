// A `.freero` file on its way to the restore dialog (KAI-137, KAI-218): dropped on a board (Host.
// openBackup) or opened with the installed app (the manifest's file_handlers, `launchQueue`). The
// dashboard takes it when it opens with `?restore=1`. Files can't travel in a URL, and this one
// never needs to outlive the tab.
let pending: File | null = null;

export function holdBackup(file: File): void {
  pending = file;
}

/** The waiting file, once (null when there is none). */
export function takeBackup(): File | null {
  const f = pending;
  pending = null;
  return f;
}

export const RESTORE_PATH = '/app?restore=1';

interface LaunchParams {
  files?: ReadonlyArray<{ kind?: string; getFile(): Promise<File> }>;
}
interface LaunchQueue {
  setConsumer(fn: (params: LaunchParams) => void): void;
}

/**
 * Files the installed app was opened with (Chromium's File Handling API). Calls `onFile` with the
 * first `.freero` among them; does nothing in browsers without it.
 */
export function onLaunchedBackup(onFile: (file: File) => void): void {
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  queue?.setConsumer((params) => {
    void (async () => {
      for (const handle of params.files ?? []) {
        const file = await handle.getFile().catch(() => null);
        if (file && file.name.toLowerCase().endsWith('.freero')) return onFile(file);
      }
    })();
  });
}
