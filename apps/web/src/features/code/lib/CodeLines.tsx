import { memo } from 'react';
import type { Run } from './tokens';

/**
 * Highlighted lines as React text: each run is a <span> whose CHILD is the text, so React escapes
 * it — a block containing `<script>` shows those characters and nothing runs. Class names come
 * only from the highlighter's scope names (filtered in highlighter.ts), never from board content.
 */
export const CodeLines = memo(function CodeLines({ lines }: { lines: Run[][] }) {
  return (
    <>
      {lines.map((runs, i) => (
        <div key={i} className="fr-code__line">
          {runs.length ? (
            runs.map((r, j) => (
              <span key={j} className={r.scopes.length ? r.scopes.join(' ') : undefined}>
                {r.text}
              </span>
            ))
          ) : (
            // An empty line still takes its height.
            '​'
          )}
        </div>
      ))}
    </>
  );
});
