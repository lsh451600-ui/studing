const sizes = [12,14,16,18,20,24,28,32];
function span(run) {
  const node = document.createElement('span'); node.textContent = run.text;
  node.style.color = run.color; node.style.fontSize = run.size + 'px'; node.style.fontWeight = run.bold ? '700' : '400';
  return node;
}
export function renderTrendBody(target, runs, plain) {
  target.replaceChildren();
  if (!Array.isArray(runs)) { target.textContent = plain; return; }
  for (const run of runs) {
    if (typeof run?.text !== 'string' || !(run.color === 'inherit' || /^#[0-9a-f]{6}$/i.test(run.color)) || !sizes.includes(run.size) || typeof run.bold !== 'boolean') continue;
    target.append(span(run));
  }
}
export function createTrendEditor(prefix) {
  const input = document.getElementById(prefix + '-body');
  input.hidden = true; input.required = false;
  const toolbar = document.createElement('div'); toolbar.className = 'trend-editor-toolbar'; toolbar.setAttribute('role','group'); toolbar.setAttribute('aria-label','글 서식');
  const colorLabel = document.createElement('label'); colorLabel.textContent = '글자색';
  const color = document.createElement('input'); color.type = 'color'; color.value = '#bd5636'; color.setAttribute('aria-label','글자색'); colorLabel.append(color);
  const sizeLabel = document.createElement('label'); sizeLabel.textContent = '글씨 크기';
  const size = document.createElement('select'); size.setAttribute('aria-label','글씨 크기');
  for (const value of sizes) { const option = document.createElement('option'); option.value = value; option.textContent = value + 'px'; option.selected = value === 16; size.append(option); } sizeLabel.append(size);
  const bold = document.createElement('button'); bold.type = 'button'; bold.textContent = '굵게'; bold.setAttribute('aria-label','굵게'); bold.setAttribute('aria-pressed','false');
  toolbar.append(colorLabel,sizeLabel,bold);
  const editor = document.createElement('div'); editor.className = 'trend-rich-editor'; editor.contentEditable = 'true'; editor.setAttribute('role','textbox'); editor.setAttribute('aria-label',prefix === 'board-post' ? '내용' : '수정 내용'); editor.setAttribute('aria-multiline','true');
  input.parentElement.after(toolbar,editor); input.parentElement.hidden = true;
  let range = null;
  document.addEventListener('selectionchange', () => {
    const selection = getSelection();
    if (selection.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) { range = selection.getRangeAt(0).cloneRange(); bold.setAttribute('aria-pressed',String(document.queryCommandState('bold'))); }
  });
  function command(name,value) {
    editor.focus();
    if (range && editor.contains(range.commonAncestorContainer)) { const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }
    document.execCommand(name,false,value);
    if (name === 'fontSize') for (const font of editor.querySelectorAll('font[size="7"]')) { font.removeAttribute('size'); font.style.fontSize = size.value + 'px'; }
    const selection = getSelection();
    if (selection.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) range = selection.getRangeAt(0).cloneRange();
    sync();
  }
  color.addEventListener('input',()=>command('foreColor',color.value));
  size.addEventListener('change',()=>command('fontSize','7'));
  bold.addEventListener('mousedown',event=>event.preventDefault()); bold.addEventListener('click',()=>command('bold'));
  editor.addEventListener('paste',event=>{event.preventDefault(); document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));});
  function runs() {
    const output = [];
    function visit(node,style) {
      if (node.nodeType === Node.TEXT_NODE) { if (node.textContent) output.push({text:node.textContent,...style}); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const next = {...style};
      const rawColor = node.getAttribute('color') || node.style.color;
      if (rawColor) { const hex = rawColor.match(/^#([0-9a-f]{6})$/i), rgb = rawColor.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/); if (hex) next.color = rawColor; else if (rgb) next.color = '#' + rgb.slice(1).map(value=>Number(value).toString(16).padStart(2,'0')).join(''); }
      const pixels = parseInt(node.style.fontSize,10); if (sizes.includes(pixels)) next.size = pixels;
      if (['B','STRONG'].includes(node.tagName) || Number(node.style.fontWeight)>=600) next.bold = true;
      if (node.style.fontWeight === '400' || node.style.fontWeight === 'normal') next.bold = false;
      if (node.tagName === 'BR') { output.push({text:'\n',...next}); return; }
      if (['DIV','P'].includes(node.tagName) && output.length && !output.at(-1).text.endsWith('\n')) output.push({text:'\n',...next});
      for (const child of node.childNodes) visit(child,next);
      if (['DIV','P'].includes(node.tagName) && output.length && !output.at(-1).text.endsWith('\n')) output.push({text:'\n',...next});
    }
    for (const child of editor.childNodes) visit(child,{color:'inherit',size:16,bold:false});
    return output;
  }
  function sync() { const value = runs(); input.value = value.map(run=>run.text).join(''); return value; }
  editor.addEventListener('input',sync);
  return { sync, fill(formatted,plain) { renderTrendBody(editor,formatted,plain); sync(); }, reset() { editor.replaceChildren(); input.value=''; range=null; } };
}
