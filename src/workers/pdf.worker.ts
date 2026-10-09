// Точка входа воркера pdf.js: сначала полифилы, затем сам воркер. Модули
// выполняются в порядке импорта, и pdf.worker сам подключается к порту воркера.
import '../lib/mapUpsert'
import 'pdfjs-dist/build/pdf.worker.min.mjs'
