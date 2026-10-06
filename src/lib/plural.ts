const rules = new Intl.PluralRules('ru-RU')

// forms: [одна, две, пять] — «находка», «находки», «находок».
export function plural(n: number, forms: readonly [string, string, string]): string {
  const rule = rules.select(n)
  const form = rule === 'one' ? forms[0] : rule === 'few' ? forms[1] : forms[2]
  return `${n} ${form}`
}
