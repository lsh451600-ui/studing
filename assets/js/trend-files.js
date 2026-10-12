const description = file => `${file.name} (${Math.ceil(file.size / 1024)}KB)`;
export function renderTrendFiles(files) {
  let list = document.getElementById('trend-downloads');
  if (!list) { list = document.createElement('div'); list.id = 'trend-downloads'; document.getElementById('board-body').after(list); }
  list.replaceChildren();
  if (!files.length) return;
  const heading = document.createElement('h3'); heading.textContent = '첨부 파일'; list.append(heading);
  for (const file of files) {
    const row = document.createElement('p'), link = document.createElement('a');
    link.textContent = description(file); link.href = '/api/trend-files?id=' + encodeURIComponent(file.id); link.download = file.name;
    row.append(link); list.append(row);
  }
}
export function createTrendFiles(prefix) {
  const box = document.createElement('div'), label = document.createElement('label'), input = document.createElement('input'), hint = document.createElement('small'), list = document.createElement('ul'), status = document.createElement('p');
  box.className = 'trend-files'; label.textContent = '파일 추가'; input.type = 'file'; input.multiple = true; input.id = prefix + '-files';
  hint.textContent = '최대 5개 · 개당 500KB · 전체 1MB'; status.setAttribute('role','status');
  label.append(input); box.append(label,hint,list,status);
  document.getElementById(prefix + '-body').parentElement.after(box);
  let files = [];
  function render() {
    list.replaceChildren();
    for (const file of files) {
      const row = document.createElement('li'), remove = document.createElement('button');
      row.append(document.createTextNode(description(file) + ' ')); remove.type = 'button'; remove.textContent = '삭제'; remove.setAttribute('aria-label',file.name + ' 첨부 삭제');
      remove.onclick = () => { files = files.filter(value => value !== file); render(); }; row.append(remove); list.append(row);
    }
  }
  input.addEventListener('change', () => {
    const additions = Array.from(input.files);
    if (files.length + additions.length > 5 || additions.some(file => !file.size || file.size > 500 * 1024 || file.name.length > 200) || [...files,...additions].reduce((sum,file) => sum + file.size,0) > 1024 * 1024) {
      status.textContent = '파일은 최대 5개, 개당 500KB·전체 1MB까지 추가할 수 있습니다. 빈 파일은 첨부할 수 없습니다.';
    } else { files.push(...additions); status.textContent = ''; render(); }
    input.value = '';
  });
  return {
    fill(values) { files = [...values]; input.value = ''; status.textContent = ''; render(); },
    reset() { this.fill([]); },
    async payload() {
      return Promise.all(files.map(file => file.id ? { id: file.id } : new Promise((resolve,reject) => {
        const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, data: reader.result.split(',')[1] }); reader.onerror = () => reject(new Error('파일을 읽지 못했습니다. 다시 추가해 주세요.')); reader.readAsDataURL(file);
      })));
    }
  };
}
