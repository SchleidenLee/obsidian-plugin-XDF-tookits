"""分析所有档案中的 course_type 和 subject 字段分布"""

import os
import re
from pathlib import Path
from collections import Counter

ORIGINAL_DIR = Path(__file__).parent / "original"

course_types = Counter()
subjects = Counter()

for root, dirs, files in os.walk(ORIGINAL_DIR):
    for file in files:
        if file.endswith('.md'):
            path = Path(root) / file
            try:
                content = path.read_text(encoding='utf-8')
                # 提取 course_type
                ct_match = re.search(r'course_type:\s*\n((?:\s*-\s*["\']?[^"\'\n]+["\']?\s*\n)*)', content)
                if ct_match:
                    types = re.findall(r'-\s*["\']?([^"\'\n]+)["\']?', ct_match.group(1))
                    for t in types:
                        course_types[t.strip()] += 1

                # 提取 subject
                s_match = re.search(r'subject:\s*["\']?([^"\'\n]+)["\']?', content)
                if s_match:
                    subjects[s_match.group(1).strip()] += 1
            except:
                pass

print('=== course_type 分布 ===')
for k, v in course_types.most_common():
    print(f'{k}: {v}')

print('\n=== subject 分布 ===')
for k, v in subjects.most_common():
    print(f'{k}: {v}')
