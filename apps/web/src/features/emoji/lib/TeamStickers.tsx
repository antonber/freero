// The picker's "Team stickers" (#138): the board's workspace's own sticker sets, through
// `Host.stickers`. Members make sets and upload PNG / SVG / WebP / GIF images into them (the
// server checks every image like any upload); a set's creator or a workspace admin removes it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Plus, Trash2, X } from 'lucide-react';
import type { Sticker, StickersResponse } from '@freero/shared';
import type { Editor } from '@engine';
import { Button, IconButton, Input, Spinner } from '@ui';
import { customValue, STICKER_ACCEPT, stickerNameOf } from './custom';

export interface TeamStickersState {
  data: StickersResponse | null;
  reload(): void;
}

/** The team's sets, loaded once the picker opens (nothing without `Host.stickers`). */
export function useTeamStickers(editor: Editor): TeamStickersState {
  const host = editor.host.stickers;
  const [data, setData] = useState<StickersResponse | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!host) return;
    let live = true;
    host.list().then(
      (d) => live && setData(d),
      () => live && setData({ sets: [], canCreate: false }),
    );
    return () => {
      live = false;
    };
  }, [host, tick]);
  return { data, reload: useCallback(() => setTick((t) => t + 1), []) };
}

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'That didn’t work. Try again.');

function Grid({
  stickers,
  current,
  onPick,
  onRemove,
}: {
  stickers: Sticker[];
  current: string;
  onPick(value: string, name: string): void;
  onRemove?(sticker: Sticker): void;
}) {
  return (
    <>
      {stickers.map((s) => (
        <span key={s.id} className="fr-emoji-team__cell">
          <button
            type="button"
            className="fr-emoji-picker__item"
            aria-pressed={current === customValue(s.url)}
            aria-label={s.name}
            title={s.name}
            onClick={() => onPick(customValue(s.url), s.name)}
          >
            <img className="fr-emoji__img" src={s.url} alt="" draggable={false} />
          </button>
          {onRemove && (
            <button type="button" className="fr-emoji-team__remove" aria-label={`Remove ${s.name}`} title={`Remove ${s.name}`} onClick={() => onRemove(s)}>
              <X size={10} strokeWidth={3} aria-hidden />
            </button>
          )}
        </span>
      ))}
    </>
  );
}

function GridBox(props: Parameters<typeof Grid>[0]) {
  return (
    <div className="fr-emoji-picker__stamps">
      <Grid {...props} />
    </div>
  );
}

export function TeamStickers({
  editor,
  team,
  current,
  onPick,
}: {
  editor: Editor;
  team: TeamStickersState;
  current: string;
  onPick(value: string, name: string): void;
}) {
  const host = editor.host.stickers;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);
  if (!host) return null;
  const { data } = team;
  if (!data) return <Spinner size={16} />;
  if (!data.sets.length && !data.canCreate) return null;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      editor.host.notify(message(e), 'error');
    } finally {
      setBusy(null);
      team.reload();
    }
  };
  const create = () => {
    const n = name.trim();
    if (!n) return;
    setNaming(false);
    setName('');
    void run('new', () => host.createSet(n));
  };
  const upload = (files: FileList | null) => {
    const setId = target.current;
    if (!setId || !files?.length) return;
    const list = [...files];
    void run(setId, async () => {
      // One by one, so a refused file (too large, not an image) says which and the rest still land.
      for (const f of list) {
        try {
          await host.add(setId, f, stickerNameOf(f.name));
        } catch (e) {
          editor.host.notify(`${f.name}: ${message(e)}`, 'error');
        }
      }
    });
  };

  return (
    <section className="fr-emoji-team" aria-label="Team stickers">
      <input
        ref={file}
        type="file"
        accept={STICKER_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          upload(e.target.files);
          e.target.value = '';
        }}
      />
      {data.sets.map((set) => (
        <div key={set.id} className="fr-emoji-team__set">
          <div className="fr-emoji-team__head">
            <span className="fr-emoji-picker__section" title={set.createdBy ? `Made by ${set.createdBy}` : undefined}>
              {set.name} <span className="fr-emoji-team__kind">· team</span>
            </span>
            {busy === set.id && <Spinner size={12} />}
            {set.canManage &&
              (confirming === set.id ? (
                <Button size="sm" variant="danger" onClick={() => (setConfirming(null), void run(set.id, () => host.removeSet(set.id)))}>
                  Remove set
                </Button>
              ) : (
                <IconButton icon={Trash2} label={`Remove the ${set.name} set for everyone`} size={32} tooltip={false} onClick={() => setConfirming(set.id)} />
              ))}
          </div>
          <div className="fr-emoji-picker__stamps">
            <Grid
              stickers={set.stickers}
              current={current}
              onPick={onPick}
              onRemove={set.canManage ? (s) => void run(set.id, () => host.remove(set.id, s.id)) : undefined}
            />
            {set.canAdd && (
              <button
                type="button"
                className="fr-emoji-picker__item fr-emoji-team__add"
                aria-label={`Add images to ${set.name}`}
                title="Add PNG, SVG, WebP or GIF images"
                disabled={busy === set.id}
                onClick={() => {
                  target.current = set.id;
                  file.current?.click();
                }}
              >
                <ImagePlus size={18} aria-hidden />
              </button>
            )}
          </div>
        </div>
      ))}
      {data.canCreate &&
        (naming ? (
          <Input
            size="sm"
            autoFocus
            placeholder="Name the set, then Enter"
            aria-label="New sticker set name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create();
              if (e.key === 'Escape') setNaming(false);
            }}
            onBlur={() => !name.trim() && setNaming(false)}
          />
        ) : (
          <Button size="sm" variant="ghost" icon={Plus} loading={busy === 'new'} onClick={() => setNaming(true)}>
            {data.sets.length ? 'New sticker set' : 'Make a sticker set for your team'}
          </Button>
        ))}
    </section>
  );
}

TeamStickers.Grid = GridBox;
