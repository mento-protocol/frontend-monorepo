"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type TreeRow<T> = T & {
  id: string;
  children?: TreeRow<T>[];
  // If true, the row renders without a toggle button and its children are
  // always visible. Useful for "breakdown" rows that should stay unfolded.
  alwaysExpanded?: boolean;
};

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: TreeRow<T>, depth: number) => ReactNode;
  align?: "left" | "right";
  width?: string;
  // When > 1, the next (colSpan - 1) columns are skipped for this row.
  // Lets a row merge its leading cells (e.g. a "Total" row that spans the
  // first three descriptive columns before its numeric cells).
  colSpan?: (row: TreeRow<T>, depth: number) => number;
  className?: string;
};

export type TreeTableProps<T> = {
  rows: TreeRow<T>[];
  columns: Column<T>[];
  defaultOpenDepth?: number;
  indentPerLevel?: number;
  rowClassName?: (row: TreeRow<T>, depth: number) => string | undefined;
  onRowMouseEnter?: (row: TreeRow<T>, depth: number) => void;
  onRowMouseLeave?: (row: TreeRow<T>, depth: number) => void;
  minWidth?: string;
  className?: string;
};

type OpenState = {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
};

const OpenContext = createContext<OpenState | null>(null);

function useOpen() {
  const ctx = useContext(OpenContext);
  if (!ctx)
    throw new Error("TreeTable rows must be rendered inside <TreeTable />");
  return ctx;
}

export function TreeTable<T>({
  rows,
  columns,
  defaultOpenDepth = 0,
  indentPerLevel = 20,
  rowClassName,
  onRowMouseEnter,
  onRowMouseLeave,
  minWidth = "800px",
  className,
}: TreeTableProps<T>) {
  const initialOpen = useMemo(
    () => seedOpenIds(rows, defaultOpenDepth),
    [rows, defaultOpenDepth],
  );
  const [open, setOpen] = useState<Set<string>>(initialOpen);

  const openState: OpenState = {
    isOpen: (id) => open.has(id),
    toggle: (id) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
  };

  return (
    <div className={`overflow-x-auto ${className ?? ""}`}>
      <table className="text-lg w-full" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-muted-foreground">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 font-medium ${
                  col.align === "right" ? "text-right" : ""
                } ${col.className ?? ""}`}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <OpenContext.Provider value={openState}>
            {rows.map((row) => (
              <TreeTableRow
                key={row.id}
                row={row}
                depth={0}
                columns={columns}
                indentPerLevel={indentPerLevel}
                rowClassName={rowClassName}
                onRowMouseEnter={onRowMouseEnter}
                onRowMouseLeave={onRowMouseLeave}
              />
            ))}
          </OpenContext.Provider>
        </tbody>
      </table>
    </div>
  );
}

function TreeTableRow<T>({
  row,
  depth,
  columns,
  indentPerLevel,
  rowClassName,
  onRowMouseEnter,
  onRowMouseLeave,
}: {
  row: TreeRow<T>;
  depth: number;
  columns: Column<T>[];
  indentPerLevel: number;
  rowClassName?: (row: TreeRow<T>, depth: number) => string | undefined;
  onRowMouseEnter?: (row: TreeRow<T>, depth: number) => void;
  onRowMouseLeave?: (row: TreeRow<T>, depth: number) => void;
}) {
  const { isOpen, toggle } = useOpen();
  const hasChildren = !!row.children?.length;
  const expandable = hasChildren && !row.alwaysExpanded;
  const open = row.alwaysExpanded || (expandable && isOpen(row.id));

  const cells: ReactNode[] = [];
  let i = 0;
  while (i < columns.length) {
    const col = columns[i]!;
    const span = col.colSpan ? col.colSpan(row, depth) : 1;
    const isFirst = i === 0;
    cells.push(
      <td
        key={col.key}
        colSpan={span > 1 ? span : undefined}
        className={`px-4 py-3 tabular-nums ${
          col.align === "right" ? "text-right" : ""
        } ${col.className ?? ""}`}
        style={
          isFirst && depth > 0
            ? { paddingLeft: 16 + depth * indentPerLevel }
            : undefined
        }
      >
        {isFirst ? (
          <span className="gap-2 inline-flex items-center">
            {expandable ? (
              <button
                type="button"
                onClick={() => toggle(row.id)}
                aria-expanded={open}
                aria-label={open ? "Collapse" : "Expand"}
                className="size-5 -ml-1 shrink-0 cursor-pointer inline-flex items-center justify-center rounded text-xs text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
              >
                <span
                  className={`transition-transform ${open ? "rotate-90" : ""}`}
                  aria-hidden
                >
                  ▶
                </span>
              </button>
            ) : hasChildren ? null : (
              <span className="size-5 -ml-1 shrink-0" aria-hidden />
            )}
            {col.cell(row, depth)}
          </span>
        ) : (
          col.cell(row, depth)
        )}
      </td>,
    );
    i += span;
  }

  return (
    <>
      <tr
        className={`border-b border-[var(--border)] ${
          expandable
            ? "cursor-pointer transition-colors hover:bg-accent"
            : ""
        } ${rowClassName?.(row, depth) ?? ""}`}
        onClick={
          expandable
            ? (e) => {
                // Skip toggle if the click originated on an interactive
                // descendant (chevron button, tooltip trigger, link, etc.)
                // so those handle their own behavior without double-firing.
                const target = e.target as HTMLElement;
                if (
                  target.closest(
                    'button, a, input, select, textarea, [role="button"]',
                  )
                ) {
                  return;
                }
                toggle(row.id);
              }
            : undefined
        }
        onMouseEnter={
          onRowMouseEnter ? () => onRowMouseEnter(row, depth) : undefined
        }
        onMouseLeave={
          onRowMouseLeave ? () => onRowMouseLeave(row, depth) : undefined
        }
      >
        {cells}
      </tr>
      {open &&
        row.children!.map((child) => (
          <TreeTableRow
            key={child.id}
            row={child}
            depth={depth + 1}
            columns={columns}
            indentPerLevel={indentPerLevel}
            rowClassName={rowClassName}
            onRowMouseEnter={onRowMouseEnter}
            onRowMouseLeave={onRowMouseLeave}
          />
        ))}
    </>
  );
}

function seedOpenIds<T>(
  rows: TreeRow<T>[],
  maxDepth: number,
  depth = 0,
  acc: Set<string> = new Set(),
): Set<string> {
  for (const row of rows) {
    if (row.children?.length && depth < maxDepth) {
      acc.add(row.id);
    }
    if (row.children?.length) {
      seedOpenIds(row.children, maxDepth, depth + 1, acc);
    }
  }
  return acc;
}
