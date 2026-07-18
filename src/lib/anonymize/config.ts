// Пороги уверенности NER для страховочной сетки recall (ТЗ этап 5, B1).
// score ≥ CONFIRM — авто-анонимизация; score в [GRAY_ZONE_LOW, CONFIRM) —
// кандидат на ручную проверку («серая зона»); ниже GRAY_ZONE_LOW — отбрасывается.
//
// C3 (ТЗ этап 6): 0.30 выбран по свипу порогов на dev-корпусе — см.
// test-samples/threshold-report.md (генератор: scripts/threshold-sweep.mjs).
// 0.30 доминирует над 0.20/0.25 (тот же/меньший recall при меньшем шуме) и
// сохраняет recall против 0.35/0.40; спаны ниже порога ловит серая зона B1.
export const NER_CONFIRM_THRESHOLD = 0.3
export const NER_GRAY_ZONE_LOW = 0.12
