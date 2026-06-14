// ==UserScript==
// @name         超星学习通考试/测验题目提取 (Markdown导出+图片表格支持)
// @namespace    http://tampermonkey.net/
// @version      5.4
// @description  一键提取学习通作业/章节测验/考试的题目，自动解密乱码，支持图片和表格，导出Markdown格式（图片base64嵌入）
// @author       基于 2281046977 的 v4.6 改进
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @icon         http://pan-yz.chaoxing.com/favicon.ico
// @require      https://scriptcat.org/lib/668/1.0/TyprMd5.js
// @resource     Table https://www.forestpolice.org/ttf/2.0/table.json
// @grant        GM_getResourceText
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    let fontHashParams = null;
    let currentFontData = null;
    let fontLoaded = false;
    let imgBase64Map = null;

    const MAX_Z_INDEX = 2147483647;

    const styles = `
        #cx-tool-panel {
            position: fixed;
            top: 150px;
            left: 10px;
            z-index: ${MAX_Z_INDEX - 1};
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .cx-btn {
            background-color: #4CAF50;
            color: white;
            padding: 10px 15px;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            font-size: 14px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.2);
            font-family: "Microsoft YaHei", sans-serif;
            text-align: center;
            transition: all 0.3s;
        }
        .cx-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 8px rgba(0,0,0,0.25); }
        .cx-btn:active { transform: translateY(0); }
        .cx-btn.primary { background-color: #1890ff; }
        .cx-btn.success { background-color: #52c41a; }
        .cx-btn.warning { background-color: #faad14; }
        #cx-preview-modal {
            position: fixed;
            top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.6);
            backdrop-filter: blur(2px);
            z-index: ${MAX_Z_INDEX};
            display: none;
            justify-content: center;
            align-items: center;
        }
        .cx-modal-content {
            background: white;
            width: 800px;
            max-width: 90%;
            height: 85vh;
            padding: 24px;
            border-radius: 12px;
            display: flex;
            flex-direction: column;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
            animation: cxModalFadeIn 0.3s ease;
        }
        @keyframes cxModalFadeIn {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
        }
        .cx-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            border-bottom: 1px solid #eee;
            padding-bottom: 16px;
        }
        .cx-modal-title { font-size: 20px; font-weight: bold; color: #333; }
        .cx-close-btn {
            cursor: pointer;
            font-size: 28px;
            color: #999;
            line-height: 20px;
            transition: color 0.2s;
        }
        .cx-close-btn:hover { color: #333; }
        #cx-preview-text {
            flex: 1;
            width: 100%;
            resize: none;
            padding: 16px;
            border: 1px solid #d9d9d9;
            border-radius: 6px;
            font-family: Consolas, Monaco, "Courier New", monospace;
            font-size: 14px;
            line-height: 1.6;
            overflow-y: auto;
            background: #f9f9f9;
            color: #333;
        }
        #cx-preview-text:focus { outline: 2px solid #1890ff; border-color: transparent; }
        .cx-modal-footer {
            margin-top: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .cx-status-text {
            font-size: 13px;
            color: #666;
            background: #f0f0f0;
            padding: 4px 8px;
            border-radius: 4px;
        }
        .cx-btn-group {
            display: flex;
            gap: 12px;
        }
    `;

    // ============ Font Decryption ============

    function initDecryption() {
        try {
            const tableText = GM_getResourceText('Table');
            if (tableText) {
                fontHashParams = JSON.parse(tableText);
                console.log('ChaoxingExtractor: 字体映射表加载成功, 条目数:', Object.keys(fontHashParams).length);
            } else {
                console.warn('ChaoxingExtractor: 字体映射表为空');
            }
        } catch (e) {
            console.error('ChaoxingExtractor: 加载字体映射表失败', e);
        }
    }

    function parsePageFont() {
        const styles = document.getElementsByTagName('style');
        let fontBase64 = null;
        for (let style of styles) {
            const content = style.textContent;
            if (content.includes('font-cxsecret') && content.includes('base64,')) {
                const match = content.match(/base64,([\w\W]+?)'/);
                if (match && match[1]) {
                    fontBase64 = match[1];
                    break;
                }
            }
        }
        if (fontBase64) {
            try {
                const binary_string = window.atob(fontBase64);
                const len = binary_string.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binary_string.charCodeAt(i);
                }
                const font = Typr.parse(bytes)[0];
                currentFontData = font;
                fontLoaded = true;
                console.log('ChaoxingExtractor: 页面加密字体解析成功');
            } catch (e) {
                console.error('ChaoxingExtractor: 解析字体出错', e);
                fontLoaded = false;
            }
        } else {
            console.log('ChaoxingExtractor: 未在页面找到加密字体 (font-cxsecret) 或已无需解密');
            fontLoaded = false;
        }
    }

    function getMd5Fn() {
        if (typeof md5 === 'function') return md5;
        if (typeof Typr !== 'undefined' && typeof Typr.md5 === 'function') return Typr.md5;
        if (window.md5) return window.md5;
        return null;
    }

    function decryptText(text) {
        if (!text) return "";
        if (!fontHashParams || !currentFontData) return text;
        const md5Fn = getMd5Fn();
        if (!md5Fn) {
            console.warn('ChaoxingExtractor: 未找到MD5函数，无法解密');
            return text;
        }
        let result = "";
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const code = char.charCodeAt(0);
            try {
                const glyphIndex = Typr.U.codeToGlyph(currentFontData, code);
                if (glyphIndex > 0) {
                    const path = Typr.U.glyphToPath(currentFontData, glyphIndex);
                    if (path) {
                        const pathStr = JSON.stringify(path);
                        const hash = md5Fn(pathStr).slice(24);
                        let match = fontHashParams[hash];
                        if (match) {
                            if (typeof match === 'number') {
                                result += String.fromCharCode(match);
                            } else {
                                result += match;
                            }
                            continue;
                        }
                    }
                }
            } catch (e) {
                // Typr may throw for malformed glyph data; keep original char
            }
            result += char;
        }
        return result;
    }

    // ============ Image Preloading ============

    function fetchAsBase64(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'blob',
                onload: function(resp) {
                    if (resp.status >= 200 && resp.status < 300) {
                        const reader = new FileReader();
                        reader.onload = function() {
                            resolve(reader.result);
                        };
                        reader.onerror = function() {
                            reject(new Error('FileReader error'));
                        };
                        reader.readAsDataURL(resp.response);
                    } else {
                        reject(new Error('HTTP ' + resp.status));
                    }
                },
                onerror: function() {
                    reject(new Error('GM_xmlhttpRequest error'));
                }
            });
        });
    }

    async function preloadAllImages() {
        const imgs = document.querySelectorAll('.TiMu img, .questionLi img, .mark_answer img, .mark_answer_key img, .mark_fill img');
        const seen = new Set();
        const map = {};

        const urls = [];
        imgs.forEach(img => {
            const src = resolveUrl(img.getAttribute('data-original') || img.src || img.getAttribute('data-src') || '');
            if (src && !src.startsWith('data:') && !seen.has(src)) {
                seen.add(src);
                urls.push(src);
            }
        });

        if (urls.length === 0) return map;

        const results = await Promise.allSettled(urls.map(url => fetchAsBase64(url)));
        results.forEach((result, idx) => {
            if (result.status === 'fulfilled') {
                map[urls[idx]] = result.value;
            } else {
                console.warn('ChaoxingExtractor: 图片下载失败', urls[idx], result.reason);
            }
        });

        console.log('ChaoxingExtractor: 已下载', Object.keys(map).length, '/' , urls.length, '张图片');
        return map;
    }

    // ============ Markdown Conversion ============

    function resolveUrl(url) {
        if (!url) return '';
        if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) return url;
        try {
            return new URL(url, window.location.href).href;
        } catch {
            return url;
        }
    }

    function tableToMarkdown(table) {
        const rows = table.querySelectorAll('tr');
        if (rows.length === 0) return '';

        let maxCols = 0;
        rows.forEach(row => {
            const cells = row.querySelectorAll('th, td');
            maxCols = Math.max(maxCols, cells.length);
        });

        let headerRow = null;
        let dataRows = [];

        rows.forEach((row, idx) => {
            const cells = row.querySelectorAll('th, td');
            const rowData = Array.from(cells).map(c => decryptText(c.innerText.trim()));
            while (rowData.length < maxCols) rowData.push('');
            if (idx === 0 && (row.closest('thead') || row.querySelector('th'))) {
                headerRow = rowData;
            } else {
                dataRows.push(rowData);
            }
        });

        let md = '';
        if (headerRow) {
            md += '| ' + headerRow.join(' | ') + ' |\n';
            md += '| ' + headerRow.map(() => '---').join(' | ') + ' |\n';
        } else if (dataRows.length > 0) {
            const first = dataRows[0];
            md += '| ' + first.join(' | ') + ' |\n';
            md += '| ' + first.map(() => '---').join(' | ') + ' |\n';
            dataRows = dataRows.slice(1);
        }
        dataRows.forEach(row => {
            md += '| ' + row.join(' | ') + ' |\n';
        });
        return md.trim();
    }

    function domToMarkdown(el) {
        if (!el) return '';
        let md = '';
        for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                if (text) md += decryptText(text);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.classList && node.classList.contains('element-invisible-hidden')) continue;
                const tag = node.tagName.toLowerCase();
                if (tag === 'img') {
                    let src = resolveUrl(node.getAttribute('data-original') || node.src || node.getAttribute('data-src') || '');
                    const alt = decryptText(node.alt || '');
                    if (src && imgBase64Map && imgBase64Map[src]) src = imgBase64Map[src];
                    if (src) md += ' ![' + alt + '](' + src + ') ';
                } else if (tag === 'br') {
                    md += '\n';
                } else if (tag === 'table') {
                    md += '\n' + tableToMarkdown(node) + '\n';
                } else if (tag === 'p') {
                    const c = domToMarkdown(node).trim();
                    if (c) md += '\n' + c + '\n';
                } else if (tag === 'strong' || tag === 'b') {
                    const c = domToMarkdown(node).trim();
                    if (c) md += '**' + c + '**';
                } else if (tag === 'em' || tag === 'i') {
                    const c = domToMarkdown(node).trim();
                    if (c) md += '*' + c + '*';
                } else if (tag === 'a') {
                    const c = domToMarkdown(node).trim();
                    const h = node.href || '';
                    if (c && h) md += '[' + c + '](' + h + ')';
                    else md += c;
                } else if (tag === 'sub') {
                    const c = domToMarkdown(node).trim();
                    if (c) md += '<sub>' + c + '</sub>';
                } else if (tag === 'sup') {
                    const c = domToMarkdown(node).trim();
                    if (c) md += '<sup>' + c + '</sup>';
                } else {
                    md += domToMarkdown(node);
                }
            }
        }
        return md;
    }

    function isAnswerText(text) {
        return text.includes('我的答案') || text.includes('正确答案');
    }

    function findTitleFromOptions(options) {
        if (!options || options.length === 0) return null;
        const first = options[0];
        const ref = first.tagName === 'LI' ? first.closest('ul, ol') : first;
        if (!ref) return null;
        const prev = ref.previousElementSibling;
        if (prev && !prev.matches('ul, ol, .newAnswerBx, .answerBx, .lookAnswer, .mark_answer, .mark_key, .mark_answer_key')) {
            const raw = (prev.textContent || '').trim();
            if (/^\d+\s*[\.、\s]\s*\(/.test(raw)) {
                return prev;
            }
        }
        return null;
    }

    function getElementText(el) {
        if (!el) return '';
        let t = domToMarkdown(el).replace(/\s+/g, ' ').trim();
        if (t && t.length >= 4 && !isAnswerText(t)) return t;
        t = decryptText(el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim();
        if (t && !isAnswerText(t)) return t;
        return '';
    }

    function extractCorrectAnswer(answerEl) {
        if (!answerEl) return '';
        // 简答题: answer is in .mark_answer_key → dl.mark_fill.colorGreen → dd.rightAnswerContent
        if (answerEl.matches('.mark_answer_key') || answerEl.querySelector('.mark_answer_key')) {
            const key = answerEl.matches('.mark_answer_key') ? answerEl : answerEl.querySelector('.mark_answer_key');
            const greenDl = key.querySelector('dl.mark_fill.colorGreen');
            if (greenDl) {
                const dd = greenDl.querySelector('dd.rightAnswerContent');
                if (dd) {
                    return '正确答案:\n' + domToMarkdown(dd).trim();
                }
            }
            return '';
        }
        // 单选题: answer is in .mark_key
        let text = domToMarkdown(answerEl).replace(/\s+/g, ' ').trim();
        if (!text) {
            text = decryptText(answerEl.textContent || answerEl.innerText || '').replace(/\s+/g, ' ').trim();
        }
        text = text.replace(/\*/g, '').trim();
        const match = text.match(/正确答案\s*[:：]\s*(.+?)(?:;|$)/);
        if (match) {
            let correctAnswer = match[1].trim();
            const letterMatch = correctAnswer.match(/^([A-Za-z])\s*[:：]/);
            if (letterMatch) {
                return '正确答案: ' + letterMatch[1];
            }
            return '正确答案: ' + correctAnswer;
        }
        return '';
    }

    // ============ Question Splitting ============

    function isInAnswerBox(el) {
        return el && el.closest('.newAnswerBx, .answerBx, .lookAnswer, .mark_answer, .mark_key, .mark_answer_key');
    }

    function elementLooksLikeAnswer(el) {
        const text = decryptText((el.textContent || el.innerText || '').substring(0, 50));
        return isAnswerText(text);
    }

    function pickBestTitle(group) {
        for (const child of group) {
            if (child.matches('ul, ol, .newAnswerBx, .answerBx, .lookAnswer, .mark_answer, .mark_key, .mark_answer_key')) continue;
            if (elementLooksLikeAnswer(child)) continue;
            const raw = (child.textContent || child.innerText || '').trim();
            if (/^\d+\s*[\.、\s]\s*\(/.test(raw)) {
                if (child.matches('.fontLabel, .clearfix') && !isInAnswerBox(child)) return child;
                const fl = child.querySelector('.fontLabel');
                if (fl && fl.textContent.trim() && !isInAnswerBox(fl) && !elementLooksLikeAnswer(fl)) return fl;
                const cf = child.querySelector('.clearfix');
                if (cf && cf.textContent.trim() && !isInAnswerBox(cf) && !elementLooksLikeAnswer(cf)) return cf;
                return child;
            }
        }
        for (const child of group) {
            if (child.matches('ul, ol, .newAnswerBx, .answerBx, .lookAnswer, .mark_answer, .mark_key, .mark_answer_key')) continue;
            if (elementLooksLikeAnswer(child)) continue;
            if (child.matches('.fontLabel, .clearfix') && child.textContent.trim() && !isInAnswerBox(child)) return child;
            const fl = child.querySelector('.fontLabel');
            if (fl && fl.textContent.trim() && !isInAnswerBox(fl) && !elementLooksLikeAnswer(fl)) return fl;
            const cf = child.querySelector('.clearfix');
            if (cf && cf.textContent.trim() && !isInAnswerBox(cf) && !elementLooksLikeAnswer(cf)) return cf;
            if (child.textContent.trim()) return child;
        }
        return group[0];
    }

    function splitQuestions(container) {
        const children = Array.from(container.children);
        let typeHeading = '';
        let questionStartIdx = [];

        // First pass: find the type heading
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child.matches('.Zy_TItle, .newZy_TItle') || child.querySelector('.Zy_TItle, .newZy_TItle')) {
                typeHeading = domToMarkdown(child).replace(/\s+/g, ' ').trim();
                break;
            }
        }

        // Second pass: find question boundaries by number pattern
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            const raw = child.textContent;
            if (!raw || !raw.trim()) continue;

            if (child.matches('.Zy_TItle, .newZy_TItle') || child.querySelector('.Zy_TItle, .newZy_TItle')) continue;

            const text = raw.trim();
            if (/^\d+\s*[\.、\s]\s*\(/.test(text) && !child.matches('ul, ol')) {
                questionStartIdx.push(i);
            }
        }

        if (questionStartIdx.length < 2) {
            return { typeHeading, questions: [] };
        }

        let questions = [];
        for (let i = 0; i < questionStartIdx.length; i++) {
            const start = questionStartIdx[i];
            const end = i + 1 < questionStartIdx.length ? questionStartIdx[i + 1] : children.length;
            const group = children.slice(start, end);

            let options = [];
            let answer = null;

            group.forEach(child => {
                const tag = child.tagName.toLowerCase();
                if (tag === 'ul' || tag === 'ol') {
                    options.push(child);
                } else if (child.matches('.newAnswerBx, .answerBx, .lookAnswer, .mark_answer, .mark_key, .mark_answer_key')) {
                    answer = child;
                } else if (tag === 'div') {
                    const nestedLists = child.querySelectorAll('ul, ol');
                    nestedLists.forEach(ul => options.push(ul));
                    const ans = child.querySelector('.newAnswerBx, .answerBx, .lookAnswer, .mark_answer, .mark_key, .mark_answer_key');
                    if (ans) answer = ans;
                }
            });

            const title = pickBestTitle(group);
            questions.push({ title, options, answer });
        }
        return { typeHeading, questions };
    }

    function findSubQuestions(container) {
        const selectors = [
            '.questionLi', '.subject_cont', '.examPaper_subject',
            '.subject', '.questionItem', '.timu_item',
            '.judgeQuestionLi', '.fillQuestionLi'
        ];
        for (const sel of selectors) {
            const items = container.querySelectorAll(sel);
            if (items.length >= 2) {
                return Array.from(items);
            }
        }
        return [];
    }

    function extractQuestionsFromPage() {
        const containers = document.querySelectorAll('.TiMu');
        if (containers.length === 0) return null;

        let allQuestions = [];
        let globalTypeHeading = '';

        containers.forEach(container => {
            let subItems = findSubQuestions(container);

            if (subItems.length >= 2) {
                subItems.forEach(item => {
                    const titleEl = (function() {
                        const candidates = [
                            item.querySelector('.clearfix'),
                            item.querySelector('.Zy_TItle .clearfix'),
                            item.querySelector('.Zy_TItle'),
                            item.querySelector('.newZy_TItle'),
                            item.querySelector('.mark_name'),
                            item.querySelector('h3'),
                        ];
                        for (const el of candidates) {
                            if (el && !el.closest('.newAnswerBx, .answerBx, .lookAnswer, .mark_answer, .mark_key, .mark_answer_key') && !elementLooksLikeAnswer(el)) return el;
                        }
                        const fontLabels = item.querySelectorAll('.fontLabel');
                        for (const fl of fontLabels) {
                            if (!fl.closest('.newAnswerBx, .answerBx, .lookAnswer, .mark_answer, .mark_key, .mark_answer_key') && !elementLooksLikeAnswer(fl)) return fl;
                        }
                        const heading = item.querySelector('h3, h4, .mark_name, [class*="title"]');
                        if (heading && !elementLooksLikeAnswer(heading)) return heading;
                        return item.children[0];
                    })();
                    const options = Array.from(item.querySelectorAll('ul li, ol li'));
                    const answer = item.querySelector('.newAnswerBx, .answerBx, .lookAnswer, .mark_answer, .mark_key, .mark_answer_key');
                    allQuestions.push({ title: titleEl || item, options, answer });
                });
            } else {
                const result = splitQuestions(container);
                if (result.questions.length >= 2) {
                    if (result.typeHeading && !globalTypeHeading) {
                        globalTypeHeading = result.typeHeading;
                    }
                    allQuestions.push(...result.questions);
                } else {
                    const titleEl = container.querySelector('.Zy_TItle .clearfix') ||
                                    container.querySelector('.Zy_TItle') ||
                                    container.querySelector('.newZy_TItle') ||
                                    container.querySelector('.fontLabel');
                    const options = Array.from(container.querySelectorAll('ul li'));
                    const answer = container.querySelector('.newAnswerBx, .answerBx, .lookAnswer, .mark_answer, .mark_key, .mark_answer_key');
                    allQuestions.push({ title: titleEl || container, options, answer });
                }
            }
        });

        return allQuestions.length > 0 ? { questions: allQuestions, typeHeading: globalTypeHeading } : null;
    }

    // ============ Content Extraction ============

    async function extractContent() {
        parsePageFont();

        imgBase64Map = await preloadAllImages();

        const result = extractQuestionsFromPage();
        if (!result) return null;

        const now = new Date();
        const dateStr = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0') + ' ' +
            String(now.getHours()).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0');

        let md = '# 学习通习题导出\n\n> 导出时间: ' + dateStr + '\n\n';

        const { questions, typeHeading } = result;

        if (typeHeading) {
            md += '## ' + typeHeading + '\n\n';
        }

        questions.forEach((q, index) => {
            let titleText = q.title ? getElementText(q.title) : '';
            if (!titleText && q.options && q.options.length > 0) {
                const betterTitle = findTitleFromOptions(q.options);
                if (betterTitle) titleText = getElementText(betterTitle);
            }
            if (!titleText) titleText = '未找到题目';
            // Strip leading number pattern to avoid duplication (e.g. "13. (简答题...")
            titleText = titleText.replace(/^\d+\s*[\.、\s]\s*/, '');

            md += '# ' + (index + 1) + '\n' + titleText + '\n\n';

            if (q.options && q.options.length > 0) {
                let allOptions = [];
                q.options.forEach(optList => {
                    if (optList.tagName === 'UL' || optList.tagName === 'OL') {
                        const items = optList.querySelectorAll('li');
                        items.forEach(li => allOptions.push(li));
                    } else {
                        allOptions.push(optList);
                    }
                });

                if (allOptions.length === 0) {
                    allOptions = q.options;
                }

                allOptions.forEach(opt => {
                    let optText = domToMarkdown(opt).replace(/\s+/g, ' ').trim();
                    if (!optText) return;
                    const isChecked = opt.querySelector('input:checked, .ri, .dui');
                    const mark = isChecked ? ' ✅' : '';
                    md += '- ' + optText + mark + '\n';
                });
                md += '\n';
            }

            let answerEl = q.answer;
            if (!answerEl && q.options && q.options.length > 0) {
                const last = q.options[q.options.length - 1];
                const ref = last.tagName === 'LI' ? last.closest('ul, ol') : last;
                if (ref) {
                    const next = ref.nextElementSibling;
                    if (next && !next.matches('ul, ol') && !/^\d+\s/.test(next.textContent.trim())) {
                        answerEl = next;
                    }
                }
            }
            if (answerEl) {
                let answerText = extractCorrectAnswer(answerEl);
                if (answerText) {
                    if (answerText.includes('\n')) {
                        md += answerText + '\n\n';
                    } else {
                        md += '**' + answerText + '**\n\n';
                    }
                }
            }

            md += '---\n\n';
        });

        return md;
    }

    // ============ Export ============

    function getExportFileName() {
        let name = '学习通题目';

        const titleSelectors = [
            'h2.mark_title',
            '.mark_title',
            '.borderBom .mark_title',
            '.zy_name',
            '.workTitle',
            '.homework_title',
            '.ceyan_name h3',
            '#RightCon > div.radiusBG > div > div.ceyan_name > h3',
            '.topTitle',
            '.mainTitle',
            '.examName',
            '.testName',
            '.work-name',
            '.homeworkName',
            '.topic-name',
            'h1',
            'h2',
            '.mark_name',
        ];

        for (const sel of titleSelectors) {
            const el = document.querySelector(sel);
            if (el && el.innerText && el.innerText.trim()) {
                name = el.innerText.replace(/\s+/g, ' ').trim();
                break;
            }
        }

        if (name === '学习通题目' && document.title && document.title.trim()) {
            name = document.title.replace(/\s+/g, ' ').trim();
        }

        if (name === '学习通题目' || name === '学习通' || !name) {
            const firstTimu = document.querySelector('.TiMu');
            if (firstTimu) {
                const firstTextEl = firstTimu.querySelector('.Zy_TItle, .newZy_TItle, .fontLabel');
                if (firstTextEl) {
                    const t = firstTextEl.innerText.replace(/\s+/g, ' ').trim();
                    if (t) {
                        const match = t.match(/^(.{1,30}?)[\s\d]/);
                        name = match ? match[1] : t.substring(0, 20);
                    }
                }
            }
        }

        name = name.replace(/[\\/:*?"<>|]/g, '_').substring(0, 60);
        if (!name) name = '学习通题目';

        const date = new Date();
        const timeStr = (date.getMonth() + 1) + '月' + date.getDate() + '日';
        return name + '_' + timeStr + '.md';
    }

    function exportToMarkdown(mdContent) {
        const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = getExportFileName();
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    // ============ UI ============

    function showModal(mdContent, questionCount) {
        let modal = document.getElementById('cx-preview-modal');
        const statusStr = '字体解密: ' + (fontLoaded ? '✅ 已解析' : '⚠️ 无加密字体') +
            ' | 映射表: ' + (fontHashParams ? '✅ 已加载' : '❌ 未加载') +
            ' | 共 ' + questionCount + ' 题';

        if (!modal) {
            const modalHtml = '<div id="cx-preview-modal">' +
                '<div class="cx-modal-content">' +
                '<div class="cx-modal-header">' +
                '<span class="cx-modal-title">📝 题目预览 (Markdown)</span>' +
                '<span class="cx-close-btn" onclick="document.getElementById(\'cx-preview-modal\').style.display=\'none\'">&times;</span>' +
                '</div>' +
                '<textarea id="cx-preview-text" readonly></textarea>' +
                '<div class="cx-modal-footer">' +
                '<span class="cx-status-text" id="cx-status-info">' + statusStr + '</span>' +
                '<div class="cx-btn-group">' +
                '<button class="cx-btn primary" id="cx-copy-btn">复制 Markdown</button>' +
                '<button class="cx-btn success" id="cx-export-btn">导出 .md 文件</button>' +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>';
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            modal = document.getElementById('cx-preview-modal');

            document.getElementById('cx-copy-btn').onclick = function() {
                const text = document.getElementById('cx-preview-text').value;
                GM_setClipboard(text);
                const btn = document.getElementById('cx-copy-btn');
                const originalText = btn.innerText;
                btn.innerText = '已复制！';
                btn.style.backgroundColor = '#52c41a';
                setTimeout(function() {
                    btn.innerText = originalText;
                    btn.style.backgroundColor = '';
                }, 1500);
            };

            document.getElementById('cx-export-btn').onclick = function() {
                const text = document.getElementById('cx-preview-text').value;
                if (text) exportToMarkdown(text);
            };

            modal.onclick = function(e) {
                if (e.target === modal) modal.style.display = 'none';
            };
        } else {
            document.getElementById('cx-status-info').innerText = statusStr;
        }

        document.getElementById('cx-preview-text').value = mdContent;
        modal.style.display = 'flex';
    }

    function init() {
        const check = document.querySelectorAll('.TiMu');
        if (check.length === 0) return;

        initDecryption();
        parsePageFont();

        const styleEl = document.createElement('style');
        styleEl.innerHTML = styles;
        document.head.appendChild(styleEl);

        const toolPanel = document.createElement('div');
        toolPanel.id = 'cx-tool-panel';

        const mainBtn = document.createElement('button');
        mainBtn.className = 'cx-btn primary';
        mainBtn.innerHTML = '📑 提取题目';
        mainBtn.title = '点击提取本页所有题目、选项及答案并预览';
        mainBtn.onclick = async function() {
            mainBtn.disabled = true;
            mainBtn.innerHTML = '⏳ 提取中...';
            try {
                const data = await extractContent();
                if (data) {
                    const match = data.match(/^# \d+/gm);
                    const count = match ? match.length : 0;
                    showModal(data, count);
                } else {
                    alert('未找到题目，请确保在测验页面内');
                }
            } finally {
                mainBtn.disabled = false;
                mainBtn.innerHTML = '📑 提取题目';
            }
        };

        const exportBtn = document.createElement('button');
        exportBtn.className = 'cx-btn success';
        exportBtn.innerHTML = '⬇️ 导出 MD';
        exportBtn.title = '直接导出 Markdown 文件';
        exportBtn.onclick = async function() {
            exportBtn.disabled = true;
            exportBtn.innerHTML = '⏳ 导出中...';
            try {
                const data = await extractContent();
                if (data) exportToMarkdown(data);
                else alert('未找到题目');
            } finally {
                exportBtn.disabled = false;
                exportBtn.innerHTML = '⬇️ 导出 MD';
            }
        };

        toolPanel.appendChild(mainBtn);
        toolPanel.appendChild(exportBtn);
        document.body.appendChild(toolPanel);
    }

    setTimeout(function() {
        if (document.readyState === 'complete') {
            init();
        } else {
            window.addEventListener('load', init);
        }
    }, 2000);

})();
