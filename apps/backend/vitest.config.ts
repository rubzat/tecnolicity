import { defineConfig } from 'vitest/config';

/**
 * Los tests de integración comparten UNA sola base de datos de desarrollo y
 * varios se apoyan en conteos globales (`ingest-csv.integration.test.ts`,
 * `procedure-query-repository.integration.test.ts`), así que con la ejecución
 * paralela de archivos que trae vitest por default se pisan entre sí: un
 * archivo inserta filas mientras otro cuenta o agrega, y el resultado es
 * intermitente. Serializar los archivos hace la suite determinista; los tests
 * dentro de cada archivo siguen corriendo normal.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
