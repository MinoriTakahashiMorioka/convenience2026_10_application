import { h } from './dom.js';
import { icon } from './icons.js';
import { openSheet } from './sheet.js';
import { showToast } from './toast.js';
import { KINDS, checkPassword } from './vault.js';

/**
 * 非表示リストの入口（パスワードを決める・入力する画面）と、パスワードの設定シート。
 * メモ・アルバムで共通です。
 */

/** 数字 / 英字と数字 を選ぶボタン */
function kindSwitch(initial, onChange) {
  let current = initial;
  const buttons = Object.entries(KINDS).map(([id, k]) => h('button', {
    type: 'button', class: 'vault-kind', 'data-kind': id,
    onClick: () => { current = id; sync(); onChange(id); },
  }, k.name));
  const sync = () => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === current)));
  sync();
  return h('div', { class: 'vault-kinds', role: 'group', 'aria-label': 'パスワードの種類' }, buttons);
}

/** パスワード欄（見せる・隠すボタンつき） */
function secretInput({ id, kind, placeholder, autocomplete = 'off' }) {
  const input = h('input', {
    id, class: 'text-input vault-input', type: 'password', autocomplete, placeholder,
    inputmode: KINDS[kind]?.inputmode ?? 'text', spellcheck: 'false', autocapitalize: 'off',
    maxlength: '20',
  });
  const eye = h('button', { type: 'button', class: 'icon-btn vault-eye', 'aria-label': '入力した文字を表示' }, icon('eye'));
  eye.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
    eye.setAttribute('aria-label', show ? '文字を隠す' : '入力した文字を表示');
  });
  return { input, row: h('div', { class: 'vault-input-row' }, input, eye), setKind: (k) => { input.inputMode = KINDS[k].inputmode; } };
}

const errorBox = () => h('p', { class: 'form-error', role: 'alert', hidden: true });
const showError = (box, message) => { box.replaceChildren(icon('alert'), h('span', {}, message)); box.hidden = false; };

/**
 * 鍵がかかっているときに出す画面
 * @param {HTMLElement} root
 * @param {{ vault, what: string }} o   what … 'メモ' / 'アルバム'
 */
export function renderVaultGate(root, { vault, what }) {
  root.replaceChildren(vault.isSetUp() ? unlockForm() : setupForm());

  function setupForm() {
    let kind = 'pin';
    const pw = secretInput({ id: 'vault-new', kind, placeholder: KINDS.pin.hint, autocomplete: 'new-password' });
    const pw2 = secretInput({ id: 'vault-new2', kind, placeholder: 'もう一度', autocomplete: 'new-password' });
    const hint = h('p', { class: 'vault-hint' });
    const err = errorBox();
    const syncKind = (k) => {
      kind = k;
      pw.setKind(k); pw2.setKind(k);
      pw.input.placeholder = KINDS[k].hint;
      hint.replaceChildren(k === 'pin'
        ? h('span', {}, icon('alert'), ' 数字だけのパスワードは、のぞき見を防ぐためのものです。大事なものを入れるなら「英字と数字」がおすすめです。')
        : h('span', {}, '例: myMemo2026box（英字と数字をどちらも入れる）'));
    };
    syncKind(kind);
    return h('form', {
      class: 'vault-card', novalidate: true,
      onSubmit: async (e) => {
        e.preventDefault();
        const message = checkPassword(kind, pw.input.value);
        if (message) { showError(err, message); pw.input.focus(); return; }
        if (pw.input.value !== pw2.input.value) { showError(err, '2つのパスワードが同じではありません。'); pw2.input.focus(); return; }
        try {
          e.submitter && (e.submitter.disabled = true);
          await vault.setup(kind, pw.input.value);
          showToast('パスワードを決めました。非表示リストが使えます');
        } catch (er) { showError(err, er.message); e.submitter && (e.submitter.disabled = false); }
      },
    },
      h('div', { class: 'vault-icon' }, icon('lock')),
      h('h2', {}, '非表示リストのパスワードを決める'),
      h('p', { class: 'muted' }, `非表示にした${what}は、このパスワードを入れたときだけ見られます。メモとアルバムで同じパスワードを使います。`),
      kindSwitch(kind, syncKind),
      h('label', { class: 'field-label', for: 'vault-new' }, 'パスワード'),
      pw.row,
      h('label', { class: 'field-label', for: 'vault-new2' }, '確認のため、もう一度'),
      pw2.row,
      hint,
      h('p', { class: 'vault-warn' }, '⚠️ パスワードを忘れると、非表示にしたものは取り出せません（中身は暗号化して保存します）。'),
      err,
      h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, icon('check'), 'このパスワードにする'),
    );
  }

  function unlockForm() {
    const kind = vault.kind() ?? 'text';
    const pw = secretInput({ id: 'vault-pw', kind, placeholder: KINDS[kind].hint, autocomplete: 'current-password' });
    const err = errorBox();
    const forgot = h('div', { class: 'vault-forgot' });
    const renderForgot = () => forgot.replaceChildren(h('button', { type: 'button', class: 'btn btn-danger-text btn-sm', onClick: askReset }, 'パスワードを忘れた'));
    function askReset() {
      const confirmInput = h('input', { class: 'text-input', type: 'text', placeholder: '「消す」と入力', 'aria-label': '確認のため「消す」と入力' });
      const btn = h('button', { type: 'button', class: 'btn btn-danger btn-sm', disabled: true, onClick: async () => { await vault.reset(); showToast('非表示リストをリセットしました'); } }, '非表示のものを消してリセット');
      confirmInput.addEventListener('input', () => { btn.disabled = confirmInput.value.trim() !== '消す'; });
      forgot.replaceChildren(h('div', { class: 'vault-reset' },
        h('p', {}, h('strong', {}, 'パスワードは取り出せません。'), 'リセットすると、メモとアルバムの非表示にしたものがすべて消え、新しいパスワードを決め直せます。'),
        confirmInput,
        h('div', { class: 'vault-reset-actions' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: renderForgot }, 'やめる'), btn),
      ));
    }
    renderForgot();
    queueMicrotask(() => pw.input.focus());
    return h('form', {
      class: 'vault-card', novalidate: true,
      onSubmit: async (e) => {
        e.preventDefault();
        const submit = e.submitter;
        if (submit) submit.disabled = true;
        try {
          await vault.open(pw.input.value);
        } catch (er) {
          showError(err, er.message);
          pw.input.select();
        } finally { if (submit) submit.disabled = false; }
      },
    },
      h('div', { class: 'vault-icon' }, icon('lock')),
      h('h2', {}, `非表示の${what}`),
      h('p', { class: 'muted' }, `パスワード（${KINDS[kind].name}）を入力してください。`),
      h('label', { class: 'visually-hidden', for: 'vault-pw' }, 'パスワード'),
      pw.row,
      err,
      h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, icon('lock'), '開く'),
      forgot,
    );
  }
}

/** パスワードを変えるシート */
export function openVaultSettings({ vault }) {
  return openSheet({
    title: '非表示リストのパスワード',
    render(sheet) {
      let kind = vault.kind() ?? 'pin';
      const oldPw = secretInput({ id: 'vault-old', kind: vault.kind() ?? 'text', placeholder: '今のパスワード', autocomplete: 'current-password' });
      const pw = secretInput({ id: 'vault-chg', kind, placeholder: KINDS[kind].hint, autocomplete: 'new-password' });
      const pw2 = secretInput({ id: 'vault-chg2', kind, placeholder: 'もう一度', autocomplete: 'new-password' });
      const err = errorBox();
      const syncKind = (k) => { kind = k; pw.setKind(k); pw2.setKind(k); pw.input.placeholder = KINDS[k].hint; };
      return h('form', {
        class: 'form', novalidate: true,
        onSubmit: async (e) => {
          e.preventDefault();
          const message = checkPassword(kind, pw.input.value);
          if (message) { showError(err, message); return; }
          if (pw.input.value !== pw2.input.value) { showError(err, '新しいパスワードが2つで同じではありません。'); return; }
          try {
            await vault.change(oldPw.input.value, kind, pw.input.value);
            sheet.close();
            showToast('パスワードを変えました');
          } catch (er) { showError(err, er.message); }
        },
      },
        h('p', { class: 'sheet-note' }, 'メモとアルバムの非表示リストで共通のパスワードです。'),
        h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'vault-old' }, '今のパスワード'), oldPw.row),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, '新しいパスワードの種類'), kindSwitch(kind, syncKind)),
        h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'vault-chg' }, '新しいパスワード'), pw.row),
        h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'vault-chg2' }, 'もう一度'), pw2.row),
        err,
        h('div', { class: 'sheet-actions' },
          h('span', { class: 'spacer' }),
          h('button', { type: 'button', class: 'btn btn-ghost', onClick: sheet.close }, 'キャンセル'),
          h('button', { type: 'submit', class: 'btn btn-primary' }, icon('check'), '変える')),
      );
    },
  });
}

/**
 * 鍵が開いていればすぐ action を実行。閉じていればパスワードのシートを出して、開いたら実行
 * @returns {Promise<boolean>} 実行したら true
 */
export function withOpenVault(vault, what, action) {
  if (vault.isOpen()) return action().then(() => true);
  return new Promise((resolve) => {
    let done = false;
    openSheet({
      title: '非表示リストのパスワード',
      onClose: () => { if (!done) resolve(false); },
      render(sheet) {
        const box = h('div', { class: 'vault-in-sheet' });
        renderVaultGate(box, { vault, what });
        const off = vault.subscribe(async () => {
          if (!vault.isOpen()) { renderVaultGate(box, { vault, what }); return; }
          off();
          done = true;
          try { await action(); resolve(true); } catch (err) { showToast(err.message); resolve(false); }
          sheet.close();
        });
        sheet.onCleanup?.(off);
        return box;
      },
    });
  });
}
