import clsx from 'clsx';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}

/** Numbered pagination with prev/next. Renders at most 7 visible buttons. */
export function Pagination({ page, totalPages, total, onPage }: PaginationProps) {
  if (total === 0) return null;
  const pages = computePageWindow(page, totalPages);
  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-xs text-slate-500">
        Página <span className="font-medium text-slate-700">{page}</span> de {Math.max(totalPages, 1)} ·{' '}
        {total.toLocaleString('es-MX')} resultados
      </p>
      <nav className="flex items-center gap-1" aria-label="Paginación">
        <PageButton disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Anterior">
          ‹
        </PageButton>
        {pages.map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} className="px-2 text-slate-400">
              …
            </span>
          ) : (
            <PageButton key={p} active={p === page} onClick={() => onPage(p)}>
              {p}
            </PageButton>
          ),
        )}
        <PageButton disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Siguiente">
          ›
        </PageButton>
      </nav>
    </div>
  );
}

function PageButton({
  children,
  active,
  disabled,
  onClick,
  ...rest
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'min-w-8 rounded-md border px-2.5 py-1 text-xs font-medium transition',
        active
          ? 'border-institucional bg-institucional text-white'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
        disabled && 'cursor-not-allowed opacity-50',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Returns up to 7 page numbers; null entries represent ellipses. */
function computePageWindow(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | null)[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push(null);
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push(null);
  pages.push(total);
  return pages;
}
