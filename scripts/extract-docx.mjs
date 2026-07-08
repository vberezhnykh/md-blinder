import mammoth from 'mammoth'
import { readFileSync } from 'node:fs'

const path = process.argv[2]
const buf = readFileSync(path)
const { value: html } = await mammoth.convertToHtml({ buffer: buf })
// crude html -> text just for inspection
const text = html
  .replace(/<\/(p|h[1-6]|tr|li|div)>/g, '\n')
  .replace(/<td[^>]*>/g, ' | ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
console.log(text)
