const make = (tag, text, className) => {
  const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el;
};
const options = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const date = value => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(new Date(value));
export function appendRecipeComments(card, detail, post, api) {
  const section = make('section', '', 'recipe-comments'), heading = make('h3', '댓글');
  section.setAttribute('aria-label', post.title + ' 댓글');
  const list = make('div', '', 'recipe-comment-list'), status = make('p'); status.setAttribute('role', 'status');
  const refresh = make('button', '댓글 새로고침'); refresh.type = 'button';
  const header = make('div', '', 'recipe-comment-heading'); header.append(heading, refresh);
  const form = make('form', '', 'recipe-comment-form'), label = make('label', '댓글 작성'), input = make('textarea');
  input.rows = 3; input.maxLength = 2000; input.required = true; input.placeholder = '레시피에 대한 의견을 남겨 주세요.';
  label.append(input);
  const controls = make('div', '', 'recipe-comment-controls'), submit = make('button', '댓글 등록'); submit.type = 'submit'; controls.append(submit);
  form.append(label, controls); section.append(header, list, form, status); detail.append(section);
  let loaded = false, loading = false;
  const load = async () => {
    if (loading) return;
    loading = true; refresh.disabled = true; submit.disabled = true; status.textContent = '댓글을 불러오고 있습니다.';
    try {
      const data = await api('/api/recipe-comments?postId=' + post.id);
      list.replaceChildren(); heading.textContent = '댓글 ' + data.comments.length;
      post.comment_count = data.comments.length;
      const count = card.querySelector('.recipe-comment-count');
      if (count) { count.textContent = String(post.comment_count); count.setAttribute('aria-label', '댓글 ' + post.comment_count + '개'); }
      for (const comment of data.comments) {
        const item = make('article', '', 'recipe-comment'), meta = make('div', '', 'recipe-comment-meta');
        const author = make('strong', comment.author), time = make('time', date(comment.created_at)); time.dateTime = comment.created_at; meta.append(author, time);
        const body = make('p', comment.body, 'recipe-comment-body'), actions = make('div', '', 'recipe-comment-controls'); item.append(meta, body);
        if (comment.canEdit) {
          const edit = make('button', '수정'); edit.type = 'button'; actions.append(edit);
          const editForm = make('form', '', 'recipe-comment-edit'); editForm.hidden = true;
          const editLabel = make('label', '댓글 수정'), text = make('textarea'); text.rows = 3; text.maxLength = 2000; text.required = true; text.value = comment.body; editLabel.append(text);
          const editActions = make('div', '', 'recipe-comment-controls'), save = make('button', '저장'), cancel = make('button', '취소');
          save.type = 'submit'; cancel.type = 'button'; editActions.append(save, cancel); editForm.append(editLabel, editActions); item.append(editForm);
          edit.addEventListener('click', () => { editForm.hidden = false; text.focus(); });
          cancel.addEventListener('click', () => { editForm.hidden = true; text.value = comment.body; });
          editForm.addEventListener('submit', async event => {
            event.preventDefault(); if (save.disabled || !editForm.reportValidity()) return;
            save.disabled = true;
            try { await api('/api/recipe-comments?id=' + comment.id, options('PATCH', { body: text.value })); await load(); }
            catch (error) { status.textContent = error.message; }
            finally { save.disabled = false; }
          });
        }
        if (comment.canDelete) {
          const remove = make('button', '삭제'); remove.type = 'button'; actions.append(remove);
          remove.addEventListener('click', async () => {
            if (remove.disabled || !confirm('이 댓글을 삭제할까요?')) return;
            remove.disabled = true;
            try { await api('/api/recipe-comments?id=' + comment.id, options('DELETE')); await load(); }
            catch (error) { status.textContent = error.message; }
            finally { remove.disabled = false; }
          });
        }
        item.append(actions); list.append(item);
      }
      if (!data.comments.length) list.append(make('p', '아직 댓글이 없습니다. 첫 댓글을 남겨 주세요.', 'recipe-comments-empty'));
      loaded = true; status.textContent = '';
    } catch (error) { status.textContent = error.message; }
    finally { loading = false; refresh.disabled = false; submit.disabled = false; }
  };
  refresh.addEventListener('click', load);
  card.addEventListener('toggle', () => { if (card.open && !loaded) load(); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (submit.disabled || !form.reportValidity()) return;
    submit.disabled = true; status.textContent = '댓글을 저장하고 있습니다.';
    try { await api('/api/recipe-comments', options('POST', { postId: post.id, body: input.value })); input.value = ''; await load(); }
    catch (error) { status.textContent = error.message; }
    finally { submit.disabled = false; }
  });
}
