import { useEffect, useRef, useState } from 'react';
import { ImageUp, Ratio, Type } from 'lucide-react';
import type { ImageElement } from '@freero/shared';
import { defineFormat, type Editor } from '@engine';
import { Button, IconButton, Popover, TextArea } from '@ui';
import { naturalSizeOf, pickImageFiles } from './lib/files';
import { storeImage } from './lib/insert';
import { naturalAspectBox, replacementBox } from './lib/layout';

/** Aspect differs from the natural one by more than half a pixel over the box. */
const offAspect = (el: ImageElement) =>
  el.naturalW > 0 && el.naturalH > 0 && Math.abs(el.h - (el.w * el.naturalH) / el.naturalW) > 0.5;

function ReplaceControl({ editor, image }: { editor: Editor; image: ImageElement }) {
  const [busy, setBusy] = useState(false);
  const replace = async () => {
    const [file] = await pickImageFiles(false);
    if (!file) return;
    setBusy(true);
    try {
      const local = URL.createObjectURL(file);
      const size = await naturalSizeOf(local).finally(() => URL.revokeObjectURL(local));
      if (!size) return editor.host.notify("That file isn't an image Freero can read.", 'error');
      const stored = await storeImage(editor, file);
      if ('error' in stored) return editor.host.notify("Couldn't upload that image. Try again when you're back online.", 'error');
      const cur = editor.getElement<ImageElement>(image.id);
      if (!cur) return;
      // Same footprint and center, the new picture's proportions.
      editor.update<ImageElement>(cur.id, {
        src: stored.url,
        naturalW: size.w,
        naturalH: size.h,
        ...replacementBox(cur, size.w, size.h),
      });
    } finally {
      setBusy(false);
    }
  };
  return <IconButton icon={ImageUp} label={busy ? 'Uploading…' : 'Replace image'} size={32} disabled={busy} onClick={() => void replace()} />;
}

function AltControl({ editor, image }: { editor: Editor; image: ImageElement }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const ref = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // Focus once the popover is placed (it mounts hidden while it measures itself).
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);
  const save = () => {
    const alt = value.trim();
    if (alt !== (image.alt ?? '')) editor.update<ImageElement>(image.id, { alt });
    setOpen(false);
  };
  return (
    <>
      <IconButton
        ref={ref}
        icon={Type}
        label="Alt text"
        size={32}
        active={open || !!image.alt}
        onClick={() => {
          setValue(image.alt ?? '');
          setOpen((o) => !o);
        }}
      />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} width={300} aria-label="Alt text">
        <form
          className="fr-image-alt"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <TextArea
            ref={field}
            label="Alt text"
            hint="Describe the image for people using screen readers and for search."
            value={value}
            rows={3}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                save();
              }
            }}
          />
          <div className="fr-image-alt__row">
            <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit">
              Save
            </Button>
          </div>
        </form>
      </Popover>
    </>
  );
}

export default defineFormat({
  id: 'image.format',
  order: 20,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === 'image'),
  Component: ({ editor, selection }) => {
    const images = selection as ImageElement[];
    const skewed = images.filter(offAspect);
    return (
      <>
        {images.length === 1 && <ReplaceControl editor={editor} image={images[0]} />}
        {images.length === 1 && <AltControl editor={editor} image={images[0]} />}
        <IconButton
          icon={Ratio}
          label="Reset to natural aspect"
          size={32}
          disabled={!skewed.length}
          onClick={() => editor.updateMany(skewed.map((el) => ({ id: el.id, patch: naturalAspectBox(el, el.naturalW, el.naturalH) })))}
        />
      </>
    );
  },
});
