/**
 * 用原生 <dialog> 做的三種對話框：確認、輸入文字、暗號題。
 * 不依賴任何元件框架，首頁與編輯頁共用。
 */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, children: (Node | string)[] = []) {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props;
  Object.assign(e, rest);
  if (cls) e.className = cls;
  for (const c of children) e.append(c);
  return e;
}

function openDialog(build: (dlg: HTMLDialogElement, close: (v: unknown) => void) => void): Promise<unknown> {
  return new Promise((resolve) => {
    const dlg = el('dialog', { class: 'vsp-dialog' });
    let done = false;
    const close = (v: unknown) => {
      if (done) return;
      done = true;
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) close(null);
    });
    build(dlg, close);
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function confirmDialog(opts: { title: string; message?: string; okLabel?: string; danger?: boolean }): Promise<boolean> {
  return openDialog((dlg, close) => {
    const ok = el('button', { class: `btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`, textContent: opts.okLabel ?? '確定', onclick: () => close(true) });
    const cancel = el('button', { class: 'btn', textContent: '取消', onclick: () => close(false) });
    dlg.append(el('h3', { textContent: opts.title }));
    if (opts.message) dlg.append(el('p', { textContent: opts.message }));
    dlg.append(el('div', { class: 'actions' }, [cancel, ok]));
    setTimeout(() => cancel.focus(), 0);
  }).then((v) => v === true);
}

export function promptDialog(opts: { title: string; message?: string; placeholder?: string; value?: string; okLabel?: string; skipLabel?: string }): Promise<string | null> {
  return openDialog((dlg, close) => {
    const input = el('input', { class: 'input', placeholder: opts.placeholder ?? '', value: opts.value ?? '' });
    const form = el('form', { onsubmit: (e: Event) => { e.preventDefault(); close(input.value); } });
    form.append(el('h3', { textContent: opts.title }));
    if (opts.message) form.append(el('p', { textContent: opts.message }));
    form.append(input);
    const actions = el('div', { class: 'actions' });
    actions.append(el('button', { class: 'btn', type: 'button', textContent: opts.skipLabel ?? '取消', onclick: () => close(null) }));
    actions.append(el('button', { class: 'btn btn-primary', type: 'submit', textContent: opts.okLabel ?? '確定' }));
    form.append(actions);
    dlg.append(form);
    setTimeout(() => input.focus(), 0);
  }) as Promise<string | null>;
}

/**
 * 暗號題。verify 回傳 true 表示答對；答錯就顯示錯誤、留在對話框裡再試。
 * 回傳 false 表示使用者取消。
 */
export function passphraseDialog(question: string, verify: (answer: string) => Promise<{ ok: boolean; message?: string }>): Promise<boolean> {
  return openDialog((dlg, close) => {
    const input = el('input', { class: 'input', autocomplete: 'off', autocapitalize: 'characters' });
    const err = el('div', { class: 'err' });
    const submit = el('button', { class: 'btn btn-primary', type: 'submit', textContent: '送出' });
    const form = el('form', {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        submit.disabled = true;
        err.textContent = '';
        try {
          const r = await verify(input.value);
          if (r.ok) close(true);
          else {
            err.textContent = r.message ?? '答案不對，再想想？';
            input.select();
          }
        } catch {
          err.textContent = '連線失敗，請再試一次';
        } finally {
          submit.disabled = false;
        }
      },
    });
    form.append(el('h3', { textContent: '第一次寫入請先回答一題' }));
    form.append(el('p', { textContent: '這是為了擋機器人。答對一次，這個裝置之後就不會再問。' }));
    form.append(el('label', { class: 'field' }, [el('span', { class: 'label', textContent: question }), input]));
    form.append(err);
    form.append(el('div', { class: 'actions' }, [el('button', { class: 'btn', type: 'button', textContent: '取消', onclick: () => close(false) }), submit]));
    dlg.append(form);
    setTimeout(() => input.focus(), 0);
  }).then((v) => v === true);
}

export function toast(message: string, ms = 2600) {
  const t = el('div', { textContent: message });
  Object.assign(t.style, {
    position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', background: 'var(--text)', color: 'var(--bg)',
    padding: '10px 16px', borderRadius: '10px', zIndex: '1000', maxWidth: '90vw', boxShadow: 'var(--shadow)', fontSize: '0.95rem',
  });
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
