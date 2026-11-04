// Settings → Preferences: appearance, language and time zone. Each saves as soon as it changes.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Globe, Search } from 'lucide-react';
import { Button, getLocale, Popover, useToast } from '@ui';
import { browserTimeZone, useAuth } from '../../auth/AuthContext';
import { LanguagePicker } from '../../components/LanguagePicker';
import { ThemeSwitch } from '../../components/ThemeSwitch';
import { SettingsSection } from './Section';
import { errorText } from './SecuritySections';
import { offsetText, searchZones, zoneOption, zoneOptions, type ZoneOption } from './timeZones';
import { t as tr } from './messages';

export function PreferencesSections() {
  return (
    <>
      <SettingsSection id="appearance" title={tr('appearance')} description={tr('appearance.description')}>
        <ThemeSwitch />
      </SettingsSection>
      <SettingsSection id="language" title={tr('language.title')} description={tr('language.short')}>
        <LanguagePicker />
      </SettingsSection>
      <TimeZoneSection />
    </>
  );
}

/** "Saving…" then "Saved" for a moment, announced politely. */
export function SaveStatus({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  return (
    <span className="fr-acct-saved" role="status">
      {state === 'saving' ? tr('saving') : state === 'saved' ? (
        <>
          <Check size={14} aria-hidden /> {tr('saved')}
        </>
      ) : null}
    </span>
  );
}

/** The account's time zone: due-date reminders and dates in emails follow it. Saved on change. */
function TimeZoneSection() {
  const { user, updateProfile } = useAuth();
  const notify = useToast();
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  useEffect(() => {
    if (state !== 'saved') return;
    const timer = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [state]);
  if (!user) return null;
  const detected = browserTimeZone();
  const value = user.timeZone ?? detected ?? 'UTC';
  const save = async (zone: string) => {
    if (zone === value) return;
    setState('saving');
    try {
      await updateProfile({ timeZone: zone });
      setState('saved');
    } catch (err) {
      setState('idle');
      notify(errorText(err, tr('couldNotSaveYourTime')), 'error');
    }
  };
  const locale = getLocale();
  return (
    <SettingsSection id="time-zone" title={tr('timeZone')} description={tr('tz.description')} aside={<SaveStatus state={state} />}>
      <TimeZonePicker value={value} disabled={state === 'saving'} onChange={(z) => void save(z)} />
      {detected && detected !== value ? (
        <div className="fr-acct-tz__device">
          <span className="fr-acct__hint">{tr('tz.deviceDiffers', { zone: zoneOption(detected, locale, new Date()).label })}</span>
          <Button size="sm" variant="secondary" disabled={state === 'saving'} onClick={() => void save(detected)}>{tr('tz.useDevice')}</Button>
        </div>
      ) : null}
    </SettingsSection>
  );
}

const REGIONS = ['America', 'Europe', 'Africa', 'Asia', 'Australia', 'Pacific', 'Atlantic', 'Indian', 'Antarctica', 'Arctic', ''] as const;
type Region = (typeof REGIONS)[number];
const regionOf = (z: ZoneOption): Region => ((REGIONS as readonly string[]).includes(z.region) ? (z.region as Region) : '');
function regionTitle(r: Region): string {
  switch (r) {
    case 'America': return tr('tz.region.america');
    case 'Europe': return tr('tz.region.europe');
    case 'Africa': return tr('tz.region.africa');
    case 'Asia': return tr('tz.region.asia');
    case 'Australia': return tr('tz.region.australia');
    case 'Pacific': return tr('tz.region.pacific');
    case 'Atlantic': return tr('tz.region.atlantic');
    case 'Indian': return tr('tz.region.indian');
    case 'Antarctica': return tr('tz.region.antarctica');
    case 'Arctic': return tr('tz.region.arctic');
    default: return tr('tz.region.other');
  }
}

/** A button showing the zone ("Chicago (UTC−06:00)") that opens a searchable list, by region. */
export function TimeZonePicker({ value, onChange, disabled }: { value: string; onChange: (zone: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const locale = getLocale();
  const current = useMemo(() => zoneOption(value, locale, new Date()), [value, locale]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="fr-acct-tz__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <Globe size={16} aria-hidden />
        <span className="fr-acct-tz__current">
          <span className="fr-acct-tz__label">{current.label}</span>
          {current.generic ? <span className="fr-acct-tz__generic">{current.generic}</span> : null}
        </span>
        <ChevronDown size={16} aria-hidden />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={trigger.current}
        side="bottom"
        align="start"
        offset={4}
        className="fr-acct-tz__pop"
        aria-label={tr('tz.choose')}
      >
        <ZoneList
          value={value}
          onPick={(z) => {
            setOpen(false);
            onChange(z);
          }}
        />
      </Popover>
    </>
  );
}

function ZoneList({ value, onPick }: { value: string; onPick: (zone: string) => void }) {
  const zones = useMemo(() => zoneOptions([value], getLocale()), [value]);
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const found = searchZones(zones, query);
    return REGIONS.map((r) => ({ region: r, zones: found.filter((z) => regionOf(z) === r) })).filter((g) => g.zones.length > 0);
  }, [zones, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.zones), [groups]);
  const [active, setActive] = useState(() => Math.max(0, flat.findIndex((z) => z.id === value)));
  const base = useId();
  const optionId = (i: number) => `${base}-z${i}`;
  const list = useRef<HTMLDivElement>(null);

  // The selected (or first found) zone in view, without moving the page.
  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[id="${optionId(active)}"]`);
    if (el && list.current) {
      const box = list.current;
      if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop - 28;
      else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight;
    }
  }, [active, flat]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const step = (d: number) => {
      e.preventDefault();
      if (flat.length) setActive((i) => (i + d + flat.length) % flat.length);
    };
    if (e.key === 'ArrowDown') step(1);
    else if (e.key === 'ArrowUp') step(-1);
    else if (e.key === 'PageDown') step(8);
    else if (e.key === 'PageUp') step(-8);
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[active]) onPick(flat[active].id);
    }
  };

  let index = -1;
  return (
    <div className="fr-acct-tz__panel">
      <label className="fr-acct-tz__search">
        <Search size={15} aria-hidden />
        <input
          autoFocus
          type="search"
          role="combobox"
          aria-expanded
          aria-controls={`${base}-list`}
          aria-autocomplete="list"
          aria-activedescendant={flat[active] ? optionId(active) : undefined}
          aria-label={tr('tz.search')}
          placeholder={tr('tz.search')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
        />
      </label>
      <div ref={list} id={`${base}-list`} role="listbox" aria-label={tr('tz.choose')} className="fr-acct-tz__list">
        {groups.map((g) => (
          <div key={g.region || 'other'} role="group" aria-labelledby={`${base}-${g.region || 'other'}`}>
            <div id={`${base}-${g.region || 'other'}`} className="fr-acct-tz__region" role="presentation">
              {regionTitle(g.region)}
            </div>
            {g.zones.map((z) => {
              index += 1;
              const i = index;
              return (
                <div
                  key={z.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={z.id === value}
                  className={`fr-acct-tz__option${i === active ? ' is-active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => onPick(z.id)}
                >
                  <span className="fr-acct-tz__city">{z.city}</span>
                  <span className="fr-acct-tz__meta">
                    {z.generic ? <span className="fr-acct-tz__name">{z.generic}</span> : null}
                    <span className="fr-acct-tz__offset">{offsetText(z.offset)}</span>
                  </span>
                  <span className="fr-acct-tz__check">{z.id === value ? <Check size={15} aria-hidden /> : null}</span>
                </div>
              );
            })}
          </div>
        ))}
        {flat.length === 0 ? <p className="fr-acct-tz__empty">{tr('tz.noMatch', { query })}</p> : null}
      </div>
    </div>
  );
}
