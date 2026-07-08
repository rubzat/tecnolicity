import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import type { ProcedureListItem, SortField, SortOrder } from '../types';
import { formatCurrencyCompact, formatDate } from '../utils/format';
import { Badge, estatusTone, Skeleton, EmptyState } from './ui';
import { ScrollShadowX } from './ScrollShadowX';
import { staggerContainer, staggerItem } from '../lib/motion';

interface ProcedureTableProps {
  items: ProcedureListItem[];
  loading: boolean;
  sort: SortField;
  order: SortOrder;
  onSort: (field: SortField) => void;
}

const COLUMNS: { key: SortField; label: string; className?: string }[] = [
  { key: 'numero_procedimiento', label: 'No. Procedimiento' },
  { key: 'fecha_publicacion', label: 'Publicado' },
  { key: 'tipo_contratacion', label: 'Tipo' },
  { key: 'estatus', label: 'Estatus' },
  { key: 'importe_total', label: 'Monto total', className: 'text-right' },
];

/** Sortable results table. Each row is a link to the detail page. */
export function ProcedureTable({ items, loading, sort, order, onSort }: ProcedureTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <ScrollShadowX>
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {COLUMNS.map((col) => {
                const active = sort === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={clsx(
                      'px-4 py-3 text-left font-medium text-slate-600',
                      col.className,
                      col.key === 'importe_total' && 'text-right',
                    )}
                  >
                        <button
                          type="button"
                          onClick={() => onSort(col.key)}
                          className={clsx(
                            'inline-flex items-center gap-1 hover:text-slate-900',
                            col.key === 'importe_total' && 'flex-row-reverse',
                            active && 'text-institucional',
                          )}
                        >
                          {col.label}
                          <SortIcon active={active} order={order} />
                        </button>
                  </th>
                );
              })}
              <th scope="col" className="px-4 py-3 text-left font-medium text-slate-600">
                Institución
              </th>
            </tr>
          </thead>
          <motion.tbody
            key={items[0]?.id ?? 'empty'}
            className="divide-y divide-slate-100"
            initial="hidden"
            animate="visible"
            variants={staggerContainer}
          >
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className="px-4 py-3">
                      <Skeleton className="h-4 w-20" />
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-32" />
                  </td>
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1}>
                  <EmptyState
                    title="No se encontraron procedimientos"
                    hint="Prueba ajustar o limpiar los filtros para ver más resultados."
                  />
                </td>
              </tr>
            ) : (
              items.map((p) => (
                <motion.tr
                  key={p.id}
                  variants={staggerItem}
                  className="cursor-pointer hover:bg-institucional-50/40"
                >
                  <td className="px-4 py-3 align-top">
                    <Link
                      to={`/procedimientos/${encodeURIComponent(p.numero_procedimiento)}`}
                      className="font-mono font-medium text-institucional hover:underline"
                    >
                      {p.numero_procedimiento}
                    </Link>
                    {p.descripcion && (
                      <div className="mt-0.5 line-clamp-2 max-w-md text-xs text-slate-500">{p.descripcion}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-slate-700">{formatDate(p.fecha_publicacion)}</td>
                  <td className="px-4 py-3 align-top text-slate-700">{p.tipo_contratacion ?? '—'}</td>
                  <td className="px-4 py-3 align-top">
                    <Badge tone={estatusTone(p.estatus)}>{p.estatus ?? '—'}</Badge>
                  </td>
                  <td className="px-4 py-3 align-top text-right font-mono text-xs text-slate-900">
                    {formatCurrencyCompact(p.importe_total)}
                  </td>
                  <td className="max-w-[220px] px-4 py-3 align-top">
                    <div className="truncate text-slate-900" title={p.institucion.nombre}>
                      {p.institucion.nombre}
                    </div>
                    <div className="truncate text-xs text-slate-500" title={p.unidad_compradora.nombre}>
                      {p.institucion.siglas ? `${p.institucion.siglas} · ` : ''}
                      {p.unidad_compradora.nombre}
                    </div>
                  </td>
                </motion.tr>
              ))
            )}
          </motion.tbody>
        </table>
      </ScrollShadowX>
    </div>
  );
}

function SortIcon({ active, order }: { active: boolean; order: SortOrder }) {
  return (
    <svg
      className={clsx('h-3.5 w-3.5 transition', active ? 'opacity-100' : 'opacity-40')}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      {order === 'asc' ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 3l3 4H3l3-4z" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l3-4H3l3 4z" />
      )}
    </svg>
  );
}
