// "Convert to kanban" (step 3e): pick the column whose values become the kanban's columns and the
// one that titles the cards; every other column becomes a field (or the card's own description,
// assignee, dates, estimate or link when it is named so). The kanban replaces the table where it
// stood, in one undo step.
import { useEffect, useMemo, useState } from 'react';
import type { TableElement } from '@freero/shared';
import { definePanel, useCollection, useElement, type PanelProps } from '@engine';
import { Button, Modal, Select } from '@ui';
import { CELLS, cellText } from './lib/cells';
import { peopleLookup } from './lib/actions';
import type { PeopleLookup } from './lib/columns';
import { CONVERT_DIALOG, columnNames, convertToKanban, defaultChoice, tableToKanbanRows, type ColumnFate, type ConvertChoice } from './lib/convert';
import { t } from './messages';
import './table.css';

const TYPE_NAMES: Record<string, string> = {
  select: 'single select',
  multiselect: 'multi-select',
  person: 'person',
  date: 'date',
  number: 'number',
  text: 'text',
  url: 'link',
  checkbox: 'checkbox',
};

const fateText = (f: ColumnFate) => {
  switch (f.as) {
    case 'field':
      return `${TYPE_NAMES[f.type ?? 'text']} field`;
    case 'description':
      return 'card description';
    case 'assignee':
      return 'card assignee';
    case 'due':
      return 'card due date';
    case 'start':
      return 'card start date';
    case 'estimate':
      return 'card estimate';
    case 'link':
      return 'card link';
    default:
      return '';
  }
};

function ConvertDialog({ editor, props }: PanelProps) {
  const id = typeof props?.id === 'string' ? props.id : '';
  const close = () => editor.closePanel(CONVERT_DIALOG);
  const el = useElement<TableElement>(id);
  const cells = useCollection<string>(CELLS);
  const [people, setPeople] = useState<PeopleLookup | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void peopleLookup(editor).then((p) => live && setPeople(p));
    return () => {
      live = false;
    };
  }, [editor]);

  const get = useMemo(() => {
    const coll = new Map(cells);
    return (rowId: string, colId: string) => (el ? cellText(coll, el.id, rowId, colId) : '');
  }, [cells, el]);
  const table = el?.type === 'table' ? el : null;
  const [choice, setChoice] = useState<ConvertChoice | null>(() => (table ? defaultChoice(table, get) : null));
  const plan = useMemo(() => (table && choice ? tableToKanbanRows(table, get, choice, people) : null), [table, get, choice, people]);

  if (!table || !choice) {
    return (
      <Modal open onClose={close} title={t('convertToKanban2')} footer={<Button onClick={close}>{t('close')}</Button>}>
        <p>{t('aTableNeedsAtLeast3')}</p>
      </Modal>
    );
  }
  const names = columnNames(table, get);
  const options = table.cols.map((c, i) => ({ value: c.id, label: names[i] }));
  const error = plan && 'error' in plan ? plan.error : null;
  const rows = plan && 'rows' in plan ? plan.rows : null;

  const run = () => {
    const kid = convertToKanban(editor, table.id, choice, people);
    if (!kid) return;
    editor.host.notify(t('convertedToAKanbanWith', { value: rows?.cards.length ?? 0 }), 'success');
    close();
  };

  return (
    <Modal
      open
      onClose={close}
      title={t('convertToKanban2')}
      description="Each row becomes a card. The kanban takes the table’s place; undo brings the table back."
      width={520}
      footer={
        <>
          <Button onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" disabled={!rows} onClick={run}>{t('convert')}</Button>
        </>
      }
    >
      <div className="fr-table-convert">
        <label className="fr-table-convert__pick">
          <span>{t('columnsFrom')}</span>
          <Select<string>
            aria-label={t('tableColumnTheKanbanS')}
            size="sm"
            options={options}
            value={choice.columnsFrom}
            onChange={(v) => setChoice((c) => (c ? { columnsFrom: v, titleFrom: v === c.titleFrom ? (table.cols.find((x) => x.id !== v)?.id ?? c.titleFrom) : c.titleFrom } : c))}
          />
        </label>
        <label className="fr-table-convert__pick">
          <span>{t('cardTitlesFrom')}</span>
          <Select<string>
            aria-label={t('tableColumnTheCardTitles')}
            size="sm"
            options={options.filter((o) => o.value !== choice.columnsFrom)}
            value={choice.titleFrom}
            onChange={(v) => setChoice((c) => (c ? { ...c, titleFrom: v } : c))}
          />
        </label>
        {rows && plan && 'fates' in plan ? (
          <>
            <p className="fr-table-convert__summary">{t('nCardsInNColumns', { length: rows.cards.length, length2: rows.columns.length, join: rows.columns.map((c) => c.title).join(', ') })}</p>
            {plan.fates.some((f) => f.as !== 'columns' && f.as !== 'title') ? (
              <ul className="fr-table-convert__fates" aria-label={t('whatTheOtherColumnsBecome')}>
                {plan.fates
                  .filter((f) => f.as !== 'columns' && f.as !== 'title')
                  .map((f) => (
                    <li key={f.colId}>
                      <span>{f.name}</span>
                      <span>{fateText(f)}</span>
                    </li>
                  ))}
              </ul>
            ) : null}
          </>
        ) : null}
        {error ? (
          <p className="fr-table-convert__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export default definePanel({ id: CONVERT_DIALOG, slot: 'dialog', order: 60, Component: ConvertDialog });
