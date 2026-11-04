// Public API of modules/figma [S2] (#171; docs/integrations/figma.md): "Place from Figma" through
// the operator's Figma app — people's connected Figma accounts (sealed tokens), the files they used,
// and frames rendered by Figma and copied into their uploads (modules/uploads' checks).
import * as repo from './repo';

export { figmaOffered } from './service';

/** For a person's data export: the Figma account they connected and the files they opened, never a token. */
export async function figmaExportOf(userId: string): Promise<{ figma: null | { figmaUser: string; handle: string; email: string | null }; recentFiles: Array<{ key: string; name: string; usedAt: string }> }> {
  const a = await repo.account(userId);
  const files = await repo.recentFiles(userId);
  return {
    figma: a ? { figmaUser: a.figmaUserId, handle: a.handle, email: a.email } : null,
    recentFiles: files.map((f) => ({ key: f.key, name: f.name, usedAt: new Date(f.usedAt).toISOString() })),
  };
}
