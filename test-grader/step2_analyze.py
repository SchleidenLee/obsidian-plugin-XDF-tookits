#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Step 2: 批改 + 试卷分析
2a. 对答案批改（config 标准答案 vs OCR 答案）→ 找出错题
2b. 试卷图片 + 错题信息 → 传给 qwen3.7-plus 生成试卷分析
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
CONFIG_DIR = Path(__file__).parent.parent / "references" / "MCP-XDF-Assistant" / "configs"

MAX_IMAGE_SIZE = 4 * 1024 * 1024  # 4MB

# IELTS Academic 原始分转 Band Score
BAND_MAP = {
    40: "9.0", 39: "9.0", 38: "8.5", 37: "8.5",
    36: "8.0", 35: "8.0", 34: "7.5", 33: "7.5",
    32: "7.0", 31: "7.0", 30: "7.0",
    29: "6.5", 28: "6.5", 27: "6.5",
    26: "6.0", 25: "6.0", 24: "6.0", 23: "6.0",
    22: "5.5", 21: "5.5", 20: "5.5",
    19: "5.0", 18: "5.0", 17: "5.0", 16: "5.0",
    15: "4.5", 14: "4.5", 13: "4.5",
    12: "4.0", 11: "4.0", 10: "4.0",
    9: "3.5", 8: "3.5", 7: "3.5", 6: "3.5",
    5: "3.0", 4: "3.0", 3: "2.5", 2: "2.0", 1: "1.0", 0: "1.0",
}

# TF/NG 变体映射
TFNG_VARIANTS = {
    "true": {"true", "t", "yes", "y"},
    "false": {"false", "f", "no", "n"},
    "not given": {"not given", "ng", "notgiven"},
}


def check_match(student_ans: str, correct_answers: list[str]) -> bool:
    """判断学生答案是否正确，支持 T/F/NG 变体"""
    s = str(student_ans).lower().strip()
    if not s or s in {"", "x", "n/a"}:
        return False
    c_answers = [str(c).lower().strip() for c in correct_answers]
    if s in c_answers:
        return True
    for canonical, variants in TFNG_VARIANTS.items():
        if s in variants:
            for c in c_answers:
                if c in variants:
                    return True
    return False


def calculate_band(raw_score: int) -> str:
    """计算预估雅思分数"""
    band = BAND_MAP.get(raw_score, "0.0")
    try:
        current = float(band)
        upper = min(9.0, current + 0.5)
        return f"{band}-{upper:.1f}"
    except ValueError:
        return band


def load_config(course_type: str) -> dict:
    """加载测试配置"""
    config_file = CONFIG_DIR / f"{course_type}.json"
    if not config_file.exists():
        print(f"错误: 配置文件不存在: {config_file}")
        sys.exit(1)
    with open(config_file, "r", encoding="utf-8") as f:
        return json.load(f)


def grade_answers(config: dict, student_answers: list[str]) -> dict:
    """对答案批改，返回详细结果"""
    correct_answers = []
    for section in config.get("sections", []):
        for group in section.get("question_groups", []):
            for q in group.get("questions", []):
                answers = q.get("answers", [])
                correct_answers.append(answers[0] if answers else "")

    total = len(correct_answers)
    wrong_questions = []  # 错题列表
    type_stats = {}  # 题型统计

    for section in config.get("sections", []):
        passage = section.get("title", "")
        for group in section.get("question_groups", []):
            type_name = group.get("type_name", "")
            key = f"{passage} - {type_name}"
            correct_count = 0
            total_count = 0
            details = []

            for q in group.get("questions", []):
                q_id = q.get("id", 0)
                correct = q.get("answers", [])
                student = student_answers[q_id - 1] if q_id <= len(student_answers) else "X"
                is_correct = check_match(student, correct)
                total_count += 1
                if is_correct:
                    correct_count += 1
                else:
                    wrong_questions.append({
                        "q_id": q_id,
                        "type": type_name,
                        "passage": passage,
                        "student_answer": student,
                        "correct_answer": correct[0] if correct else "",
                    })
                details.append({
                    "q_id": q_id,
                    "student": student,
                    "correct": correct[0] if correct else "",
                    "is_correct": is_correct,
                })

            type_stats[key] = {
                "correct": correct_count,
                "total": total_count,
                "details": details,
            }

    raw_score = sum(1 for i in range(total) if check_match(student_answers[i], [correct_answers[i]]))
    band = calculate_band(raw_score)

    return {
        "raw_score": raw_score,
        "total": total,
        "band": band,
        "wrong_questions": wrong_questions,
        "type_stats": type_stats,
        "correct_answers": correct_answers,
    }


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
    ext = image_path.suffix.lower()
    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
    mime = mime_map.get(ext, "image/jpeg")
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    return mime, b64


PROMPT_TEMPLATE_PATH = TEST_DIR / "prompts" / "analysis_prompt.md"


def build_analysis_prompt(grade_result: dict, course_info: dict) -> str:
    """从 prompt 模板文件构建试卷分析 prompt"""
    raw_score = grade_result["raw_score"]
    total = grade_result["total"]
    band = grade_result["band"]
    wrong = grade_result["wrong_questions"]
    type_stats = grade_result["type_stats"]

    # 构建错题列表
    wrong_text = ""
    if wrong:
        for w in wrong:
            wrong_text += f"- Q{w['q_id']}（{w['passage']} / {w['type']}）：学生答案「{w['student_answer']}」，正确答案「{w['correct_answer']}」\n"
    else:
        wrong_text = "无错题，全部正确。"

    # 构建题型统计
    type_text = ""
    for key, stats in type_stats.items():
        type_text += f"- {key}：正确 {stats['correct']}/{stats['total']}\n"

    # 课程信息
    course_text = json.dumps(course_info, ensure_ascii=False, indent=2) if course_info else "无"

    # 读取 prompt 模板并替换变量
    template = PROMPT_TEMPLATE_PATH.read_text(encoding="utf-8")
    prompt = template.replace("{{course_text}}", course_text)
    prompt = prompt.replace("{{raw_score}}", str(raw_score))
    prompt = prompt.replace("{{total}}", str(total))
    prompt = prompt.replace("{{band}}", band)
    prompt = prompt.replace("{{type_text}}", type_text)
    prompt = prompt.replace("{{wrong_text}}", wrong_text)

    return prompt


def analyze_with_model(grade_result: dict, course_info: dict, exam_images: list[Path]) -> str:
    """调用 qwen3.7-plus 生成试卷分析"""
    client = OpenAI(base_url=API_BASE_URL, api_key=API_KEY)

    prompt = build_analysis_prompt(grade_result, course_info)

    # 构建消息：试卷图片 + 分析 prompt
    content = []
    for img_path in exam_images:
        processed = compress_image(img_path)
        mime, b64 = encode_image(processed)
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{b64}"},
        })
    content.append({"type": "text", "text": prompt})

    messages = [{"role": "user", "content": content}]

    print(f"[分析] 传入 {len(exam_images)} 张试卷图片，调用模型...")
    response = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        temperature=0.7,
        max_tokens=8192,
    )

    return response.choices[0].message.content or ""


def main():
    parser = argparse.ArgumentParser(description="Step 2: 批改 + 试卷分析")
    parser.add_argument("--student", type=str, default=None, help="指定学员姓名（默认处理所有）")
    parser.add_argument("--config", type=str, default="中级讲义", help="课型配置名")
    args = parser.parse_args()

    course_type = args.config
    config = load_config(course_type)
    course_info = config.get("course_info", {})

    # 加载 OCR 缓存
    answer_sheet_dirs = [d for d in RAW_DIR.iterdir() if d.is_dir() and d.name != "试卷"]
    if not answer_sheet_dirs:
        print("错误: 未找到答题卡目录")
        sys.exit(1)
    sheet_dir = answer_sheet_dirs[0]

    ocr_cache_file = CACHE_DIR / f"{sheet_dir.name}_ocr.json"
    if not ocr_cache_file.exists():
        print(f"错误: OCR 缓存不存在，请先运行 step1_ocr.py")
        print(f"  期望路径: {ocr_cache_file}")
        sys.exit(1)

    with open(ocr_cache_file, "r", encoding="utf-8") as f:
        ocr_cache = json.load(f)

    # 收集试卷图片
    exam_dir = RAW_DIR / "试卷"
    exam_images = sorted(exam_dir.glob("*.png")) + sorted(exam_dir.glob("*.jpg"))
    if not exam_images:
        print("错误: 未找到试卷图片")
        sys.exit(1)
    print(f"[分析] 试卷图片: {len(exam_images)} 张")

    # 处理学员
    students_to_process = {}
    for name, data in ocr_cache.items():
        if "error" in data:
            continue
        if args.student and name != args.student:
            continue
        students_to_process[name] = data

    if not students_to_process:
        print("错误: 没有可处理的学员")
        sys.exit(1)

    # 逐个处理
    analysis_cache = {}
    for name, ocr_data in students_to_process.items():
        answers = ocr_data["answers"]
        print(f"\n{'='*60}")
        print(f"[分析] 学员: {name}")

        # 2a. 批改
        grade_result = grade_answers(config, answers)
        print(f"  得分: {grade_result['raw_score']}/{grade_result['total']}")
        print(f"  预估分数: {grade_result['band']}")
        print(f"  错题数: {len(grade_result['wrong_questions'])}")
        for w in grade_result["wrong_questions"]:
            print(f"    Q{w['q_id']} ({w['type']}): 学生「{w['student_answer']}」 vs 正确「{w['correct_answer']}」")

        # 2b. 模型分析
        analysis = analyze_with_model(grade_result, course_info, exam_images)
        print(f"[分析] 模型分析完成: {name}")

        analysis_cache[name] = {
            "grade": grade_result,
            "analysis": analysis,
        }

    # 保存缓存
    analysis_file = CACHE_DIR / f"{sheet_dir.name}_analysis.json"
    with open(analysis_file, "w", encoding="utf-8") as f:
        json.dump(analysis_cache, f, ensure_ascii=False, indent=2)
    print(f"\n[分析] 缓存已保存: {analysis_file}")


if __name__ == "__main__":
    main()
