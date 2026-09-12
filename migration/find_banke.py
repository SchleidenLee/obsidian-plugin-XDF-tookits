"""找到 course_type 为"班课"的档案"""

import os
import re
from pathlib import Path

ORIGINAL_DIR = Path(__file__).parent / "original"

for root, dirs, files in os.walk(ORIGINAL_DIR):
    for file in files:
        if file.endswith('.md'):
            path = Path(root) / file
            try:
                content = path.read_text(encoding='utf-8')
                ct_match = re.search(r'course_type:\s*\n((?:\s*-\s*["\']?[^"\'\n]+["\']?\s*\n)*)', content)
                if ct_match:
                    types = re.findall(r'-\s*["\']?([^"\'\n]+)["\']?', ct_match.group(1))
                    for t in types:
                        if t.strip() == '班课':
                            print(f'{path}')
            except:
                pass
