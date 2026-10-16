#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一键运行：OCR → 批改+分析 → 生成反馈
带计时功能
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path

TEST_DIR = Path(__file__).parent


def run_script(script: str, args: list[str] = None) -> float:
    """运行子脚本，返回耗时（秒）"""
    cmd = [sys.executable, str(TEST_DIR / script)]
    if args:
        cmd.extend(args)
    print(f"\n{'='*60}")
    print(f"[运行] {' '.join(cmd)}")
    print(f"{'='*60}\n", flush=True)

    t0 = time.time()
    result = subprocess.run(cmd, cwd=str(TEST_DIR))
    elapsed = time.time() - t0

    if result.returncode != 0:
        print(f"[错误] {script} 执行失败")
        sys.exit(1)

    return elapsed


def main():
    parser = argparse.ArgumentParser(description="一键运行结班反馈测试流程")
    parser.add_argument("--student", type=str, default=None, help="指定学员姓名")
    parser.add_argument("--config", type=str, default="中级讲义", help="课型配置")
    parser.add_argument("--step", type=int, default=0, help="从第几步开始（0=全部, 1=OCR, 2=分析, 3=反馈）")
    args = parser.parse_args()

    total_start = time.time()
    timings = {}

    student_args = ["--student", args.student] if args.student else []
    config_args = ["--config", args.config]

    if args.step <= 1:
        timings["Step1_OCR"] = run_script("step1_ocr.py", student_args)

    if args.step <= 2:
        timings["Step2_分析"] = run_script("step2_analyze.py", student_args + config_args)

    if args.step <= 3:
        timings["Step3_反馈"] = run_script("step3_feedback.py", student_args)

    total_elapsed = time.time() - total_start

    print("\n" + "="*60)
    print("[计时汇总]")
    for step_name, elapsed in timings.items():
        mins = int(elapsed // 60)
        secs = int(elapsed % 60)
        print(f"  {step_name}: {mins}分{secs}秒 ({elapsed:.1f}s)")
    print(f"  {'总计':>12}: {int(total_elapsed//60)}分{int(total_elapsed%60)}秒 ({total_elapsed:.1f}s)")
    print(f"\n[完成] 所有步骤执行完毕")
    print(f"输出目录: {TEST_DIR / 'output'}")
    print("="*60)


if __name__ == "__main__":
    main()
