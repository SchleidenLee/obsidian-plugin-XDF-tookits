#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Step 1: OCR 答题卡识别
使用 qwen3.7-plus 多模态模型识别 IELTS 答题卡，提取 40 道题答案
输出缓存到 test-grader/cache/ 目录
"""

import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path

from openai import OpenAI

# ===== 配置 =====
API_BASE_URL = "https://coding.dashscope.aliyuncs.com/v1"
API_KEY = "sk-sp-dac515a1df174fd1bb64394aa2c5c31b"
MODEL = "qwen3.7-plus"

TEST_DIR = Path(__file__).parent
RAW_DIR = TEST_DIR / "raw"
CACHE_DIR = TEST_DIR / "cache"
CACHE_DIR.mkdir(exist_ok=True)

MAX_IMAGE_SIZE = 4 * 1024 * 1024  # 4MB


def compress_image(image_path: Path, max_size: int = MAX_IMAGE_SIZE) -> Path:
    """如果图像过大则压缩"""
    if image_path.stat().st_size <= max_size:
        return image_path
    from PIL import Image
    img = Image.open(image_path)
    ratio = 0.8
    compressed = image_path.parent / f"{image_path.stem}_compressed.jpg"
    while True:
        new_w = int(img.width * ratio)
        new_h = int(img.height * ratio)
        resized = img.resize((new_w, new_h), Image.LANCZOS)
        if img.mode in ("RGBA", "P"):
            resized = resized.convert("RGB")
        resized.save(str(compressed), quality=85, optimize=True)
        if compressed.stat().st_size <= max_size or ratio < 0.2:
            break
        ratio *= 0.8
    return compressed


def encode_image(image_path: Path) -> tuple[str, str]:
    """编码图片为 base64，返回 (mime_type, base64_string)"""
    ext = image_path.suffix.lower()
    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
    mime = mime_map.get(ext, "image/jpeg")
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    return mime, b64


def ocr_answer_sheet(image_path: Path) -> dict:
    """调用 qwen3.7-plus 识别答题卡"""
    import time
    t0 = time.time()
    print(f"  [debug] 开始压缩图片...", flush=True)
    client = OpenAI(base_url=API_BASE_URL, api_key=API_KEY, timeout=120.0)

    processed = compress_image(image_path)
    print(f"  [debug] 压缩完成: {processed.stat().st_size / 1024 / 1024:.1f} MB, 耗时 {time.time()-t0:.1f}s", flush=True)

    t1 = time.time()
    print(f"  [debug] 开始 base64 编码...", flush=True)
    mime, b64 = encode_image(processed)
    print(f"  [debug] 编码完成: {len(b64)/1024/1024:.1f} MB, 耗时 {time.time()-t1:.1f}s", flush=True)

    messages = [{
        "role": "user",
        "content": [
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{b64}"},
            },
            {
                "type": "text",
                "text": (
                    "这是一张 IELTS 阅读答题卡。请识别所有 40 道题的答案。\n\n"
                    "要求：\n"
                    "1. 按题号顺序提取答案（Q1-Q40）\n"
                    "2. 填空题直接提取单词（保持原始大小写）\n"
                    "3. 判断题识别 T/F/TRUE/FALSE/NG/N.G 等\n"
                    "4. 选择题识别 A/B/C/D\n"
                    "5. 配标题题识别罗马数字（I, II, III, IV, V, VI, VII, VIII）\n\n"
                    "请以 JSON 格式返回：{\"answers\": [\"答案1\", \"答案2\", ...]}\n"
                    "其中 answers 数组包含 40 个元素，对应第 1 到第 40 题的答案。\n"
                    "如果某题无法识别或为空，请填 \"X\"。\n"
                    "只返回 JSON，不要其他文字。"
                ),
            },
        ],
    }]

    response = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        temperature=0.3,
        max_tokens=2048,
    )

    raw_text = response.choices[0].message.content or ""
    return {"raw": raw_text, "image": str(image_path.name)}


def parse_answers(raw_text: str) -> list[str]:
    """从 LLM 返回的文本中解析 40 个答案"""
    clean = raw_text.strip()
    # 去除 markdown 代码块
    match = re.search(r'```(?:json)?\s*(.*?)\s*```', clean, re.DOTALL)
    if match:
        clean = match.group(1)

    # 提取 JSON
    start = clean.find("{")
    end = clean.rfind("}")
    if start != -1 and end != -1 and end > start:
        clean = clean[start:end + 1]

    data = json.loads(clean)
    answers = data.get("answers", [])

    # 补齐到 40 个
    if len(answers) < 40:
        answers = answers + ["X"] * (40 - len(answers))
    elif len(answers) > 40:
        answers = answers[:40]

    return answers


def run_ocr(student_name: str, image_path: Path) -> dict:
    """执行单个学员的 OCR 识别"""
    print(f"[OCR] 识别学员: {student_name} -> {image_path.name}", flush=True)
    t_start = __import__("time").time()
    print(f"  [debug] 开始调用 API...", flush=True)
    result = ocr_answer_sheet(image_path)
    print(f"  [debug] API 调用完成, 耗时 {__import__('time').time()-t_start:.1f}s", flush=True)
    answers = parse_answers(result["raw"])
    print(f"[OCR] 识别完成: {student_name}, 答案数: {len(answers)}", flush=True)
    return {
        "student": student_name,
        "image": result["image"],
        "answers": answers,
        "raw_response": result["raw"],
    }


def main():
    parser = argparse.ArgumentParser(description="Step 1: OCR 答题卡识别")
    parser.add_argument("--student", type=str, default=None, help="指定学员姓名（默认处理所有）")
    args = parser.parse_args()

    # 找到答题卡目录
    answer_sheet_dirs = [d for d in RAW_DIR.iterdir() if d.is_dir() and d.name != "试卷"]
    if not answer_sheet_dirs:
        print("错误: 未找到答题卡目录")
        sys.exit(1)

    # 默认取第一个目录
    sheet_dir = answer_sheet_dirs[0]
    print(f"[OCR] 答题卡目录: {sheet_dir.name}", flush=True)

    # 收集所有学员
    students = {}
    for img in sorted(sheet_dir.glob("*.jpg")) + sorted(sheet_dir.glob("*.png")):
        name = img.stem
        students[name] = img

    # 如果指定了学员，只处理该学员
    if args.student:
        if args.student not in students:
            print(f"错误: 未找到学员 '{args.student}' 的答题卡")
            sys.exit(1)
        students = {args.student: students[args.student]}

    # 逐个识别
    cache = {}
    for name, img_path in students.items():
        try:
            result = run_ocr(name, img_path)
            cache[name] = result
        except Exception as e:
            print(f"[OCR] 失败: {name} -> {e}", flush=True)
            cache[name] = {"student": name, "error": str(e)}

    # 保存缓存
    cache_file = CACHE_DIR / f"{sheet_dir.name}_ocr.json"
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)
    print(f"[OCR] 缓存已保存: {cache_file}", flush=True)

    # 打印结果摘要
    for name, data in cache.items():
        if "error" in data:
            print(f"  {name}: 失败 - {data['error']}", flush=True)
        else:
            answers = data["answers"]
            filled = sum(1 for a in answers if a != "X")
            print(f"  {name}: {filled}/40 题已识别", flush=True)


if __name__ == "__main__":
    main()
