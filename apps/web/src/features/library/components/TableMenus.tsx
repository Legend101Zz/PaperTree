/**
 * TableMenus: the Table view's two menus (#197, frame 01d). Columns hides and shows columns (the
 * Title always stays; the choice is stored in this browser by `useTableView`). Filter narrows the rows
 * by topic, a year range and a pages range; its button says what is on.
 */
'use client';

import { Button, CONTROL_MIN_HEIGHT_PX, type ControlSize } from '@papertree/ui';
import { ListFilter } from 'lucide-react';
import { useId } from 'react';

import { TOUCH_TARGET } from '@/components/library/primitives';

import { filterSummary, NO_FILTER, UNSHELVED, type Range, type TableFilter } from '../model/table';
import { TABLE_COLUMNS, type TableColumn } from '../model/tableSort';
import { PopoverMenu } from './PopoverMenu';

import type { ShelfTopic } from '../model/shelf';
import type { ReactNode } from 'react';

/** A menu button drawn as the secondary `Button`, with its panel (the header's `PopoverMenu`). */
function Menu({
  label,
  size,
  children,
}: {
  readonly label: string;
  readonly size: ControlSize;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <PopoverMenu
      label={label}
      worded
      face={
        <>
          <span className="pt-button__icon" aria-hidden="true">
            <ListFilter size={18} strokeWidth={1.5} />
          </span>
          <span className="pt-button__label">{label}</span>
        </>
      }
      buttonClassName={`pt-button pt-button--secondary pt-button--${size} ${size === 'touch' ? TOUCH_TARGET : ''}`}
      buttonStyle={{ minHeight: CONTROL_MIN_HEIGHT_PX[size] }}
      panelClassName="pt-tmenu"
    >
      {children}
    </PopoverMenu>
  );
}

/** Props for `ColumnsMenu`. */
export interface ColumnsMenuProps {
  readonly hidden: ReadonlySet<TableColumn>;
  readonly onShown: (column: TableColumn, shown: boolean) => void;
  readonly size: ControlSize;
}

/**
 * Columns: a checkbox per column but Title.
 *
 * @example
 * <ColumnsMenu hidden={table.hidden} onShown={table.setShown} size="md" />
 */
export function ColumnsMenu({ hidden, onShown, size }: ColumnsMenuProps): ReactNode {
  return (
    <Menu label="Columns" size={size}>
      {TABLE_COLUMNS.filter((c) => c.id !== 'title').map((column) => (
        <label key={column.id} className="pt-tmenu__check">
          <input
            type="checkbox"
            checked={!hidden.has(column.id)}
            onChange={(event) => onShown(column.id, event.target.checked)}
          />
          {column.label}
        </label>
      ))}
    </Menu>
  );
}

const toNumber = (text: string): number | null => {
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) ? value : null;
};

/** "From [ ] to [ ]" for one range. */
function RangeFields({
  legend,
  range,
  onChange,
}: {
  readonly legend: string;
  readonly range: Range;
  readonly onChange: (range: Range) => void;
}): ReactNode {
  return (
    <fieldset className="pt-tmenu__range">
      <legend>{legend}</legend>
      {(['from', 'to'] as const).map((end) => (
        <label key={end}>
          {end === 'from' ? 'From' : 'to'}
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={range[end] ?? ''}
            onChange={(event) => onChange({ ...range, [end]: toNumber(event.target.value) })}
          />
        </label>
      ))}
    </fieldset>
  );
}

/** Props for `FilterMenu`. */
export interface FilterMenuProps {
  readonly filter: TableFilter;
  readonly onFilter: (filter: TableFilter) => void;
  /** The library's topics, by name; Unshelved is offered when some paper has none. */
  readonly topics: readonly ShelfTopic[];
  readonly unshelved: boolean;
  readonly size: ControlSize;
}

/**
 * Filter: topic, year, pages. The button reads "Filter: topic, year, pages" until something is
 * on, then what is ("Filter: Vision & detection · 2015–2018").
 *
 * @example
 * <FilterMenu filter={table.filter} onFilter={table.setFilter} topics={topics} unshelved size="md" />
 */
export function FilterMenu({
  filter,
  onFilter,
  topics,
  unshelved,
  size,
}: FilterMenuProps): ReactNode {
  const topicId = useId();
  const name = topics.find((t) => t.id === filter.topic)?.name ?? null;
  const summary = filterSummary(filter, name);
  return (
    <Menu label={`Filter: ${summary ?? 'topic, year, pages'}`} size={size}>
      <label className="pt-tmenu__field" htmlFor={topicId}>
        Topic
        <select
          id={topicId}
          value={filter.topic ?? ''}
          onChange={(event) => onFilter({ ...filter, topic: event.target.value || null })}
        >
          <option value="">Any topic</option>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name}
            </option>
          ))}
          {unshelved ? <option value={UNSHELVED}>Unshelved</option> : null}
        </select>
      </label>
      <RangeFields
        legend="Year"
        range={filter.year}
        onChange={(year) => onFilter({ ...filter, year })}
      />
      <RangeFields
        legend="Pages"
        range={filter.pages}
        onChange={(pages) => onFilter({ ...filter, pages })}
      />
      <Button size={size} disabled={summary === null} onClick={() => onFilter(NO_FILTER)}>
        Clear the filter
      </Button>
    </Menu>
  );
}
