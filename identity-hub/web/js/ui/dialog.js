// Dialogs use the native <dialog> element: focus trap, Escape and the backdrop come for free.
import { h, append, uid, focusFirst } from '../lib/dom.js';
import { icon } from './icons.js';

const openDialogs = new Set();
export function closeAllDialogs() {
  for (const d of [...openDialogs]) d.close();
}

// content: Node or (api) => Node, where api = { close, setBusy, setError, el }
// Returns { close, el, closed: Promise<result> }.
export function openDialog({ title, description = '', content, size = 'md', dismissable = true, cls = '' }) {
  const titleId = uid('dlg-title');
  const descId = description ? uid('dlg-desc') : null;
  let result;
  let resolveClosed;
  const closed = new Promise((r) => { resolveClosed = r; });

  const dialog = h('dialog', { class: `dialog dialog-${size} ${cls}`.trim(), 'aria-labelledby': titleId, 'aria-describedby': descId });
  const errorBox = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const api = {
    el: dialog,
    close(value) { result = value; if (dialog.open) dialog.close(); },
    setError(message) { errorBox.textContent = message || ''; errorBox.hidden = !message; if (message) errorBox.scrollIntoView({ block: 'nearest' }); },
    setBusy(on) { dialog.toggleAttribute('data-busy', !!on); for (const el of dialog.querySelectorAll('button, input, select, textarea')) { if (on) { if (!el.disabled) { el.disabled = true; el.dataset.wasEnabled = '1'; } } else if (el.dataset.wasEnabled) { el.disabled = false; delete el.dataset.wasEnabled; } } },
  };

  const body = typeof content === 'function' ? content(api) : content;
  append(dialog,
    h('div', { class: 'dialog-head' },
      h('h2', { id: titleId, class: 'dialog-title' }, title),
      dismissable ? h('button', { class: 'icon-btn dialog-x', type: 'button', 'aria-label': 'Close', onClick: () => api.close() }, icon('close', { size: 18 })) : null,
    ),
    description ? h('p', { id: descId, class: 'dialog-desc' }, description) : null,
    h('div', { class: 'dialog-body' }, body, errorBox),
  );

  dialog.addEventListener('cancel', (e) => { if (!dismissable || dialog.hasAttribute('data-busy')) e.preventDefault(); });
  // A click on the backdrop closes the dialog (the click target is the dialog itself).
  let downOnBackdrop = false;
  dialog.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === dialog; });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && downOnBackdrop && dismissable && !dialog.hasAttribute('data-busy')) api.close();
  });
  dialog.addEventListener('close', () => {
    openDialogs.delete(dialog);
    dialog.remove();
    resolveClosed(result);
  });

  document.body.appendChild(dialog);
  openDialogs.add(dialog);
  dialog.showModal();
  if (!dialog.querySelector('[autofocus]')) focusFirst(dialog.querySelector('.dialog-body') || dialog);
  return { ...api, closed };
}

// A dialog with one form. onSubmit may throw: the message shows inside the dialog.
// build(api) returns the form fields. Returns a promise with the value onSubmit returned, or undefined.
export function formDialog({ title, description, build, submitLabel, submitKind = 'primary', cancelLabel = 'Cancel', onSubmit, size = 'md', onError = null }) {
  const dlg = openDialog({
    title, description, size,
    content: (api) => {
      const submit = h('button', { class: `btn btn-${submitKind}`, type: 'submit' }, submitLabel);
      const form = h('form', { class: 'stack', novalidate: true, onSubmit: async (e) => {
        e.preventDefault();
        api.setError('');
        api.setBusy(true);
        submit.setAttribute('aria-busy', 'true');
        try {
          const value = await onSubmit(api);
          if (value !== false) api.close(value === undefined ? true : value);
        } catch (err) {
          const handled = onError ? onError(err, api) : false;
          if (!handled) api.setError(err && err.message ? err.message : 'That did not work. Try again.');
        } finally {
          submit.removeAttribute('aria-busy');
          api.setBusy(false);
        }
      } },
        build(api),
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn', type: 'button', onClick: () => api.close() }, cancelLabel),
          submit,
        ),
      );
      api.submitButton = submit;
      return form;
    },
  });
  return dlg.closed;
}

// Asks before a destructive action. With `typed`, the person must type that phrase.
export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true, typed = '', details = null }) {
  return new Promise((resolve) => {
    const dlg = openDialog({
      title, size: 'sm',
      content: (api) => {
        const confirm = h('button', { class: `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`, type: 'submit', disabled: !!typed }, confirmLabel);
        let input = null;
        if (typed) {
          const id = uid('confirm');
          input = h('input', { class: 'input mono', id, type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', onInput: () => { confirm.disabled = input.value.trim().toLowerCase() !== typed.toLowerCase(); } });
        }
        return h('form', { class: 'stack', onSubmit: (e) => { e.preventDefault(); if (!confirm.disabled) api.close(true); } },
          typeof message === 'string' ? h('p', { class: 'read' }, message) : message,
          details,
          typed ? h('div', { class: 'field' },
            h('label', { class: 'label', for: input.id }, 'Type ', h('span', { class: 'mono strong' }, typed), ' to confirm'),
            input,
          ) : null,
          h('div', { class: 'dialog-actions' },
            h('button', { class: 'btn', type: 'button', autofocus: !typed, onClick: () => api.close(false) }, 'Cancel'),
            confirm,
          ),
        );
      },
    });
    dlg.closed.then((v) => resolve(v === true));
  });
}
