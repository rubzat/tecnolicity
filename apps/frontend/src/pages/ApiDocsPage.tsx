import { Card, CardHeader } from '../components/ui';

/**
 * Public API reference for /api/vigentes. One endpoint today, so this is a
 * hand-written page rather than a generated OpenAPI viewer — revisit that
 * tradeoff if/when a second public endpoint needs documenting.
 */
export function ApiDocsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-slate-900">API pública</h1>
        <p className="mt-1 text-sm text-slate-500">
          Datos abiertos de licitaciones vigentes de ComprasMX. De lectura, sin necesidad de registro.
        </p>
      </div>

      <Card>
        <CardHeader title="Límites de uso" />
        <div className="space-y-2 p-4 text-sm text-slate-700">
          <p>
            Sin autenticación: <strong>30 solicitudes por minuto</strong> por IP.
          </p>
          <p>
            Con una API key asignada: hasta <strong>300 solicitudes por minuto</strong> (o el límite que
            se te haya asignado), registradas a tu nombre. Escríbenos para pedir una.
          </p>
          <p className="text-xs text-slate-500">
            El límite vigente y lo que te queda de la ventana actual vienen en las cabeceras{' '}
            <Code>RateLimit-Limit</Code> y <Code>RateLimit-Remaining</Code> de cada respuesta.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="GET /api/vigentes" subtitle="Procedimientos de contratación actualmente abiertos" />
        <div className="space-y-4 p-4 text-sm text-slate-700">
          <div>
            <p className="mb-2 font-medium text-slate-900">Parámetros (todos opcionales)</p>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                <ParamRow name="q" desc="Texto libre — busca en número de procedimiento y nombre." />
                <ParamRow name="tipo_contratacion" desc="Ej. SERVICIOS, ADQUISICIONES, OBRA PÚBLICA." />
                <ParamRow name="tipo_procedimiento" desc="Ej. LICITACIÓN PÚBLICA, INVITACIÓN A CUANDO MENOS 3 PERSONAS." />
                <ParamRow name="dependencia" desc="Nombre o siglas de la dependencia compradora." />
                <ParamRow name="siglas" desc="Siglas exactas de la dependencia." />
                <ParamRow name="entidad_federativa" desc="Estado de la contratación." />
                <ParamRow name="page" desc="Página de resultados (default 1)." />
                <ParamRow name="page_size" desc="Resultados por página, máx. 100 (default 20)." />
              </tbody>
            </table>
          </div>

          <div>
            <p className="mb-2 font-medium text-slate-900">Ejemplo</p>
            <CodeBlock>{`curl "https://tu-dominio.com/api/vigentes?q=software&page_size=5" \\
  -H "X-API-Key: tu_key_aqui"`}</CodeBlock>
          </div>

          <div>
            <p className="mb-2 font-medium text-slate-900">Respuesta</p>
            <CodeBlock>{`{
  "data": [
    {
      "id": 2,
      "numero_procedimiento": "LA-56-AYO-056AYO939-N-57-2026",
      "nombre": "SERVICIO INTEGRAL DE ALIMENTACIÓN",
      "caracter": "NACIONAL",
      "siglas_dependencia": "IMSS-BIENESTAR",
      "estatus": "VIGENTE PAP",
      "fecha_junta_aclaraciones": "2026-06-24T21:00:00.000Z",
      "fecha_presentacion_apertura": "2026-07-02T21:00:00.000Z",
      "tipo_procedimiento": "LICITACIÓN PÚBLICA",
      "tipo_contratacion": "SERVICIOS",
      "unidad_compradora": "056AYO939 - HOSPITAL DE ESPECIALIDADES PEDIATRICAS",
      "codigo_expediente": "E-2026-00068009",
      "entidad_federativa": "CHIAPAS",
      "direcciones_anuncio": "https://comprasmx.buengobierno.gob.mx/...",
      "scraped_at": "2026-07-02T20:38:57.979Z"
    }
  ],
  "pagination": { "page": 1, "page_size": 5, "total": 1253, "total_pages": 251 }
}`}</CodeBlock>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ParamRow({ name, desc }: { name: string; desc: string }) {
  return (
    <tr>
      <td className="py-2 pr-4 align-top">
        <Code>{name}</Code>
      </td>
      <td className="py-2 align-top text-slate-600">{desc}</td>
    </tr>
  );
}

function Code({ children }: { children: string }) {
  return <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-institucional-700">{children}</code>;
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-slate-900 px-4 py-3 font-mono text-xs leading-relaxed text-slate-100">
      {children}
    </pre>
  );
}
