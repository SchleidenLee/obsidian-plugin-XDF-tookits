const fs = require('fs');
const path = require('path');

const OLD_BASE = 'x:\\AI\\projects\\XDF-obsidian-system\\obsidian-plugin\\obsidian-plugin-XDF-tookits\\migration\\Archived old\\3320';
const NEW_BASE = 'D:\\Schleiden\\Obsidian_Vault\\XDF_Vault\\Current Class\\3320';
const LESSONS = 8;

// === 提取 #### 字段内容（到下一个 ####/###/## 为止） ===
function extractField(text, field) {
  const re = new RegExp('#### ' + field + '\\r?\\n([\\s\\S]*?)(?=\\r?\\n#{2,4}\\s|$)');
  const m = text.match(re);
  return m ? m[1] : null;
}

// === 提取 ### 字段内容（到下一个 ###/## 为止） ===
function extractH3Field(text, field) {
  const re = new RegExp('### ' + field + '\\r?\\n([\\s\\S]*?)(?=\\r?\\n###\\s|\\r?\\n##\\s|$)');
  const m = text.match(re);
  return m ? m[1] : null;
}

// === 提取 AI_GENERATED 块 ===
function extractAiBlock(text) {
  const m = text.match(/(<!-- AI_GENERATED_START -->[\s\S]*?<!-- AI_GENERATED_END -->)/);
  return m ? m[1] : null;
}

// === 替换学生区块内指定字段的内容（保留 heading，替换内容） ===
function replaceFieldContent(studentBlock, field, newContent) {
  const re = new RegExp('(#### ' + field + ')\\r?\\n[\\s\\S]*?(?=\\r?\\n#{2,4}\\s|$)');
  return studentBlock.replace(re, '$1\n' + newContent);
}

// === 在 checkbox 行后追加内容（不覆盖 checkbox） ===
function appendAfterCheckbox(studentBlock, field, newContent) {
  const re = new RegExp('(#### ' + field + '\\r?\\n[^\\n]+\\r?\\n)');
  const m = studentBlock.match(re);
  if (m) {
    return studentBlock.replace(re, '$1\n' + newContent);
  }
  return replaceFieldContent(studentBlock, field, newContent);
}

// === 替换 AI_GENERATED 块 ===
function replaceAiBlock(studentBlock, aiBlock) {
  return studentBlock.replace(
    /<!-- AI_GENERATED_START -->[\s\S]*?<!-- AI_GENERATED_END -->/,
    aiBlock
  );
}

// === 替换学生区块 ===
function replaceStudentBlock(content, student, newBlock) {
  const escaped = student.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('## 👤 ' + escaped + '\\r?\\n[\\s\\S]*?(?=\\r?\\n## 👤 |$)');
  return content.replace(re, newBlock);
}

// === 提取 section 内容（## heading 到下一个同级 heading） ===
function extractSection(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('## ' + escaped + '\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)');
  const m = text.match(re);
  return m ? m[1] : null;
}

// === 替换 section 内容（保留 heading，替换到下一个 ## 之前的内容） ===
function replaceSection(content, heading, newContent) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(## ' + escaped + '\\r?\\n)[\\s\\S]*?(?=\\r?\\n## |$)');
  return content.replace(re, '$1' + newContent);
}

// === 主流程 ===
for (let n = 1; n <= LESSONS; n++) {
  const oldDir = path.join(OLD_BASE, '3320 Lesson ' + n);
  const newDir = path.join(NEW_BASE, '3320 Lesson ' + n);

  console.log('\n=== Lesson ' + n + ' ===');

  // 1. Feedback 迁移
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

    for (const student of students) {
      const escaped = student.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const stuRe = new RegExp('## 👤 ' + escaped + '\\r?\\n([\\s\\S]*?)(?=\\r?\\n## 👤 |$)');
      const stuMatch = oldFb.match(stuRe);
      if (!stuMatch) {
        console.log('  [跳过] ' + student + ' (老档案无此人)');
        continue;
      }
      const oldStuBlock = stuMatch[0];

      const newStuMatch = newFb.match(stuRe);
      if (!newStuMatch) continue;
      let newStuBlock = newStuMatch[0];

      let changed = false;

      if (n > 1) {
        const hw = extractField(oldStuBlock, '作业情况');
        if (hw && hw.trim() && hw.trim() !== '-') {
          newStuBlock = appendAfterCheckbox(newStuBlock, '作业情况', hw);
          changed = true;
        }
      }

      const perf = extractField(oldStuBlock, '课堂表现');
      if (perf && perf.trim() && perf.trim() !== '-') {
        newStuBlock = replaceFieldContent(newStuBlock, '课堂表现', perf);
        changed = true;
      }

      const mastery = extractField(oldStuBlock, '掌握情况');
      if (mastery && mastery.trim() && mastery.trim() !== '-') {
        newStuBlock = replaceFieldContent(newStuBlock, '掌握情况', mastery);
        changed = true;
      }

      const improve = extractField(oldStuBlock, '需要加强');
      if (improve && improve.trim() && improve.trim() !== '-') {
        newStuBlock = replaceFieldContent(newStuBlock, '需要加强', improve);
        changed = true;
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

  // 2. Nav 文件迁移
  const oldNavPath = path.join(oldDir, '3320 Lesson ' + n + '.md');
  const newNavPath = path.join(newDir, '3320 Lesson ' + n + '.md');

  if (fs.existsSync(oldNavPath) && fs.existsSync(newNavPath)) {
    let oldNav = fs.readFileSync(oldNavPath, 'utf-8');
    let newNav = fs.readFileSync(newNavPath, 'utf-8');

    // === 班级反馈 section ===
    const oldClassFb = extractSection(oldNav, '📝 班级反馈');
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
      console.log('  Nav: 班级反馈 ✓');
    }

    // === 授课内容 ===
    const teaching = extractField(oldNav, '授课内容');
    if (teaching && teaching.trim()) {
      newNav = replaceFieldContent(newNav, '授课内容', teaching);
      console.log('  Nav: 授课内容 ✓');
    }

    // === 作业记录 ===
    let oldHwSection = extractSection(oldNav, '✍️ 作业记录');
    if (!oldHwSection) oldHwSection = extractSection(oldNav, '✍️作业记录');
    
    if (oldHwSection) {
      // 去掉末尾的 --- 分割线
      oldHwSection = oldHwSection.replace(/\r?\n---\s*$/, '');
      
      const oldHwCbMatch = oldHwSection.match(/- \[([ xX])\] 发送作业/);
      const oldHwCbState = oldHwCbMatch ? oldHwCbMatch[1] : ' ';
      
      const oldLines = oldHwSection.split(/\r?\n/);
      const oldCbIdx = oldLines.findIndex(l => l.includes('发送作业'));
      let hwContent = '';
      if (oldCbIdx >= 0) {
        for (let i = oldCbIdx + 1; i < oldLines.length; i++) {
          const line = oldLines[i];
          if (!line.trim()) continue;
          if (line.includes('作业') && line.includes('：')) {
            hwContent = oldLines.slice(i + 1).join('\n').trim();
            break;
          }
        }
      }
      
      let newHwSection = extractSection(newNav, '✍️作业记录');
      if (!newHwSection) newHwSection = extractSection(newNav, '✍️ 作业记录');
      
      if (newHwSection) {
        // 去掉末尾的 --- 分割线
        newHwSection = newHwSection.replace(/\r?\n---\s*$/, '');
        
        const newLines = newHwSection.split(/\r?\n/);
        const newCbIdx = newLines.findIndex(l => l.includes('发送作业'));
        
        if (newCbIdx >= 0 && (oldHwCbState === 'x' || oldHwCbState === 'X')) {
          newLines[newCbIdx] = newLines[newCbIdx].replace('[ ]', '[x]');
        }
        
        if (hwContent) {
          for (let i = 0; i < newLines.length; i++) {
            const line = newLines[i];
            if (/\d+月\d+日第\d+次.*作业[：:]/.test(line)) {
              newLines.splice(i + 1, 0, hwContent);
              break;
            }
          }
        }
        
        // 重新加上 --- 分割线
        const result = newLines.join('\n') + '\n\n---\n';
        newNav = replaceSection(newNav, '✍️作业记录', result);
        console.log('  Nav: 作业记录 ✓');
      }
    }

    fs.writeFileSync(newNavPath, newNav, 'utf-8');
    console.log('  3320 Lesson ' + n + '.md ✓');
  }

  // 3. 其他文件直接复制
  for (const prefix of ['Note', 'Wordlist', 'Grammar Note', 'Homework', 'Quiz']) {
    const oldFile = path.join(oldDir, prefix + ' ' + n + '.md');
    const newFile = path.join(newDir, prefix + ' ' + n + '.md');
    if (fs.existsSync(oldFile) && fs.existsSync(newFile)) {
      const content = fs.readFileSync(oldFile, 'utf-8');
      fs.writeFileSync(newFile, content, 'utf-8');
      console.log('  ' + prefix + ' ' + n + '.md ✓');
    }
  }
}

console.log('\n=== 3320 迁移完成 ===');
