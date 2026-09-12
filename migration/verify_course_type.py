"""验证 working 目录中的 course_type 是否已全部统一"""

import os
import re
from pathlib import Path
from collections import Counter

WORKING_DIR = Path(__file__).parent / "working"

course_types = Counter()

for root, dirs, files in os.walk(WORKING_DIR):
    for file in files:
        if file.endswith('.md'):
            path = Path(root) / file
            try:
                content = path.read_text(encoding='utf-8')
                ct_match = re.search(r'course_type:\s*\n((?:\s*-\s*["\']?[^"\'\n]+["\']?\s*\n)*)', content)
                if ct_match:
                    types = re.findall(r'-\s*["\']?([^"\'\n]+)["\']?', ct_match.group(1))
                    for t in types:
                        course_types[t.strip()] += 1
            except:
                pass

print('=== working 目录 course_type 分布 ===')
for k, v in course_types.most_common():
    print(f'{k}: {v}')

# 检查是否还有旧的课程类型
old_types = {'初级讲义', '初级教材', '中级讲义', '中级教材', '班课'}
remaining = old_types & set(course_types.keys())
if remaining:
    print(f'\n⚠️ 仍有旧的课程类型：{remaining}')
else:
    print('\n✅ 所有课程类型已统一为 L1/L2 格式')
