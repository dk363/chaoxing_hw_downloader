# 超星学习通题目提取器

一键提取超星学习通作业/章节测验/考试的题目、选项、答案，自动解密乱码字体，导出为 Markdown 格式（图片 base64 嵌入）。

## 致谢

本脚本基于 [2281046977](https://github.com/2281046977/Chaoxing-Exam-Extractor) 的 **超星学习通考试/测验题目提取 (完整解密+导出Word/TXT) v4.6** 改进，在原版基础上增加了 Markdown 导出、图片表格支持、简答题提取等功能。感谢原作者的精妙实现。

## 功能

- **多页面支持**: 章节测验、考试、作业详情页
- **字体解密**: 自动解析 `font-cxsecret` 自定义字体，还原加密文本
- **图片嵌入**: 图片自动下载并转为 base64 嵌入 Markdown（原图 `data-original` 优先）
- **表格支持**: HTML 表格转为 Markdown 表格
- **题型覆盖**: 单选题、多选题、判断题、简答题（含图片答案）
- **纯净输出**: 只显示"正确答案"，不输出"我的答案"；隐藏元素自动过滤

## 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展
2. 打开 `chaoxing-extractor-md.user.js` 文件
3. Tampermonkey 会自动检测到用户脚本，点击"安装"
4. 打开任意超星学习通作业/测验/考试页面，左侧会出现按钮

## 使用

1. 进入学习通作业/测验/考试页面
2. 点击左侧 **📑 提取题目** 按钮预览 Markdown 内容
3. 点击 **复制 Markdown** 或 **导出 .md 文件**
4. 也可直接点击 **⬇️ 导出 MD** 跳过预览

## 导出格式

```markdown
# 学习通习题导出

> 导出时间: 2026-06-14 16:20

# 1
(单选题, 6分)从未排序序列中依次取出元素与已排序序列中的元素进行比较...

- A. 归并排序
- B. 冒泡排序
- C. 插入排序
- D. 选择排序

**正确答案: C**

---

# 13
(简答题, 18分)设待排序的关键字序列为...

**正确答案:**
![图片](data:image/...)
```

## 技术原理

- **字体解密**: 从页面 `<style>` 提取 `font-cxsecret` 的 base64 → Typr.js 解析 → 字形路径 MD5 查映射表 → 还原字符
- **图片处理**: 优先取 `data-original`（原图），通过 `GM_xmlhttpRequest` 下载后 `FileReader` 转 base64
- **DOM 转 Markdown**: 递归遍历 childNodes，处理 TEXT_NODE/IMG/TABLE/STRONG/EM/A 等节点
