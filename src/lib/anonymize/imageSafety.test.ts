import { describe, expect, it } from 'vitest'
import { buildAnonymizedText, buildAnonymizedTextWithMap } from './apply'
import { findImageRanges, IMAGE_REMOVED_MARKER, maskImagesForDetection } from './imageSafety'
import { detectStructural } from './regexDetectors'
import type { Entity } from './types'

describe('image safety', () => {
  it.each([
    '![Alice signature](data:image/png;base64,QWxpY2U=)',
    '![Alice](https://example.com/signature(1).png "signed by Alice")',
    '![Alice [signature]](<https://example.com/image(1).png>)',
    '<IMG src="data:image/png;base64,QWxpY2U=" alt="Alice > Smith">',
    '<picture><source srcset="https://example.com/private.png"><img src="fallback.png"></picture>',
    '<svg><image href="data:image/png;base64,QWxpY2U=" /></svg>',
  ])('removes the complete image and its identifying metadata: %s', (sourceImage) => {
    const source = `Before ${sourceImage} After alice@example.com`
    const { text } = buildAnonymizedTextWithMap(source, [])
    expect(text).toBe(`Before ${IMAGE_REMOVED_MARKER} After alice@example.com`)
    expect(source).toContain(sourceImage)
  })

  it.each(['![Alice][signature]', '![signature][]', '![signature]'])('removes used reference definitions as well as %s', (image) => {
    const source = `${image}\n\n[signature]: data:image/png;base64,QWxpY2U= "Alice signature"\n[other]: https://example.com/info`
    const text = buildAnonymizedText(source, [])
    expect(text).toBe(`${IMAGE_REMOVED_MARKER}\n\n${IMAGE_REMOVED_MARKER}\n[other]: https://example.com/info`)
  })

  it('does not restore image payload when an entity overlaps only part of it', () => {
    const source = '![private](data:image/png;base64,QWxpY2U=) after'
    const entity: Entity = { id: '1', type: 'PERSON', value: 'private', positions: [{ start: 2, end: 9 }], placeholder: '[PERSON_1]', anonymize: true, manual: true }
    expect(buildAnonymizedText(source, [entity])).toBe(`${IMAGE_REMOVED_MARKER} after`)
  })

  it('removes multiline image reference destinations and identifying titles', () => {
    const source = '![signature][sig]\n\n[sig]:\n  data:image/png;base64,QWxpY2U=\n  "Alice Smith"\n\nAfter'
    expect(buildAnonymizedText(source, [])).toBe(`${IMAGE_REMOVED_MARKER}\n\n${IMAGE_REMOVED_MARKER}\n\nAfter`)
  })

  it('masks image contents at unchanged offsets before structural scans', () => {
    const source = '![alice@example.com +79161234567](data:image/png;base64,' + 'x'.repeat(64000) + ')\nContact bob@example.com'
    const mask = maskImagesForDetection(source)
    expect(mask.length).toBe(source.length)
    expect(mask.indexOf('\n')).toBe(source.indexOf('\n'))
    expect(detectStructural(source).filter((m) => m.type === 'EMAIL' || m.type === 'PHONE'))
      .toEqual([{ type: 'EMAIL', value: 'bob@example.com', start: source.indexOf('bob@example.com'), end: source.length }])
    expect(findImageRanges(source)).toHaveLength(1)
  })

  it('keeps unrelated ordinary Markdown links and text unchanged', () => {
    const source = 'A [reference](https://example.com) and ! punctuation.'
    expect(buildAnonymizedText(source, [])).toBe(source)
  })

  it('excludes the removal notice from both structural and related detection projections', () => {
    const source = `Before ${IMAGE_REMOVED_MARKER} After`
    const projection = maskImagesForDetection(source)
    expect(projection).not.toContain('Изображение')
    expect(projection.length).toBe(source.length)
    expect(detectStructural(source)).toEqual([])
  })
})
