// Генерирует синтетические «сканы» договоров для бенчмарка OCR: PNG страницы
// плюс эталонный текст рядом. Настоящий корпус лежит в test-samples/ и в
// репозиторий не попадает, а сравнивать движки на чём-то надо и в CI, и на
// чистой машине — отсюда воспроизводимые фикстуры из скрипта.
//
// Страницы рендерятся в canvas headless-браузера: там же, где потом работает
// OCR, поэтому никаких расхождений с реальным конвейером (pdf.js рисует
// страницу в такой же canvas).
//
// Usage: node scripts/make-ocr-fixtures.mjs [outDir]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchChromium } from './launch-browser.mjs'

const outDir = process.argv[2] ?? 'tests/local/ocr-fixtures'

// Текст намеренно набит теми сущностями, ради которых существует продукт:
// ФИО в разных падежах, ИНН/ОГРН/КПП, паспорт, адрес, счёт, телефон, суммы.
// Ошибка OCR в цифре реквизита не видна глазом, но ломает и регулярки, и NER.
const PAGES = [
  {
    name: 'contract-clean',
    fontSize: 26,
    lines: [
      'ДОГОВОР ОКАЗАНИЯ УСЛУГ № 47/2026-К',
      'город Санкт-Петербург, двенадцатое марта две тысячи двадцать шестого года',
      'Общество с ограниченной ответственностью «Северный Ветер», именуемое',
      'в дальнейшем «Заказчик», в лице генерального директора Прокофьева',
      'Игоря Валентиновича, действующего на основании Устава, с одной стороны,',
      'и индивидуальный предприниматель Гаврилова Наталья Сергеевна,',
      'ОГРНИП 318784700129345, ИНН 780215634891, с другой стороны,',
      'заключили настоящий договор о нижеследующем.',
      '1. Стоимость услуг составляет 1 480 000 (один миллион четыреста',
      'восемьдесят тысяч) рублей 00 копеек, включая НДС 20%.',
      '2. Оплата производится на расчётный счёт 40802810300000123456',
      'в банке ПАО «Промсвязьбанк», БИК 044525555, к/с 30101810400000000555.',
      '3. Адрес Заказчика: 197183, г. Санкт-Петербург, ул. Дибуновская,',
      'д. 46, литера А, помещение 12-Н. Телефон: +7 (812) 445-67-19.',
      '4. Паспорт Исполнителя: серия 4016 № 738294, выдан ТП № 43 отдела',
      'УФМС России по Санкт-Петербургу 21.09.2016, код подразделения 780-043.',
    ],
  },
  {
    name: 'contract-small-noisy',
    fontSize: 17,
    noise: 26,
    rotate: -0.6,
    lines: [
      'ПРИЛОЖЕНИЕ № 2 к Договору поставки № ПС-1194 от 03.02.2026',
      'Поставщик: АО «Уралтехснаб», ИНН 6659012345, КПП 665901001,',
      'ОГРН 1076659001234, юридический адрес: 620014, Свердловская область,',
      'г. Екатеринбург, проспект Ленина, дом 24/8, офис 507.',
      'Покупатель: ООО «Балтийская торговая компания», ИНН 7802563412,',
      'в лице коммерческого директора Мещерякова Аркадия Львовича.',
      'Позиция 1. Насос центробежный КМ 80-50-200, 4 шт., 212 400,00 руб.',
      'Позиция 2. Задвижка стальная 30с41нж Ду150, 12 шт., 89 750,50 руб.',
      'Итого к оплате: 302 150 (триста две тысячи сто пятьдесят) рублей 50 копеек.',
      'Срок поставки — до 28 апреля 2026 года включительно.',
      'Ответственное лицо: Хабибуллина Гульнара Ринатовна, тел. 8-343-287-11-04,',
      'адрес электронной почты: g.habibullina@uraltechsnab.ru',
      'Подписи сторон: ______________ / Мещеряков А. Л. /',
      '                 ______________ / Хабибуллина Г. Р. /',
    ],
  },
  {
    name: 'contract-faded',
    fontSize: 22,
    noise: 10,
    contrast: 0.45,
    blur: 0.6,
    lines: [
      'АКТ приёма-передачи выполненных работ № 8 от 15.06.2026',
      'Исполнитель: ИП Свешников Дмитрий Аркадьевич, ИНН 502912874653.',
      'Заказчик: ООО «Медтехника-Волга», ИНН 6317045982, КПП 631701001.',
      'Работы выполнены в полном объёме на сумму 87 300 (восемьдесят семь',
      'тысяч триста) рублей, НДС не облагается.',
      'Претензий по объёму, качеству и срокам стороны не имеют.',
      'Адрес выполнения работ: 443110, г. Самара, ул. Ново-Садовая, д. 106, к. 3.',
      'СНИЛС исполнителя: 145-872-336 41. Контакт: +7 917 843-22-56.',
    ],
  },
  {
    name: 'contract-bilingual-columns',
    fontSize: 19,
    noise: 8,
    columns: [
      [
        'ДОГОВОР ПОСТАВКИ № 118/2026',
        'город Казань, пятое мая две тысячи',
        'двадцать шестого года.',
        'Общество с ограниченной ответственностью',
        '«Волжский Стандарт», ИНН 1655043921,',
        'в лице директора Сафина Рустема',
        'Ильдаровича, действующего на основании',
        'Устава, именуемое Поставщик, и',
        'компания Nordwind Trading Ltd.,',
        'именуемая Покупатель, заключили',
        'настоящий Договор о нижеследующем.',
        '1. Цена партии составляет 2 340 000',
        'рублей, включая НДС 20 процентов.',
        '2. Оплата на счёт 40702810600000098765',
        'в АО «Тинькофф Банк», БИК 044525974.',
      ],
      [
        'SUPPLY AGREEMENT No. 118/2026',
        'Kazan, the fifth day of May',
        'two thousand twenty six.',
        'Limited liability company',
        'Volzhsky Standard, INN 1655043921,',
        'represented by its director Rustem',
        'Safin acting under the Articles of',
        'Association, the Supplier, and',
        'Nordwind Trading Ltd.,',
        'the Buyer, have entered into',
        'this Agreement as follows.',
        '1. The price of the lot is 2,340,000',
        'roubles including VAT of 20 percent.',
        '2. Payment to account 40702810600000098765',
        'with Tinkoff Bank, BIC 044525974.',
      ],
    ],
  },
]

const html = `<!doctype html><meta charset="utf-8"><body style="margin:0"><canvas id="c"></canvas></body>`

const browser = await launchChromium()
const page = await browser.newPage()
await page.setContent(html)

mkdirSync(outDir, { recursive: true })

for (const spec of PAGES) {
  const dataUrl = await page.evaluate((s) => {
    const width = 1240
    const lineHeight = Math.round(s.fontSize * 1.7)
    const margin = 60
    const rows = s.columns ? Math.max(...s.columns.map((c) => c.length)) : s.lines.length
    const height = margin * 2 + lineHeight * rows
    const canvas = document.getElementById('c')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)

    if (s.rotate) {
      ctx.translate(width / 2, height / 2)
      ctx.rotate((s.rotate * Math.PI) / 180)
      ctx.translate(-width / 2, -height / 2)
    }
    if (s.blur) ctx.filter = `blur(${s.blur}px)`

    // Тёмно-серый вместо чёрного при contrast<1 — так выглядит скан со
    // слабого копира, на котором Tesseract традиционно проседает.
    const level = Math.round(255 * (1 - (s.contrast ?? 1)))
    ctx.fillStyle = `rgb(${level},${level},${level})`
    ctx.font = `${s.fontSize}px "Liberation Serif", "DejaVu Serif", serif`
    ctx.textBaseline = 'top'
    if (s.columns) {
      // Две колонки с широким жёлобом посередине — так верстают договоры с
      // переводом, и именно на такой странице OCR раньше читал поперёк.
      const columnWidth = (width - margin * 2 - 80) / 2
      s.columns.forEach((lines, col) => {
        const x = margin + col * (columnWidth + 80)
        lines.forEach((line, i) => ctx.fillText(line, x, margin + i * lineHeight))
      })
    } else {
      s.lines.forEach((line, i) => {
        ctx.fillText(line, margin, margin + i * lineHeight)
      })
    }
    ctx.filter = 'none'
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    if (s.noise) {
      const img = ctx.getImageData(0, 0, width, height)
      const d = img.data
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * s.noise * 2
        d[i] = Math.max(0, Math.min(255, d[i] + n))
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n))
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n))
      }
      ctx.putImageData(img, 0, 0)
    }
    return canvas.toDataURL('image/png')
  }, spec)

  const png = Buffer.from(dataUrl.split(',')[1], 'base64')
  writeFileSync(join(outDir, `${spec.name}.png`), png)
  // Эталон для двухколоночной страницы — порядок по колонкам: сначала одна
  // языковая версия целиком, потом другая.
  const gold = spec.columns ? spec.columns.flat() : spec.lines
  writeFileSync(join(outDir, `${spec.name}.txt`), gold.join('\n') + '\n')
  console.log(`+ ${join(outDir, spec.name)}.png/.txt (${(png.length / 1024).toFixed(0)} КБ)`)
}

await browser.close()
