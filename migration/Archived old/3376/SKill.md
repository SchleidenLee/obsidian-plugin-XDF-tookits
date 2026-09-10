---  
name: xdf-feedback-generator  
description: 根据行课记录生成班级反馈和学员反馈，并写入 Obsidian 笔记  
homepage: https://help.obsidian.md  
  
metadata:  
  openclaw:  
    emoji: 📝  
  
requires:  
  bins: ["obsidian-cli", "rg", "awk"]  
  
install:  
  - id: brew  
    kind: brew  
    formula: yakitrak/yakitrak/obsidian-cli  
    bins: ["obsidian-cli"]  
    label: Install obsidian-cli (brew)  
---  
    
# XDF Feedback Generator    
    
根据用户在反馈区域填写的原始记录，自动生成班级反馈和学员反馈，并替换写入 Obsidian 笔记。    
    
---    
    
## 文件结构示例  
  
/mnt/d/Schleiden/Obsidian/XDF/Current Class/  
├── 1111/ # 班级文件夹  
│ ├── 1111.md # 班级导航页  
│ └── 1111 Lesson 1/ # 课时文件夹  
│ ----├── 1111 Lesson 1.md # 课时导航页 (YAML: Date: YYYY-MM-DDTHH:MM)  
│---- ├── Feedback 1.md # 学员反馈（多个学员块，用 --- 分隔）  
│---- ├── Note 1.md # 课堂笔记  
│---- └── Homework 1.md # 课后作业  
  
---  
  
## 结构规则    
    
- `### 表示一个反馈块（班级或学员） 
- `<!-- AI_GENERATED_START -->` 表示 AI 生成内容开始    
- `<!-- AI_GENERATED_END -->` 表示 AI 生成内容结束    
- 学员块之间使用 `---` 分隔    
  
---  
  
## 笔记结构要求（必须遵守）  
  
为保证脚本正确提取原始记录，笔记必须满足以下结构：  
  
### 班级反馈  
  
- 原始记录必须写在 `AI_GENERATED_START` 之前    
- 原始记录必须使用 `- ` 作为列表前缀    
- `AI_GENERATED_START / END` 必须位于“反馈总结”部分    
  
示例：  
  
## 班级反馈  
  
### 原始记录  
- 出勤：8 人  
- 进度：完成 Unit 2  
- 问题：语法错误较多  
  
### 反馈总结  
<!-- AI_GENERATED_START -->  
待生成  
<!-- AI_GENERATED_END -->

---

### 学员反馈

- 每个学员使用 `## 姓名` 开头
    
- 原始记录必须位于 `AI_GENERATED_START` 之前
    
- 原始记录必须使用 `-` 列表格式
    
- 学员块之间必须使用 `---` 分隔
    

示例：

## 张三  
  
### 课堂表现  
- 积极参与讨论  
  
### 掌握情况  
- 基础较好  
  
### 需要加强  
- 词汇量不足  
  
### 完整反馈  
<!-- AI_GENERATED_START -->  
待生成  
<!-- AI_GENERATED_END -->  
  
---  
  
## 李四  
  
### 课堂表现  
- 参与较少  
  
### 掌握情况  
- 能跟上课堂  
  
### 需要加强  
- 定位能力  
  
### 完整反馈  
<!-- AI_GENERATED_START -->  
待生成  
<!-- AI_GENERATED_END -->

---

## 输入参数

- `--class <班级>`（可选）
    
- `--lesson <课时>`（可选）
    
- `--date <日期>`（可选）
    
- `--vault <vault>`（可选）
    

---

## 工作流程

1. 定位课时导航页（通过 Date）
    
2. 读取班级原始记录 → 生成班级反馈 → 写入
    
3. 读取 Feedback 文件
    
4. 遍历每个学员块：
    
    - 提取原始记录
        
    - 生成反馈
        
    - 写入对应块
        

---

## 搜索课时

rg "^Date: 2026-03-17" --type markdown -l "XDF/Current Class/"

---

## 通用内容检查函数


```bash
# 通用 check_content 函数 
## 参数：$1=文件路径，$2=最小行数（默认 2）  
## 返回：0=内容充足，1=内容不足  
check_content() {  
  local file="$1"  
  local min_lines="${2:-2}"  
    
  local raw_input=$(grep -B 100 "<!-- AI_GENERATED_START -->" "$file" | grep "^- " | sed 's/^- //')  
    
  if [ -z "$raw_input" ]; then  
    echo "错误：未找到原始记录"  
    return 1  
  fi  
    
  local line_count=$(echo "$raw_input" | wc -l)  
  if [ "$line_count" -lt "$min_lines" ]; then  
    echo "信息不足（当前 ${line_count} 条，最少需要 ${min_lines} 条），跳过生成"  
    return 1  
  fi  
    
  echo "$raw_input"  
  return 0  
}
```


---

## Prompt 模板

### 班级反馈

你是教学反馈生成助手。

任务：根据"班级原始记录"生成反馈。

要求：

- 严格基于提供信息，不得补充未提及内容
    
- 不得推测学生能力或态度
    
- 使用客观陈述语气
    
- 输出一段完整文本（200-250 字）
    
- 不使用列表
    

若信息少于 2 条，输出：  
信息不足，无法生成反馈。

原始记录：  
{{raw_input}}

---

### 学员反馈

你是教学反馈生成助手。

任务：根据"学员原始记录"生成反馈。

要求：

- 严格基于提供信息，不得补充未提及内容
    
- 不得推测学生能力或态度
    
- 使用客观陈述语气
    
- 输出一段完整文本（150-200 字）
    
- 不使用列表
    

若信息少于 2 条，输出：  
信息不足，无法生成反馈。

原始记录：  
{{raw_input}}

---

## 替换写入
```bash
replace_ai_content() {    
  local file="$1"    
  local content="$2"    
  local tmp_file=$(mktemp)    
    
  awk -v content="$content" '    
  BEGIN { in_block=0 }    
    
  /<!-- AI_.*_START -->/ {    
    print    
    print content    
    in_block=1    
    next    
  }    
    
  /<!-- AI_.*_END -->/ {    
    in_block=0    
    print    
    next    
  }    
    
  in_block { next }    
    
  { print }    
  ' "$file" > "$tmp_file" && mv "$tmp_file" "$file"    
}
```


---

## 注意事项

- 仅在 `AI_GENERATED_START / END` 之间写入内容
    
- 仅基于原始记录生成，不参考其他文件
    
- 输出必须为一整段文本
    
- 原始记录少于 2 条时输出固定提示
    
- 重复执行应覆盖旧内容，不追加内容