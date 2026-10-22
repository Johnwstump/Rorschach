'use strict';

// Returns a script that runs inside the reviewed page: it finds the first visible
// text matching `focus`, highlights it (and the value next to it, when the match is
// a label such as a <dt> or <th>), scrolls it into view, and reports what it found.
// The page keeps no reference to us; the styles are undone on the next run.
function highlightScript(focus) {
  return `(() => {
    const needle = ${JSON.stringify(String(focus))}.trim().toLowerCase();
    for (const el of document.querySelectorAll('[data-rorshach-mark]')) {
      el.style.cssText = el.getAttribute('data-rorshach-prev') || '';
      el.removeAttribute('data-rorshach-mark');
      el.removeAttribute('data-rorshach-prev');
    }
    if (!needle) return { found: null };
    const visible = (el) => el && el.getClientRects().length > 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node, exact = null, partial = null;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue.replace(/\\s+/g, ' ').trim().toLowerCase();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || !visible(el) || /^(script|style|noscript)$/i.test(el.tagName)) continue;
      if (text === needle) { exact = el; break; }
      if (!partial && text.includes(needle)) partial = el;
    }
    let label = exact || partial;
    if (!label) return { found: false };
    // A label is often wrapped (<th><a>Stable release</a></th>): climb to the row label.
    for (let up = label, i = 0; up && i < 3; up = up.parentElement, i++) {
      if (/^(DT|TH|LABEL)$/.test(up.tagName)) { label = up; break; }
    }
    let value = label;
    const sib = label.nextElementSibling;
    if (label.tagName === 'DT' && sib && sib.tagName === 'DD') value = sib;
    else if (label.tagName === 'TH' && sib && sib.tagName === 'TD') value = sib;
    else if (label.tagName === 'LABEL' && label.control) value = label.control;
    for (const el of new Set([label, value])) {
      el.setAttribute('data-rorshach-prev', el.style.cssText);
      el.setAttribute('data-rorshach-mark', '1');
      el.style.cssText += ';background:#ffe08a !important;color:#111 !important;outline:3px solid #e0a800 !important;outline-offset:2px !important;border-radius:3px !important;';
    }
    value.scrollIntoView({ block: 'center', inline: 'nearest' });
    return { found: true, exact: Boolean(exact), text: (value.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160) };
  })()`;
}

module.exports = { highlightScript };
