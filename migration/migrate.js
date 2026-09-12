const fs = require('fs');
const path = require('path');

const OLD_BASE = 'x:\\AI\\projects\\XDF-obsidian-system\\obsidian-plugin\\obsidian-plugin-XDF-tookits\\migration\\Archived old';
const NEW_BASE = 'D:\\Schleiden\\Obsidian_Vault\\XDF_Vault\\Current Class';

const ARCHIVE_NAME = process.argv[2];
const LESSONS = parseInt(process.argv[3]);
const IS_VIP = process.argv[4] === 'vip';
const SOURCE_OVERRIDE = process.argv[5];

if (!ARCHIVE_NAME || !LESSONS) {
  console.log('Usage: node migrate.js <archive_name> <lessons> [vip] [source_dir]');
  process.exit(1);
}

function resolveOldRoot(name) {
  if (SOURCE_OVERRIDE) {
    const p = path.join(OLD_BASE, SOURCE_OVERRIDE);
    if (!fs.existsSync(p)) {
      console.error('Source dir not found: ' + p);
      process.exit(1);
    }
    return p;
  }
  const direct = path.join(OLD_BASE, name);
  if (fs.existsSync(direct)) return direct;
  const entries = fs.readdirSync(OLD_BASE);
  const hit = entries.find(e => e === name || e.startsWith(name + ' '));
  if (hit) return path.join(OLD_BASE, hit);
  console.error('Old archive not found: ' + name);
  process.exit(1);
}

const OLD_ROOT = resolveOldRoot(ARCHIVE_NAME);
const NEW_ROOT = path.join(NEW_BASE, ARCHIVE_NAME);

console.log('Migrating ' + ARCHIVE_NAME + ' (' + LESSONS + ' lessons, ' + (IS_VIP ? 'VIP' : 'Class') + ')');
console.log('Old root: ' + OLD_ROOT);
console.log('New root: ' + NEW_ROOT);

const STRUCTURED_FIELDS = ['作业情况', '入门测情况', '课堂表现', '掌握情况', '需要加强'];

function hasStructuredFields(text) {
  return STRUCTURED_FIELDS.some(f => new RegExp('#{3,4} ' + f + '(?:\\r?\\n|$)').test(text));
}

function isMeaningful(text) {
  if (!text) return false;
  const t = String(text)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}\s+[^\n]*$/gm, '')
    .replace(/^[-—*]\s*$/gm, '')
    .replace(/\r/g, '')
    .trim();
  return t.length > 0;
}

function extractField(text, field) {
  const re = new RegExp('#{3,4} ' + field + '\\r?\\n([\\s\\S]*?)(?=\\r?\\n#{2,4}\\s|$)');
  const m = text.match(re);
  return m ? m[1] : null;
}

function extractH3Field(text, field) {
  const re = new RegExp('### ' + field + '\\r?\\n([\\s\\S]*?)(?=\\r?\\n###\\s|\\r?\\n##\\s|$)');
  const m = text.match(re);
  return m ? m[1] : null;
}

function extractAiBlock(text) {
  const m = text.match(/(<!-- AI_GENERATED_START -->[\s\S]*?<!-- AI_GENERATED_END -->)/);
  return m ? m[1] : null;
}

function replaceFieldContent(studentBlock, field, newContent) {
  const re = new RegExp('(#### ' + field + ')\\r?\\n[\\s\\S]*?(?=\\r?\\n#### |\\r?\\n### 反馈总结|\\r?\\n## |$)');
  return studentBlock.replace(re, '$1\n' + newContent);
}

function appendAfterCheckbox(studentBlock, field, newContent) {
  const re = new RegExp('(#### ' + field + '\\r?\\n[^\\n]+\\r?\\n)');
  const m = studentBlock.match(re);
  if (m) {
    return studentBlock.replace(re, '$1\n' + newContent);
  }
  return replaceFieldContent(studentBlock, field, newContent);
}

function replaceAiBlock(studentBlock, aiBlock) {
  return studentBlock.replace(
    /<!-- AI_GENERATED_START -->[\s\S]*?<!-- AI_GENERATED_END -->/,
    aiBlock
  );
}

function replaceStudentBlock(content, student, newBlock) {
  const escaped = student.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('## 👤 ' + escaped + '\\r?\\n[\\s\\S]*?(?=\\r?\\n## 👤 |$)');
  return content.replace(re, newBlock);
}

function extractSection(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('## ' + escaped + '\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)');
  const m = text.match(re);
  return m ? m[1] : null;
}

function replaceSection(content, heading, newContent) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(## ' + escaped + '\\r?\\n)[\\s\\S]*?(?=\\r?\\n## |$)');
  return content.replace(re, '$1' + newContent);
}

function alreadyHas(haystack, needle) {
  if (!needle) return true;
  return haystack.replace(/\r\n/g, '\n').includes(needle.replace(/\r\n/g, '\n').trim());
}

function copyPath(from, to) {
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      copyPath(path.join(from, name), path.join(to, name));
    }
  } else {
    const dir = path.dirname(to);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(from, to);
  }
}

function extractHwContent(oldHwSection) {
  const cleaned = oldHwSection.replace(/<!--[\s\S]*?-->/g, '');
  const oldLines = cleaned.split(/\r?\n/);
  const labelIdx = oldLines.findIndex(l =>
    /今日.*作业/.test(l) || /\d+月\d+日第\d+次.*作业/.test(l)
  );
  if (labelIdx >= 0) {
    return oldLines.slice(labelIdx + 1).join('\n').trim();
  }
  const cbIdx = oldLines.findIndex(l => l.includes('发送作业'));
  if (cbIdx >= 0) {
    for (let i = cbIdx + 1; i < oldLines.length; i++) {
      const line = oldLines[i];
      if (!line.trim()) continue;
      if (line.includes('作业') && /[：:]/.test(line)) {
        return oldLines.slice(i + 1).join('\n').trim();
      }
    }
    return oldLines.slice(cbIdx + 1).join('\n').trim();
  }
  return cleaned.trim();
}

for (let n = 1; n <= LESSONS; n++) {
  const oldDir = path.join(OLD_ROOT, ARCHIVE_NAME + ' Lesson ' + n);
  const newDir = path.join(NEW_ROOT, ARCHIVE_NAME + ' Lesson ' + n);

  console.log('\n=== Lesson ' + n + ' ===');

  const oldFbPath = path.join(oldDir, 'Feedback ' + n + '.md');
  const newFbPath = path.join(newDir, 'Feedback ' + n + '.md');

  if (fs.existsSync(oldFbPath) && fs.existsSync(newFbPath)) {
    let oldFb = fs.readFileSync(oldFbPath, 'utf-8');
    let newFb = fs.readFileSync(newFbPath, 'utf-8');

    const studentRe = /## 👤 ([^\n\r]+)/g;
    let m;
    const students = [];
    while ((m = studentRe.exec(newFb)) !== null) {
      students.push(m[1].trim());
    }

    const oldHasStudentHeading = /## 👤 /.test(oldFb);

    for (const student of students) {
      const escaped = student.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const stuRe = new RegExp('## 👤 ' + escaped + '\\r?\\n([\\s\\S]*?)(?=\\r?\\n## 👤 |$)');
      const stuMatch = oldFb.match(stuRe);

      let oldStuBlock = null;
      if (stuMatch) {
        oldStuBlock = stuMatch[0];
      } else if (!oldHasStudentHeading && oldFb.trim()) {
        oldStuBlock = oldFb;
      } else {
        console.log('  [跳过] ' + student + ' (老档案无此人)');
        continue;
      }

      const newStuMatch = newFb.match(stuRe);
      if (!newStuMatch) continue;
      let newStuBlock = newStuMatch[0];
      let changed = false;

      if (/#### 课堂表现\r?\n[\s\S]*?### (作业情况|课堂表现|掌握情况|需要加强|完整反馈)/.test(newStuBlock)) {
        newStuBlock = replaceFieldContent(newStuBlock, '课堂表现', '\n');
        changed = true;
      }

      if (n > 1) {
        const hw = extractField(oldStuBlock, '作业情况');
        if (hw && isMeaningful(hw) && !alreadyHas(newStuBlock, hw.trim())) {
          newStuBlock = appendAfterCheckbox(newStuBlock, '作业情况', hw);
          changed = true;
        }
      }

      const quizField = extractField(oldStuBlock, '入门测情况');
      if (quizField && isMeaningful(quizField) && !alreadyHas(newStuBlock, quizField.trim())) {
        newStuBlock = replaceFieldContent(newStuBlock, '入门测情况', quizField);
        changed = true;
      }

      const perf = extractField(oldStuBlock, '课堂表现');
      if (perf && isMeaningful(perf) && !alreadyHas(newStuBlock, perf.trim())) {
        newStuBlock = replaceFieldContent(newStuBlock, '课堂表现', perf);
        changed = true;
      }

      const mastery = extractField(oldStuBlock, '掌握情况');
      if (mastery && isMeaningful(mastery) && !alreadyHas(newStuBlock, mastery.trim())) {
        newStuBlock = replaceFieldContent(newStuBlock, '掌握情况', mastery);
        changed = true;
      }

      const improve = extractField(oldStuBlock, '需要加强');
      if (improve && isMeaningful(improve) && !alreadyHas(newStuBlock, improve.trim())) {
        newStuBlock = replaceFieldContent(newStuBlock, '需要加强', improve);
        changed = true;
      }

      if (!hasStructuredFields(oldStuBlock)) {
        const rawM = oldStuBlock.match(/### 原始记录\r?\n([\s\S]*?)(?=\r?\n### |$)/);
        let blob = rawM ? rawM[1].trim() : '';
        if (!blob) {
          blob = oldStuBlock
            .replace(/^## 👤 [^\n]+\r?\n/, '')
            .replace(/### 反馈总结[\s\S]*$/, '')
            .replace(/<!-- AI_GENERATED_START -->[\s\S]*?<!-- AI_GENERATED_END -->/g, '')
            .trim();
        }
        if (blob && isMeaningful(blob) && !alreadyHas(newStuBlock, blob)) {
          newStuBlock = replaceFieldContent(newStuBlock, '课堂表现', blob + '\n\n');
          changed = true;
        }
      }

      const aiBlock = extractAiBlock(oldStuBlock);
      if (aiBlock && !aiBlock.includes('待生成')) {
        newStuBlock = replaceAiBlock(newStuBlock, aiBlock);
        changed = true;
      }

      if (changed) {
        newFb = replaceStudentBlock(newFb, student, newStuBlock);
        console.log('  [写入] ' + student);
      }
    }

    fs.writeFileSync(newFbPath, newFb, 'utf-8');
    console.log('  Feedback ' + n + '.md ✓');
  }

  const oldNavPath = path.join(oldDir, ARCHIVE_NAME + ' Lesson ' + n + '.md');
  const newNavPath = path.join(newDir, ARCHIVE_NAME + ' Lesson ' + n + '.md');

  if (fs.existsSync(oldNavPath) && fs.existsSync(newNavPath)) {
    let oldNav = fs.readFileSync(oldNavPath, 'utf-8');
    let newNav = fs.readFileSync(newNavPath, 'utf-8');

    let oldClassFb = extractSection(oldNav, '📝 班级反馈');
    if (!oldClassFb) oldClassFb = extractSection(oldNav, '📝 学员反馈');
    if (oldClassFb) {
      const oldRaw = extractH3Field(oldClassFb, '原始记录');
      const oldAi = extractAiBlock(oldClassFb);
      const oldCbMatch = oldClassFb.match(/- \[([ xX])\] 提交反馈/);
      const oldCbState = oldCbMatch ? oldCbMatch[1] : ' ';

      let newClassFb = extractSection(newNav, '📝 课堂反馈') || '';

      if (oldCbState === 'x' || oldCbState === 'X') {
        newClassFb = newClassFb.replace(/- \[ \] 提交反馈/, '- [x] 提交反馈');
      }

      if (oldRaw && oldRaw.trim()) {
        newClassFb = newClassFb.replace(
          /(### 原始记录\r?\n)[\s\S]*?(?=### )/,
          '$1' + oldRaw.trim() + '\n\n\n'
        );
      }

      if (oldAi && !oldAi.includes('待生成')) {
        newClassFb = newClassFb.replace(
          /<!-- AI_GENERATED_START -->[\s\S]*?<!-- AI_GENERATED_END -->/,
          oldAi
        );
      }

      newNav = replaceSection(newNav, '📝 课堂反馈', newClassFb);
      console.log('  Nav: 课堂反馈 ✓');
    }

    const teaching = extractField(oldNav, '授课内容');
    if (teaching && teaching.trim()) {
      newNav = replaceFieldContent(newNav, '授课内容', teaching);
      console.log('  Nav: 授课内容 ✓');
    }

    let oldHwSection = extractSection(oldNav, '✍️ 作业记录');
    if (!oldHwSection) oldHwSection = extractSection(oldNav, '✍️作业记录');
    if (!oldHwSection) oldHwSection = extractSection(oldNav, '作业记录');

    if (oldHwSection) {
      oldHwSection = oldHwSection.replace(/\r?\n---\s*$/, '');
      const oldHwCbMatch = oldHwSection.match(/- \[([ xX])\] 发送作业/);
      const oldHwCbState = oldHwCbMatch ? oldHwCbMatch[1] : ' ';
      const hwContent = extractHwContent(oldHwSection);

      let newHwSection = extractSection(newNav, '✍️作业记录');
      if (!newHwSection) newHwSection = extractSection(newNav, '✍️ 作业记录');

      if (newHwSection) {
        newHwSection = newHwSection.replace(/\r?\n---\s*$/, '');
        const newLines = newHwSection.split(/\r?\n/);
        const newCbIdx = newLines.findIndex(l => l.includes('发送作业'));

        if (newCbIdx >= 0 && (oldHwCbState === 'x' || oldHwCbState === 'X')) {
          newLines[newCbIdx] = newLines[newCbIdx].replace('[ ]', '[x]');
        }

        if (hwContent && !alreadyHas(newHwSection, hwContent)) {
          for (let i = 0; i < newLines.length; i++) {
            if (/\d+月\d+日第\d+次.*作业[：:]/.test(newLines[i])) {
              newLines.splice(i + 1, 0, hwContent);
              break;
            }
          }
        }

        const result = newLines.join('\n') + '\n\n---\n';
        newNav = replaceSection(newNav, '✍️作业记录', result);
        console.log('  Nav: 作业记录 ✓');
      }
    }

    fs.writeFileSync(newNavPath, newNav, 'utf-8');
    console.log('  ' + ARCHIVE_NAME + ' Lesson ' + n + '.md ✓');
  }

  if (fs.existsSync(oldDir) && fs.existsSync(newDir)) {
    const skip = new Set([
      ARCHIVE_NAME + ' Lesson ' + n + '.md',
      'Feedback ' + n + '.md',
    ]);
    for (const f of fs.readdirSync(oldDir)) {
      if (skip.has(f)) continue;
      try {
        copyPath(path.join(oldDir, f), path.join(newDir, f));
        console.log('  ' + f + ' ✓');
      } catch (e) {
        console.log('  [复制失败] ' + f + ': ' + e.message);
      }
    }
  }
}

if (fs.existsSync(OLD_ROOT) && fs.existsSync(NEW_ROOT)) {
  for (const f of fs.readdirSync(OLD_ROOT)) {
    if (f === ARCHIVE_NAME + '.md') continue;
    if (f.startsWith(ARCHIVE_NAME + ' Lesson ')) continue;
    try {
      copyPath(path.join(OLD_ROOT, f), path.join(NEW_ROOT, f));
      console.log('Extra: ' + f + ' ✓');
    } catch (e) {
      console.log('Extra [复制失败] ' + f + ': ' + e.message);
    }
  }
}

console.log('\n=== ' + ARCHIVE_NAME + ' 迁移完成 ===');
