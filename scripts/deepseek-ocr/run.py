#!/usr/bin/env python3
"""Прогоняет DeepSeek-OCR по картинкам и пишет JSON для scripts/score-ocr.mjs.

Запускать НЕ в браузере и не на машине разработчика «между делом»: это VLM на
несколько миллиардов параметров, ей нужна CUDA-видеокарта (bf16, ~8-16 ГБ) и
скачивание весов с Hugging Face. В сам продукт такой движок не встроить —
смысл прогона в том, чтобы понять, есть ли у VLM-OCR запас по качеству на
сложных сканах, ради которого стоило бы городить серверную часть.

    pip install torch transformers pillow accelerate
    python scripts/deepseek-ocr/run.py --dir tests/local/ocr-fixtures \\
        --out deepseek-ocr.json
    node scripts/score-ocr.mjs bench-ocr.json deepseek-ocr.json

Важно при чтении результатов: VLM не «читает» текст, а генерирует его. Ошибка
здесь выглядит не как мусор в строке, а как правдоподобная подмена — другая
цифра в ИНН, другая фамилия. Поэтому смотреть надо в первую очередь на колонку
«реквизиты», а не на CER.
"""
import argparse
import json
import pathlib
import re
import time

MODEL_ID = "deepseek-ai/DeepSeek-OCR"
# Промпт из карточки модели: свободная форма ведёт к пересказу вместо
# дословного распознавания, а нам нужен именно текст страницы.
PROMPT = "<image>\n<|grounding|>OCR this image."


def strip_grounding(text: str) -> str:
    """Убирает служебную разметку координат, оставляя чистый текст."""
    text = re.sub(r"<\|ref\|>|<\|/ref\|>", "", text)
    text = re.sub(r"<\|det\|>.*?<\|/det\|>", "", text, flags=re.S)
    return text.strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", default="tests/local/ocr-fixtures")
    parser.add_argument("--out", default="deepseek-ocr.json")
    parser.add_argument("--model", default=MODEL_ID)
    parser.add_argument("--engine-name", default="deepseek-ocr")
    args = parser.parse_args()

    import torch
    from PIL import Image
    from transformers import AutoModel, AutoTokenizer

    if not torch.cuda.is_available():
        raise SystemExit(
            "Нужна CUDA-видеокарта: на CPU эта модель считает страницу минутами, "
            "сравнение со скоростью браузерных движков теряет смысл."
        )

    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    model = AutoModel.from_pretrained(
        args.model,
        trust_remote_code=True,
        torch_dtype=torch.bfloat16,
        device_map="cuda",
    ).eval()

    images = sorted(p for p in pathlib.Path(args.dir).iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg"})
    if not images:
        raise SystemExit(f"Нет картинок в {args.dir}")

    results = []
    for path in images:
        image = Image.open(path).convert("RGB")
        started = time.perf_counter()
        # infer() определён в коде модели (trust_remote_code) и сам собирает
        # мультимодальный вход; сигнатура может меняться между релизами —
        # сверяйтесь с карточкой модели, если упадёт здесь.
        raw = model.infer(
            tokenizer,
            prompt=PROMPT,
            image=image,
            base_size=1024,
            image_size=640,
            crop_mode=True,
        )
        elapsed_ms = (time.perf_counter() - started) * 1000
        text = strip_grounding(raw if isinstance(raw, str) else str(raw))
        results.append(
            {"fixture": path.stem, "text": text, "recognizeMs": round(elapsed_ms)}
        )
        print(f"{path.name}: {len(text)} символов за {elapsed_ms / 1000:.1f} с")

    pathlib.Path(args.out).write_text(
        json.dumps({"engine": args.engine_name, "dir": args.dir, "results": results},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nЗаписано: {args.out}\nДалее: node scripts/score-ocr.mjs {args.out}")


if __name__ == "__main__":
    main()
