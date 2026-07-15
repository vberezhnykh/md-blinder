// Пороги уверенности NER для страховочной сетки recall (ТЗ этап 5, B1).
// score ≥ CONFIRM — авто-анонимизация; score в [GRAY_ZONE_LOW, CONFIRM) —
// кандидат на ручную проверку («серая зона»); ниже GRAY_ZONE_LOW — отбрасывается.
export const NER_CONFIRM_THRESHOLD = 0.3
export const NER_GRAY_ZONE_LOW = 0.12
