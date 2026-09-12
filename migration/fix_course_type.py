"""
批量标准化 course_type 字段
遍历 working/ 下所有档案，将旧的课程类型名称统一为 L1/L2 教材/讲义格式

映射关系：
- 初级讲义 → L1讲义
- 初级教材 → L1教材
- 中级讲义 → L2讲义
- 中级教材 → L2教材
- 班课 → L1讲义
"""

import os
import re
from pathlib import Path

WORKING_DIR = Path(__file__).parent / "working"

# 课程类型映射
COURSE_TYPE_MAP = {
    '初级讲义': 'L1讲义',
    '初级教材': 'L1教材',
    '中级讲义': 'L2讲义',
    '中级教材': 'L2教材',
    '班课': 'L1讲义',
}


def normalize_course_type_in_file(file_path):
    """标准化单个文件中的 course_type"""
    content = file_path.read_text(encoding='utf-8')
    
    # 检查是否有 course_type 字段
    if 'course_type:' not in content:
        return False
    
    changed = False
    for old, new in COURSE_TYPE_MAP.items():
        # 匹配 course_type 列表项中的旧值（带或不带引号）
        pattern = rf'(-\s*["\']?)({re.escape(old)})(["\']?\s*\n)'
        replacement = rf'\1{new}\3'
        new_content = re.sub(pattern, replacement, content)
        if new_content != content:
            content = new_content
            changed = True
    
    if changed:
        file_path.write_text(content, encoding='utf-8')
    
    return changed


def main():
    print("开始标准化 course_type 字段...\n")
    
    modified_files = []
    
    for root, dirs, files in os.walk(WORKING_DIR):
        root_path = Path(root)
        
        for file in files:
            if file.endswith('.md'):
                file_path = root_path / file
                
                # 处理档案首页和 Nav 文件
                is_archive = (file[:-3] == root_path.name)
                is_nav = " Lesson " in file and file.endswith('.md')
                
                if is_archive or is_nav:
                    if normalize_course_type_in_file(file_path):
                        modified_files.append(file_path)
                        rel_path = file_path.relative_to(WORKING_DIR)
                        print(f"  ✅ {rel_path}")
    
    print(f"\n✅ 完成！共修改 {len(modified_files)} 个文件")


if __name__ == "__main__":
    main()
