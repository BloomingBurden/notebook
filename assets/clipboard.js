(() => {
  'use strict';

  const converter = new window.TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    preformattedCode: true
  });

  const SKIP_ELEMENTS = [
    'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed',
    'button', '[role="button"]', '[role="toolbar"]', '[data-copy-code]', '[hidden]', 'svg'
  ].join(',');

  converter.addRule('strikethrough', {
    filter: ['del', 's', 'strike'],
    replacement: content => '~~' + content + '~~'
  });

  converter.addRule('inlineStyles', {
    filter: node => node.nodeName === 'SPAN' && inlineDecoration(node),
    replacement: (content, node) => {
      const marks = inlineDecoration(node);
      return marks.join('') + content + marks.reverse().join('');
    }
  });

  converter.addRule('taskCheckbox', {
    filter: node => node.nodeName === 'INPUT' && node.type === 'checkbox' && node.closest('li'),
    replacement: (_, node) => node.hasAttribute('checked') ? '[x] ' : '[ ] '
  });

  converter.addRule('nestedOrderedList', {
    // A list that starts after 1 needs a blank line to follow a paragraph.
    filter: node => node.nodeName === 'OL' && node.start !== 1 && node.parentNode.nodeName === 'LI',
    replacement: content => '\n\n' + content + '\n\n'
  });

  converter.addRule('preformattedBlock', {
    filter: 'pre',
    replacement: (_, pre) => {
      const code = pre.firstElementChild;
      const text = code?.textContent || '';
      const language = code?.dataset.language || '';
      let fenceLength = 3;
      for (const match of text.matchAll(/^ {0,3}(\x60{3,})[ \t]*$/gm)) {
        fenceLength = Math.max(fenceLength, match[1].length + 1);
      }
      const fence = String.fromCharCode(96).repeat(fenceLength);
      return '\n\n' + fence + language + '\n' + text.replace(/\n$/, '') + '\n' + fence + '\n\n';
    }
  });

  converter.addRule('table', {
    filter: 'table',
    replacement: (_, table) => {
      const rows = Array.from(table.rows);
      if (!rows.length) return '';
      const columnCount = rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
      const separators = { left: ':---', center: ':---:', right: '---:' };
      const divider = Array.from({ length: columnCount }, (_, index) => {
        const cell = rows[0].cells[index];
        const alignment = cell?.style.textAlign || cell?.getAttribute('align');
        return Object.hasOwn(separators, alignment) ? separators[alignment] : '---';
      });
      const rowMarkdown = rows.map(row => Array.from({ length: columnCount }, (_, index) => {
        const cell = row.cells[index];
        return cell ? converter.turndown(cell).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|') : '';
      }));
      rowMarkdown.splice(1, 0, divider);
      return '\n\n' + rowMarkdown.map(row => '| ' + row.join(' | ') + ' |').join('\n') + '\n\n';
    }
  });

  function inlineDecoration(node) {
    const marks = [];
    const weight = node.style.fontWeight;
    if ((weight === 'bold' || Number(weight) >= 600) && !node.parentElement?.closest('b, strong')) marks.push('**');
    if (/^(italic|oblique)/.test(node.style.fontStyle) && !node.parentElement?.closest('i, em')) marks.push('*');
    if (node.style.textDecorationLine.includes('line-through') && !node.parentElement?.closest('del, s, strike')) marks.push('~~');
    return marks.length ? marks : null;
  }

  function codeLanguage(pre, code) {
    const metadata = pre.closest('[data-language], [data-code-language]') ||
      pre.querySelector('[data-language], [data-code-language]');
    const className = code?.getAttribute('class') || '';
    const preClassName = pre.getAttribute('class') || '';
    const fromClass = /(?:^|\s)(?:language|lang)-(\S+)/i.exec(className + ' ' + preClassName)?.[1];
    const label = code?.dataset.language || code?.dataset.codeLanguage ||
      metadata?.dataset.language || metadata?.dataset.codeLanguage || fromClass || '';
    const language = label.trim().toLowerCase();
    if (language === 'c++') return 'cpp';
    if (language === 'c#') return 'csharp';
    return /^[a-z0-9][a-z0-9_.+-]{0,31}$/.test(language) ? language : '';
  }

  function normalizeCodeBlocks(content) {
    for (const pre of content.querySelectorAll('pre')) {
      const code = pre.querySelector('code');
      const language = codeLanguage(pre, code);
      for (const lineBreak of (code || pre).querySelectorAll('br')) lineBreak.replaceWith('\n');
      const normalized = pre.ownerDocument.createElement('code');
      normalized.textContent = (code || pre).textContent;
      if (language) normalized.dataset.language = language;
      pre.replaceChildren(normalized);
    }
  }

  function fromHtml(html) {
    // Template contents are inert. Only their Markdown representation enters the editor.
    const template = document.createElement('template');
    template.innerHTML = html;
    const content = template.content;
    for (const element of content.querySelectorAll(SKIP_ELEMENTS)) element.remove();
    normalizeCodeBlocks(content);
    return converter.turndown(content);
  }

  window.notebookClipboard = { fromHtml };
})();
