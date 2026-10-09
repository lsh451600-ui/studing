export function appendPostActions(detail, post, { endpoint, api, refresh, categories = null, ingredientField = false }) {
  if (!post.canEdit && !post.canDelete) return;
  const make = (tag, text, className) => {
    const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element;
  };
  const actions = make('div', '', 'recipe-post-actions');
  const status = make('p'); status.setAttribute('role', 'status');
  const url = endpoint + '?id=' + post.id;
  if (post.canEdit) {
    const edit = make('button', '수정'); edit.type = 'button'; actions.append(edit);
    const form = make('form', '', 'recipe-inline-edit'); form.hidden = true;
    const titleLabel = make('label', '제목'), title = make('input'); title.value = post.title; title.required = true; title.maxLength = 120; titleLabel.append(title);
    const bodyLabel = make('label', '내용'), body = make('textarea'); body.value = post.body; body.required = true; body.maxLength = 20000; body.rows = 8; bodyLabel.append(body);
    form.append(titleLabel, bodyLabel);
    let category;
    if (categories) {
      const label = make('label', '분류'); category = make('select');
      for (const value of categories) { const option = make('option', value); option.value = value; category.append(option); }
      category.value = post.category || '미분류'; label.append(category); form.append(label);
    }
    let ingredients;
    if (ingredientField) {
      const label = make('label', '재료 (쉼표로 구분)'); ingredients = make('textarea'); ingredients.rows = 2; ingredients.maxLength = 2000;
      let saved = post.ingredients || []; if (typeof saved === 'string') { try { saved = JSON.parse(saved); } catch { saved = []; } }
      ingredients.value = Array.isArray(saved) ? saved.join(', ') : ''; ingredients.placeholder = '달걀, 두부, 대파, 소금'; label.append(ingredients); form.append(label);
    }
    const controls = make('div', '', 'recipe-post-actions'), save = make('button', '저장'), cancel = make('button', '취소');
    save.type = 'submit'; cancel.type = 'button'; controls.append(save, cancel); form.append(controls);
    edit.addEventListener('click', () => { form.hidden = false; title.focus(); });
    cancel.addEventListener('click', () => { form.hidden = true; title.value = post.title; body.value = post.body; status.textContent = ''; });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (save.disabled || !form.reportValidity()) return;
      save.disabled = true; cancel.disabled = true; status.textContent = '저장하고 있습니다.';
      try {
        await api(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.value, body: body.value, ...(category ? { category: category.value } : {}), ...(ingredients ? { ingredients: ingredients.value } : {}) }) });
        status.textContent = '수정했습니다.'; form.hidden = true;
        await refresh();
      } catch (error) { status.textContent = error.message; }
      finally { save.disabled = false; cancel.disabled = false; }
    });
    detail.append(form);
  }
  if (post.canDelete) {
    const remove = make('button', '삭제'); remove.type = 'button'; actions.append(remove);
    remove.addEventListener('click', async () => {
      if (remove.disabled || !confirm('이 게시물을 삭제할까요?')) return;
      remove.disabled = true;
      try { await api(url, { method: 'DELETE' }); detail.closest('.recipe-post').remove(); await refresh(); }
      catch (error) { status.textContent = error.message; }
      finally { remove.disabled = false; }
    });
  }
  detail.append(actions, status);
}
