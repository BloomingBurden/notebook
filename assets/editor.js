(() => {
  'use strict';

  const markdown = window.markdownit({ html: false, linkify: true, breaks: true });
  const langLabels = {
    js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript',
    py: 'Python', python: 'Python', html: 'HTML', xml: 'XML', css: 'CSS', json: 'JSON',
    sql: 'SQL', sh: 'Shell', bash: 'Bash', powershell: 'PowerShell', java: 'Java',
    csharp: 'C#', cpp: 'C++', go: 'Go', rust: 'Rust', yaml: 'YAML', markdown: 'Markdown'
  };
  const indent = '    ';
  const openingFence = /^ {0,3}(\x60{3,}|~{3,})(.*)$/;

  function closesFence(line, fence) {
    const match = openingFence.exec(line);
    return Boolean(match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim());
  }

  function normalizeLegacyBullets(source) {
    let fence = '';
    return source.split('\n').map(line => {
      if (fence) {
        if (closesFence(line, fence)) fence = '';
        return line;
      }
      const opening = openingFence.exec(line);
      if (opening) fence = opening[1];
      return line.replace(/^( {0,3})•(?=\s)/, '$1-');
    }).join('\n');
  }

  markdown.core.ruler.after('inline', 'notebook_tasks', state => {
    for (let index = 2; index < state.tokens.length; index += 1) {
      const item = state.tokens[index - 2];
      const paragraph = state.tokens[index - 1];
      const first = state.tokens[index].children?.[0];
      if (item.type !== 'list_item_open' || paragraph.type !== 'paragraph_open' || first?.type !== 'text') continue;
      const match = /^\[([xX ])\] /.exec(first.content);
      if (!match) continue;
      item.attrJoin('class', 'task-item');
      first.content = first.content.slice(match[0].length);
      const checkbox = new state.Token('html_inline', '', 0);
      checkbox.content = '<input type="checkbox" disabled aria-label="Задача"' + (match[1] === ' ' ? '' : ' checked') + '>';
      state.tokens[index].children.unshift(checkbox);
    }
  });

  markdown.renderer.rules.table_open = () => '<div class="table-scroll"><table>';
  markdown.renderer.rules.table_close = () => '</table></div>';
  markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return renderer.renderToken(tokens, index, options);
  };
  markdown.renderer.rules.fence = (tokens, index) => {
    const { content, info } = tokens[index];
    return renderCode(content, info.trim().split(/\s+/, 1)[0]);
  };
  markdown.renderer.rules.code_block = (tokens, index) => renderCode(tokens[index].content, '');

  function renderCode(content, language) {
    const esc = markdown.utils.escapeHtml;
    const code = language && content.length < 40_000 && window.hljs.getLanguage(language)
      ? window.hljs.highlight(content, { language, ignoreIllegals: true }).value
      : esc(content).replace(/^\n/, '&#10;');
    const label = Object.hasOwn(langLabels, language) ? langLabels[language] : language || 'Код';
    return '<div class="code-block"><div class="code-header"><span>' + esc(label) +
      '</span><button type="button" data-copy-code>Копировать</button></div><pre tabindex="0"><code>' +
      code + '</code></pre></div>\n';
  }

  function updatePreview(element, content) {
    if (!content.trim()) {
      element.textContent = 'Предпросмотр появится после ввода текста.';
      element.classList.add('empty');
      return;
    }
    element.classList.remove('empty');
    element.innerHTML = markdown.render(normalizeLegacyBullets(content));
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        if (error.name !== 'NotAllowedError') throw error;
      }
    }
    const previousFocus = document.activeElement;
    const field = document.createElement('textarea');
    field.value = text;
    field.style.cssText = 'position:fixed;top:0;opacity:0;pointer-events:none';
    document.body.append(field);
    field.select();
    try {
      if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
    } finally {
      field.remove();
      previousFocus?.focus();
    }
  }

  function replaceSelection(field, from, to, text, selectionStart = text.length, selectionEnd = selectionStart) {
    field.focus({ preventScroll: true });
    field.setSelectionRange(from, to);
    // Chromium and Firefox support insertText with native undo in a textarea.
    if (!document.execCommand('insertText', false, text)) {
      field.setRangeText(text, from, to, 'end');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    field.setSelectionRange(from + selectionStart, from + selectionEnd);
  }

  function startOfLine(value, position) {
    return position ? value.lastIndexOf('\n', position - 1) + 1 : 0;
  }

  function endOfLine(value, position) {
    const next = value.indexOf('\n', position);
    return next < 0 ? value.length : next;
  }

  function wrapInline(field, delimiter, fallback, prefix = delimiter, suffix = delimiter) {
    const { value, selectionStart, selectionEnd } = field;
    const text = value.slice(selectionStart, selectionEnd) || fallback;
    replaceSelection(field, selectionStart, selectionEnd, prefix + text + suffix, prefix.length, prefix.length + text.length);
  }

  function format(field, type, language) {
    const { value, selectionStart, selectionEnd } = field;
    const start = startOfLine(value, selectionStart);
    const end = selectionEnd > start && value[selectionEnd - 1] === '\n' ? selectionEnd - 1 : endOfLine(value, selectionEnd);
    const selected = value.slice(selectionStart, selectionEnd);
    switch (type) {
      case 'bold': return wrapInline(field, '**', 'жирный текст');
      case 'italic': return wrapInline(field, '*', 'курсив');
      case 'strike': return wrapInline(field, '~~', 'текст');
      case 'inline': {
        const ticks = String.fromCharCode(96).repeat(1 + Math.max(0, ...[...selected.matchAll(/\x60+/g)].map(match => match[0].length)));
        const padding = /^\x60|\x60$|^ .* $/.test(selected) ? ' ' : '';
        return wrapInline(field, ticks + padding, 'код', ticks + padding, padding + ticks);
      }
      case 'link': {
        const url = 'https://example.com';
        const isUrl = /^https?:\/\/[^\s()]+$/i.test(selected);
        const label = isUrl ? 'текст ссылки' : selected || 'текст ссылки';
        const text = '[' + label + '](' + (isUrl ? selected : url) + ')';
        const from = isUrl || !selected ? 1 : label.length + 3;
        const through = from + (isUrl || !selected ? label.length : url.length);
        return replaceSelection(field, selectionStart, selectionEnd, text, from, through);
      }
      case 'code': {
        const text = selected || value.slice(start, end) || 'код';
        const fence = String.fromCharCode(96).repeat(Math.max(3, 1 + Math.max(0, ...[...text.matchAll(/\x60+/g)].map(match => match[0].length))));
        const before = selected ? selectionStart : start;
        const after = selected ? selectionEnd : end;
        const prefix = (before && value[before - 1] !== '\n' ? '\n' : '') + fence + language + '\n';
        const suffix = (text.endsWith('\n') ? '' : '\n') + fence + (value[after] === '\n' ? '' : '\n');
        return replaceSelection(field, before, after, prefix + text + suffix, prefix.length, prefix.length + text.length);
      }
      case 'table': {
        const table = '| Столбец 1 | Столбец 2 |\n| --- | --- |\n| Значение | Значение |';
        const at = endOfLine(value, selectionEnd);
        const prefix = at === 0 ? '' : value[at - 1] === '\n' ? '\n' : '\n\n';
        const suffix = value.slice(at).startsWith('\n\n') ? '' : '\n';
        return replaceSelection(field, at, at, prefix + table + suffix, prefix.length + 2, prefix.length + 11);
      }
      default: {
        const prefixes = { heading: '## ', ul: '- ', task: '- [ ] ', quote: '> ' };
        const source = value.slice(start, end) || (type === 'heading' ? 'Заголовок' : type === 'quote' ? 'Цитата' : 'Пункт списка');
        const text = source.split('\n').map((line, index) => (type === 'ol' ? (index + 1) + '. ' : prefixes[type]) + line).join('\n');
        replaceSelection(field, start, end, text, 0, text.length);
      }
    }
  }

  function withinFence(value, lineStart) {
    let fence = '';
    for (const line of value.slice(0, lineStart).split('\n')) {
      if (fence) {
        if (closesFence(line, fence)) fence = '';
      } else {
        const match = openingFence.exec(line);
        if (match) fence = match[1];
      }
    }
    return fence;
  }

  function handleCodeKeys(event, field, focusExit) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      focusExit();
      return;
    }
    if (event.key !== 'Tab' && event.key !== 'Enter') return;
    const { value, selectionStart, selectionEnd } = field;
    const lineStart = startOfLine(value, selectionStart);
    const fence = withinFence(value, lineStart);
    if (!fence || closesFence(value.slice(lineStart, endOfLine(value, lineStart)), fence)) return;
    event.preventDefault();
    if (event.key === 'Enter') {
      const leadingSpace = /^[ \t]*/.exec(value.slice(lineStart, selectionStart))[0];
      replaceSelection(field, selectionStart, selectionEnd, '\n' + leadingSpace);
      return;
    }
    if (!event.shiftKey && selectionStart === selectionEnd) {
      replaceSelection(field, selectionStart, selectionEnd, indent);
      return;
    }
    const end = selectionEnd > lineStart && value[selectionEnd - 1] === '\n' ? selectionEnd - 1 : endOfLine(value, selectionEnd);
    const lines = value.slice(lineStart, end).split('\n');
    const updated = lines.map(line => event.shiftKey ? line.replace(/^( {1,4}|\t)/, '') : indent + line).join('\n');
    if (updated === lines.join('\n')) return;
    if (selectionStart === selectionEnd) {
      const removed = end - lineStart - updated.length;
      replaceSelection(field, lineStart, end, updated, Math.max(0, selectionStart - lineStart - removed));
    } else {
      replaceSelection(field, lineStart, end, updated, 0, updated.length);
    }
  }

  window.notebookEditor = { updatePreview, copyText, format, handleCodeKeys };
})();
