import { invertedEffects, isolateHistory } from '@codemirror/commands'
import { Annotation, StateEffect, StateField, type ChangeDesc, type TransactionSpec } from '@codemirror/state'
import type { Entity } from './anonymize/types'

function mapEntities(entities: Entity[], changes: ChangeDesc): Entity[] {
  if (changes.empty) return entities
  return entities
    .map((entity) => ({
      ...entity,
      positions: entity.positions
        .map((position) => ({
          start: changes.mapPos(position.start, 1),
          end: changes.mapPos(position.end, -1),
        }))
        .filter((position) => position.end > position.start),
    }))
    .filter((entity) => entity.positions.length > 0)
}

/** A complete entity snapshot in the resulting document's coordinates. */
export const setEntityMetadata = StateEffect.define<Entity[]>({ map: mapEntities })

/** Prop synchronization must not echo a second document change back to React. */
export const externalEntitySync = Annotation.define<boolean>()

export const entityMetadataField = StateField.define<Entity[]>({
  create: () => [],
  update(entities, transaction) {
    let next = mapEntities(entities, transaction.changes)
    for (const effect of transaction.effects) {
      if (effect.is(setEntityMetadata)) next = effect.value
    }
    return next
  },
})

// Mapping ranges alone cannot invert deletion: the metadata for a fully
// deleted occurrence no longer exists. Keep the pre-transaction snapshot in
// the same history event as the text. CodeMirror also applies this inverter
// during undo, so redo restores the corresponding resulting snapshot.
export const entityMetadataHistory = invertedEffects.of((transaction) => {
  if (!transaction.docChanged && !transaction.effects.some((effect) => effect.is(setEntityMetadata))) {
    return []
  }
  return [setEntityMetadata.of(transaction.startState.field(entityMetadataField))]
})

/** External entity edits are undoable, separately from adjacent typing. */
export function entitySyncTransaction(entities: Entity[], changes?: TransactionSpec['changes']): TransactionSpec {
  return {
    changes,
    effects: setEntityMetadata.of(entities),
    annotations: [externalEntitySync.of(true), isolateHistory.of('full')],
  }
}
