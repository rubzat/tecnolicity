import { useSearchParams } from 'react-router-dom';
import type { ProcedureFilter } from '../types';

const FILTER_LABELS: Record<keyof ProcedureFilter, string> = {
  q: 'Búsqueda',
  institucion: 'Institución',
  proveedor: 'Proveedor',
  tipo_contratacion: 'Tipo contratación',
  tipo_procedimiento: 'Tipo procedimiento',
  estatus: 'Estatus',
  ley: 'Ley',
  monto_min: 'Monto mín.',
  monto_max: 'Monto máx.',
  fecha_desde: 'Desde',
  fecha_hasta: 'Hasta',
};

/**
 * Shows active filters as removable chips. Clicking the × clears that single
 * filter from the URL search params.
 */
export function FilterChips({ filter }: { filter: ProcedureFilter }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const entries = (Object.entries(filter) as [keyof ProcedureFilter, ProcedureFilter[keyof ProcedureFilter]][]).filter(
    ([, v]) => v !== undefined && v !== null && v !== '' && !Number.isNaN(v as number),
  );
  if (entries.length === 0) return null;

  const remove = (key: keyof ProcedureFilter) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <span
          key={key}
          className="inline-flex items-center gap-1 rounded-full bg-institucional-50 px-2 py-0.5 text-xs text-institucional-700 ring-1 ring-inset ring-institucional-200"
        >
          <span className="font-medium">{FILTER_LABELS[key]}:</span>
          <span>{String(value)}</span>
          <button
            type="button"
            onClick={() => remove(key)}
            className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-institucional-500 hover:bg-institucional-100 hover:text-institucional-800"
            aria-label={`Quitar filtro ${FILTER_LABELS[key]}`}
          >
            <svg className="h-2.5 w-2.5" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" d="M1 1l6 6M7 1L1 7" />
            </svg>
          </button>
        </span>
      ))}
    </div>
  );
}
