"""
批量修复档案链接脚本
遍历 working/ 下所有档案文件夹，重新生成所有 wiki 链接
"""

import os
import re
from pathlib import Path

WORKING_DIR = Path(__file__).parent / "working"

# 课次文件夹模式：档案名 + " Lesson " + 数字
LESSON_FOLDER_RE = re.compile(r'^(.+)\s+Lesson\s+(\d+)$')

# Nav 文件名模式：档案名 + " Lesson " + 数字
LESSON_NAV_RE = re.compile(r'^(.+)\s+Lesson\s+(\d+)\.md$')

# 文件列表中的文件名
FILE_NAMES = {
    'note': 'Note',
    'wordlist': 'Wordlist',
    'grammar': 'Grammar Note',
    'homework': 'Homework',
    'quiz': 'Quiz',
    'feedback': 'Feedback',
}


def find_archive_folders():
    """找到所有档案文件夹（只检查直接子目录，不递归进入课次文件夹）"""
    archives = []
    # 只遍历 working/ 下的直接子目录（Archived/, Current Class/ 等）
    for top_dir in WORKING_DIR.iterdir():
        if not top_dir.is_dir():
            continue
        # 在每个顶层目录下递归查找档案
        for root, dirs, files in os.walk(top_dir):
            root_path = Path(root)
            # 跳过课次文件夹（名称包含 " Lesson "）
            if " Lesson " in root_path.name:
                dirs.clear()  # 不进入课次文件夹的子目录
                continue
            for file in files:
                if file.endswith('.md'):
                    # 检查是否是档案首页（文件名与父文件夹名相同）
                    if file[:-3] == root_path.name:
                        archives.append(root_path)
                        break
    return archives


def find_lessons(archive_folder):
    """找到所有课次文件夹，按课次号排序"""
    lessons = []
    for item in archive_folder.iterdir():
        if item.is_dir():
            m = LESSON_FOLDER_RE.match(item.name)
            if m:
                lesson_num = int(m.group(2))
                lessons.append((lesson_num, item))
    lessons.sort(key=lambda x: x[0])
    return lessons


def read_frontmatter(content):
    """解析 frontmatter"""
    if not content.startswith('---'):
        return None, content
    end = content.find('---', 3)
    if end == -1:
        return None, content
    fm_text = content[3:end].strip()
    body = content[end + 3:]
    return fm_text, body


def get_date_from_frontmatter(fm_text):
    """从 frontmatter 提取日期"""
    m = re.search(r'Date:\s*(\d{4}-\d{2}-\d{2})', fm_text)
    if m:
        return m.group(1)
    return None


def get_kind_from_frontmatter(fm_text):
    """从 frontmatter 提取 kind（class/vip）"""
    m = re.search(r'tags:\s*\n((?:\s*-\s*"[^"]*"\s*\n)*)', fm_text)
    if m:
        tags = m.group(1)
        if '#vip' in tags:
            return 'vip'
        elif '#class' in tags:
            return 'class'
    return 'class'


def fix_archive_index(archive_md, lessons):
    """修复档案页的课程索引"""
    content = archive_md.read_text(encoding='utf-8')
    fm_text, body = read_frontmatter(content)
    if fm_text is None:
        return

    kind = get_kind_from_frontmatter(fm_text)

    # 找到课程索引区域
    index_header = "## 📚 课程索引"
    test_header = "## 📋 测试反馈"

    index_start = body.find(index_header)
    if index_start == -1:
        print(f"  ⚠️ 未找到课程索引: {archive_md.name}")
        return

    test_start = body.find(test_header, index_start)
    if test_start == -1:
        index_section = body[index_start:]
        after_index = ""
    else:
        index_section = body[index_start:test_start]
        after_index = body[test_start:]

    # 重建课程索引
    lines = [index_header, ""]

    # 保留课程类型子标题（如果有）
    course_type_blocks = re.findall(r'### 🏷️\s+(.+?)\n', index_section)
    if course_type_blocks:
        # 有课程类型分组
        # 找到所有课次链接
        lesson_links = re.findall(r'-\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]', index_section)

        # 按课程类型分组重建
        # 简化处理：直接生成所有课次链接
        for lesson_num, lesson_folder in lessons:
            nav_file = lesson_folder / (lesson_folder.name + ".md")
            if nav_file.exists():
                nav_content = nav_file.read_text(encoding='utf-8')
                nav_fm, _ = read_frontmatter(nav_content)
                date_str = get_date_from_frontmatter(nav_fm) if nav_fm else None

                if kind == 'class':
                    label = f" Lesson {lesson_num}"
                else:
                    label = f"第 {lesson_num} 课"

                if date_str:
                    label += f" - {date_str}"

                lines.append(f"- [[./{lesson_folder.name}/{lesson_folder.name}|{label}]]")
    else:
        # 没有课程类型分组，直接生成
        for lesson_num, lesson_folder in lessons:
            nav_file = lesson_folder / (lesson_folder.name + ".md")
            if nav_file.exists():
                nav_content = nav_file.read_text(encoding='utf-8')
                nav_fm, _ = read_frontmatter(nav_content)
                date_str = get_date_from_frontmatter(nav_fm) if nav_fm else None

                if kind == 'class':
                    label = f"📖 Lesson {lesson_num}"
                else:
                    label = f"第 {lesson_num} 课"

                if date_str:
                    label += f" - {date_str}"

                lines.append(f"- [[./{lesson_folder.name}/{lesson_folder.name}|{label}]]")

    # 重建 body
    new_body = body[:index_start] + "\n".join(lines) + "\n\n---\n\n" + after_index

    archive_md.write_text("---\n" + fm_text + "\n---\n" + new_body, encoding='utf-8')
    print(f"  ✅ 修复档案索引：{archive_md.name} ({len(lessons)} 课)")


def fix_nav_links(lesson_folder, archive_name, all_lessons):
    """修复课次 Nav 文件的链接"""
    nav_file = lesson_folder / (lesson_folder.name + ".md")
    if not nav_file.exists():
        return

    content = nav_file.read_text(encoding='utf-8')
    fm_text, body = read_frontmatter(content)
    if fm_text is None:
        return

    # 统一课程类型名称
    fm_text = normalize_course_type(fm_text)
        return

    # 解析当前课次号
    m = LESSON_NAV_RE.match(nav_file.name)
    if not m:
        return
    current_num = int(m.group(2))

    # 修复 frontmatter 中的 links 字段
    new_fm_lines = []
    in_links = False
    for line in fm_text.split('\n'):
        if line.strip().startswith('links:'):
            in_links = True
            new_fm_lines.append(line)
            continue

        if in_links:
            if line.strip().startswith('- "[['):
                # 这是 links 列表项，跳过（后面重新生成）
                continue
            elif line.strip() and not line.startswith('  ') and not line.startswith('\t'):
                # links 字段结束
                in_links = False
                # 重新生成 links
                new_fm_lines.extend(generate_links(archive_name, current_num, all_lessons))
                new_fm_lines.append(line)
            else:
                # 空行或其他，links 结束
                if not line.strip():
                    in_links = False
                    new_fm_lines.extend(generate_links(archive_name, current_num, all_lessons))
                new_fm_lines.append(line)
        else:
            new_fm_lines.append(line)

    # 如果 links 在末尾
    if in_links:
        new_fm_lines.extend(generate_links(archive_name, current_num, all_lessons))

    new_fm_text = '\n'.join(new_fm_lines)

    # 修复正文中的文件列表链接
    new_body = fix_body_links(body, current_num)

    nav_file.write_text("---\n" + new_fm_text + "\n---\n" + new_body, encoding='utf-8')
    print(f"  ✅ 修复 Nav: {nav_file.name}")


def generate_links(archive_name, current_num, all_lessons):
    """生成 frontmatter links"""
    links = []

    # 上一课
    if current_num > 1:
        prev_num = current_num - 1
        links.append(f'  - "[[../{archive_name} Lesson {prev_num}/{archive_name} Lesson {prev_num}|⬅️ 上一课]]"')

    # 档案首页
    links.append(f'  - "[[../{archive_name}| 档案首页]]"')

    # 下一课
    if current_num < len(all_lessons):
        next_num = current_num + 1
        links.append(f'  - "[[../{archive_name} Lesson {next_num}/{archive_name} Lesson {next_num}|➡️ 下一课]]"')

    return links


def fix_body_links(body, lesson_num):
    """修复正文中的文件列表链接"""
    # 替换绝对路径链接为相对路径
    # 匹配 [[Archived/.../Note N|...]] 或 [[./Note N|...]] 或 [[Note N|...]]
    def replace_link(match):
        full_match = match.group(0)
        target = match.group(1)
        alias = match.group(2) if match.group(2) else ""

        # 提取文件名（最后一个 / 后面的部分）
        if '/' in target:
            filename = target.split('/')[-1]
        else:
            filename = target

        # 检查是否是课次内文件
        file_types = ['Note', 'Wordlist', 'Grammar Note', 'Homework', 'Quiz', 'Feedback']
        for ft in file_types:
            if filename.startswith(ft):
                if alias:
                    return f"[[./{filename}|{alias}]]"
                else:
                    return f"[[./{filename}]]"

        return full_match

    # 匹配 [[target|alias]] 或 [[target]]
    link_pattern = re.compile(r'\[\[([^\]|]+)(?:\|([^\]]+))?\]\]')
    new_body = link_pattern.sub(replace_link, body)

    return new_body


def main():
    print("开始修复档案链接...\n")

    archives = find_archive_folders()
    print(f"找到 {len(archives)} 个档案文件夹\n")

    for archive_folder in archives:
        # 显示相对路径，方便确认处理的是哪个目录下的档案
        rel_path = archive_folder.relative_to(WORKING_DIR)
        print(f"📁 处理：{rel_path} ({archive_folder.name})")
        archive_md = archive_folder / (archive_folder.name + ".md")

        lessons = find_lessons(archive_folder)
        if not lessons:
            print(f"  ️ 未找到课次文件夹")
            continue

        # 修复档案页索引
        fix_archive_index(archive_md, lessons)

        # 修复每个课次 Nav
        for lesson_num, lesson_folder in lessons:
            fix_nav_links(lesson_folder, archive_folder.name, lessons)

        print()

    print("✅ 全部完成!")


if __name__ == "__main__":
    main()
