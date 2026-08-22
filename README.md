# MD Blinder

Браузерное приложение для конвертации юридических документов в Markdown и анонимизации. Всё выполняется на стороне клиента — документы не покидают браузер.

Полное ТЗ: [spec.md](./spec.md). Текущая версия — Этап 1 (MVP) из раздела 9: загрузка `.docx`, конвертация в Markdown (mammoth + turndown), просмотр и правка результата, экспорт `.md`.

## Разработка

```bash
npm install
npm run dev
```

## OCR-движки

Сканы распознаются Tesseract.js. На ветке эксперимента доступен второй движок,
PP-OCRv5 на onnxruntime-web (выбирается под дропзоной), и бенчмарк для их
сравнения — см. [docs/ocr-engines.md](./docs/ocr-engines.md).

```bash
npm run ocr:models -- --bench   # веса моделей (в репозиторий не входят)
npm run ocr:fixtures            # синтетические сканы для сравнения
npm run ocr:bench               # таблица CER / WER / реквизиты (нужен npm run dev)
```

## Сборка

```bash
npm run build
```

Собранные файлы в `dist/` можно развернуть на любом статическом хостинге (GitHub Pages, Cloudflare Pages, Netlify).
