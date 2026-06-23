import { type ReactNode } from 'react';
import clsx from 'clsx';
import { Button } from './ui';
import type { ProcedureFilter } from '../types';

/**
 * Hardcoded option lists for the dropdowns. Values are the most common ones
 * observed in Compras MX data; the underlying columns are free-text so the
 * API also accepts arbitrary values (e.g. typed via the search box).
 */
const TIPO_CONTRATACION_OPTS = [
  'Adquisiciones',
  'Servicios',
  'Obra Pública',
  'Arrendamientos',
  'Servicios Relacionados con la OP',
];

const TIPO_PROCEDIMIENTO_OPTS = [
  'Licitación Pública',
  'Invitación a Cuando Menos Tres Personas',
  'Adjudicación Directa',
  'Convenio',
  'Proyecto de Convocatoria',
];

const ESTATUS_OPTS = [
  'Adjudicado',
  'En etapa de fallo',
  'Cancelado',
  'Desierto',
  'Publicado',
  'En evaluación',
];

const LEY_OPTS = ['Adquisiciones, Arrendamientos y Servicios del Sector Público', 'Obras Públicas y Servicios Relacionados con las Mismas'];

interface FilterSidebarProps {
  value: ProcedureFilter;
  onChange: (patch: ProcedureFilter) => void;
  onReset: () => void;
  /** Mobile open state; controlled by parent. */
  openOnMobile?: boolean;
  onCloseMobile?: () => void;
}

/**
 * Vertical filter panel. On desktop it's a sticky sidebar; on mobile it's
 * a collapsible drawer toggled from the page header.
 */
export function FilterSidebar({ value, onChange, onReset, openOnMobile = false, onCloseMobile }: FilterSidebarProps) {
  return (
    <aside
      className={clsx(
        // Mobile: hidden by default, slides in when openOnMobile
        'lg:sticky lg:top-6 lg:block lg:w-72 lg:flex-shrink-0',
        openOnMobile ? 'block' : 'hidden lg:block',
      )}
      aria-label="Filtros"
    >
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Filtros</h2>
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="text-slate-400 hover:text-slate-700 lg:hidden"
              aria-label="Cerrar filtros"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="space-y-4">
          <Field label="Búsqueda">
            <input
              type="search"
              value={value.q ?? ''}
              onChange={(e) => onChange({ q: e.target.value })}
              placeholder="Palabra en título o descripción"
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
            />
          </Field>

          <Field label="Institución">
            <input
              type="text"
              value={value.institucion ?? ''}
              onChange={(e) => onChange({ institucion: e.target.value })}
              placeholder="Nombre o parte"
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
            />
          </Field>

          <Field label="Proveedor">
            <input
              type="text"
              value={value.proveedor ?? ''}
              onChange={(e) => onChange({ proveedor: e.target.value })}
              placeholder="RFC o nombre"
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
            />
          </Field>

          <Field label="Tipo de contratación">
            <Select
              value={value.tipo_contratacion ?? ''}
              onChange={(v) => onChange({ tipo_contratacion: v })}
              options={TIPO_CONTRATACION_OPTS}
            />
          </Field>

          <Field label="Tipo de procedimiento">
            <Select
              value={value.tipo_procedimiento ?? ''}
              onChange={(v) => onChange({ tipo_procedimiento: v })}
              options={TIPO_PROCEDIMIENTO_OPTS}
            />
          </Field>

          <Field label="Estatus">
            <Select value={value.estatus ?? ''} onChange={(v) => onChange({ estatus: v })} options={ESTATUS_OPTS} />
          </Field>

          <Field label="Ley">
            <Select value={value.ley ?? ''} onChange={(v) => onChange({ ley: v })} options={LEY_OPTS} />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Monto mín.">
              <input
                type="number"
                min={0}
                value={value.monto_min ?? ''}
                onChange={(e) => onChange({ monto_min: e.target.value === '' ? undefined : Number(e.target.value) })}
                placeholder="0"
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
              />
            </Field>
            <Field label="Monto máx.">
              <input
                type="number"
                min={0}
                value={value.monto_max ?? ''}
                onChange={(e) => onChange({ monto_max: e.target.value === '' ? undefined : Number(e.target.value) })}
                placeholder="∞"
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Desde">
              <input
                type="date"
                value={value.fecha_desde ?? ''}
                onChange={(e) => onChange({ fecha_desde: e.target.value || undefined })}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
              />
            </Field>
            <Field label="Hasta">
              <input
                type="date"
                value={value.fecha_hasta ?? ''}
                onChange={(e) => onChange({ fecha_hasta: e.target.value || undefined })}
                className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
              />
            </Field>
          </div>

          <Button type="button" variant="secondary" size="sm" className="w-full" onClick={onReset}>
            Limpiar filtros
          </Button>
        </div>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-institucional focus:outline-none focus:ring-1 focus:ring-institucional"
    >
      <option value="">— Cualquiera —</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}
