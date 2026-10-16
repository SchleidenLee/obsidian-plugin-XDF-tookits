#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Step 3: 生成结班反馈
读取 Step 2 的分析结果，按 XDF 固定格式输出 Markdown 反馈文件
"""

import argparse
import json
import re
import sys
from pathlib import Path

TEST_DIR = Path(__file__).parent
CACHE_DIR = TEST_DIR / "cache"
OUTPUT_DIR = TEST_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)


def split_sections(analysis_text: str) -> dict:
    """
    将模型输出按段落拆分为 5 个部分。
    模型输出格式通常是：
      **1. 整体表现评价**\n内容...
      **2. 优势分析**\n内容...
      **3. 错题逐题分析**\n内容...
      **4. 薄弱点总结**\n内容...
      **5. 复习建议**\n内容...
    """
    sections = {
        "overall": "",
        "strengths": "",
        "error_analysis": "",
        "weaknesses": "",
        "recommendations": "",
    }

    # 按 **数字. 标题** 模式拆分
    pattern = r'\*\*\d+[\.、]\s*(?:整体表现评价|整体表现|综合评价|优势分析|学生优势|优势|错题分析|错题详情|错题逐题分析|薄弱点总结|薄弱点|薄弱环节|复习建议|建议)\*\*'
    parts = re.split(pattern, analysis_text, flags=re.IGNORECASE)

    # parts[0] 是标题前的内容（通常为空或标题行）
    # parts[1] = 整体表现内容, parts[2] = 优势内容, parts[3] = 错题内容, parts[4] = 薄弱点内容, parts[5] = 复习建议内容
    keys = ["overall", "strengths", "error_analysis", "weaknesses", "recommendations"]
    for i, key in enumerate(keys):
        if i + 1 < len(parts):
            text = parts[i + 1].strip()
            # 去掉开头的 "2." "3." 等残留数字编号
            text = re.sub(r'^\d+[\.、]\s*\n*', '', text).strip()
            sections[key] = text

    # 如果拆分后内容为空，尝试按 **标题** 模式（不带数字）
    if not any(sections.values()):
        pattern2 = r'\*\*(?:整体表现评价|整体表现|综合评价|优势分析|学生优势|优势|错题分析|错题详情|错题逐题分析|薄弱点总结|薄弱点|薄弱环节|复习建议|建议)\*\*'
        parts2 = re.split(pattern2, analysis_text, flags=re.IGNORECASE)
        for i, key in enumerate(keys):
            if i + 1 < len(parts2):
                text = parts2[i + 1].strip()
                text = re.sub(r'^\d+[\.、]\s*\n*', '', text).strip()
                sections[key] = text

    # 如果还是失败，整体作为 overall
    if not any(sections.values()):
        sections["overall"] = analysis_text.strip()

    return sections


def format_feedback(student_name: str, grade: dict, analysis_text: str) -> str:
    """将分析结果格式化为 XDF 标准反馈格式"""
    raw_score = grade["raw_score"]
    total = grade["total"]
    band = grade["band"]

    completion = f"准确率：共{total}题，正确{raw_score}个\n\n预估雅思对应分数：{band}"
    sections = split_sections(analysis_text)

    # 组装 Markdown
    content = f"#### **【完成情况】**\n\n{completion}\n\n"
    content += "#### **【本阶段学习分析】**\n\n"

    if sections["overall"]:
        content += f"{sections['overall']}\n\n"

    if sections["strengths"]:
        content += f"**学生优势：**\n\n{sections['strengths']}\n\n"

    if sections["error_analysis"]:
        content += f"**错题分析：**\n\n{sections['error_analysis']}\n\n"

    if sections["weaknesses"]:
        content += f"**薄弱点总结：**\n\n{sections['weaknesses']}\n\n"

    content += "#### **【复习建议】**\n\n"
    if sections["recommendations"]:
        content += f"{sections['recommendations']}\n"
    else:
        content += "请参考上方分析中的建议部分。\n"

    return content


def main():
    parser = argparse.ArgumentParser(description="Step 3: 生成结班反馈")
    parser.add_argument("--student", type=str, default=None, help="指定学员姓名（默认处理所有）")
    args = parser.parse_args()

    analysis_dirs = [d for d in (TEST_DIR / "raw").iterdir() if d.is_dir() and d.name != "试卷"]
    if not analysis_dirs:
        print("错误: 未找到答题卡目录")
        sys.exit(1)
    sheet_dir = analysis_dirs[0]

    analysis_file = CACHE_DIR / f"{sheet_dir.name}_analysis.json"
    if not analysis_file.exists():
        print(f"错误: 分析缓存不存在，请先运行 step2_analyze.py")
        print(f"  期望路径: {analysis_file}")
        sys.exit(1)

    with open(analysis_file, "r", encoding="utf-8") as f:
        analysis_cache = json.load(f)

    for name, data in analysis_cache.items():
        if args.student and name != args.student:
            continue

        grade = data["grade"]
        analysis = data["analysis"]

        print(f"[反馈] 生成学员: {name}")
        print(f"  得分: {grade['raw_score']}/{grade['total']}, 预估: {grade['band']}")

        content = format_feedback(name, grade, analysis)

        output_file = OUTPUT_DIR / f"{name}.md"
        output_file.write_text(content, encoding="utf-8")
        print(f"  已保存: {output_file}")

    print(f"\n[反馈] 完成，输出目录: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
