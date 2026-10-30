import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { openSheet } from '../../core/sheet.js';
import { toDateKey } from '../../models/schema.js';
import {
  CREATOR_MAX, KINDS, MOVIE_WHERE, OTHER_GENRES, REVIEW_MAX, TITLE_MAX, kindOf, shrinkPhoto,
} from './repo.js';
import { starPicker } from './parts.js';

/**
 * 記録する・直すシート。
 * @param {Object} o
 * @param {ReturnType<import('./repo.js').createMediaRepo>} o.repo
 * @param {Object} [o.item]   直すとき
 * @param {string} [o.kind]   新しく書くときの最初の種類
 * @param {string} [o.date]   新しく書くときの日付
 * @param {(item) => void} [o.onSaved]
 */
export function openMediaEditor({ repo, item = null, kind = 'book', date, onSaved }) {
  const draft = {
    kind: item?.kind ?? kind,
    title: item?.title ?? '',
    creator: item?.creator ?? '',
    where: item?.where ?? '',
    area: item?.area ?? '',
    date: item?.date ?? date ?? toDateKey(),
    rating: item?.rating ?? 0,
    review: item?.review ?? '',
    photo: item?.photo ?? null,
  };

  return openSheet({
    title: item ? '記録を直す' : '記録する',
    render(sheet) {
      const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const showError = (msg) => { error.replaceChildren(icon('alert'), h('span', {}, msg)); error.hidden = false; };

      // ---------- 種類 ----------
      const kindBtns = KINDS.map((k) => h('button', {
        type: 'button', class: 'md-kind-btn', 'data-kind': k.id,
        onClick: () => { draft.kind = k.id; renderKind(); },
      }, icon(k.icon), k.name));
      const kindRow = h('div', { class: 'md-kind-pick', role: 'group', 'aria-label': '種類' }, kindBtns);

      // ---------- 写真 ----------
      const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', id: 'md-photo-file' });
      const photoBox = h('div', { class: 'md-photo-box' });
      const photoLabel = h('span', { class: 'field-label' });
      function renderPhoto(loading = false) {
        photoBox.replaceChildren(
          h('div', { class: `md-photo-preview${draft.photo ? '' : ' is-empty'}`, 'data-kind': draft.kind },
            loading ? h('span', { class: 'spinner', 'aria-label': '読み込み中' })
              : draft.photo ? h('img', { src: draft.photo, alt: '選んだ写真' })
                : icon('image')),
          h('div', { class: 'md-photo-actions' },
            h('label', { class: 'btn btn-ghost btn-sm', for: 'md-photo-file' }, icon('camera'), draft.photo ? '写真を変える' : '写真を選ぶ'),
            draft.photo && h('button', { type: 'button', class: 'btn btn-danger-text btn-sm', onClick: () => { draft.photo = null; renderPhoto(); } }, icon('trash'), '外す'),
            h('small', { class: 'md-photo-hint' }, '写真は小さくして保存します（なくても記録できます）'),
          ),
        );
      }
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        renderPhoto(true);
        try {
          draft.photo = await shrinkPhoto(file);
          error.hidden = true;
        } catch (err) {
          showError(err.message);
        }
        renderPhoto();
      });

      // ---------- 文字の欄 ----------
      const titleLabel = h('label', { class: 'field-label', for: 'md-title' });
      const title = h('input', { id: 'md-title', class: 'text-input', type: 'text', maxlength: String(TITLE_MAX), value: draft.title, autocomplete: 'off' });
      title.addEventListener('input', () => { draft.title = title.value; error.hidden = true; title.removeAttribute('aria-invalid'); });

      const creator = h('input', { id: 'md-creator', class: 'text-input', type: 'text', maxlength: String(CREATOR_MAX), value: draft.creator, autocomplete: 'off' });
      creator.addEventListener('input', () => { draft.creator = creator.value; });
      const creatorLabel = h('label', { class: 'field-label', for: 'md-creator' });
      const genreChips = h('div', { class: 'md-suggest' });

      const area = h('input', { id: 'md-area', class: 'text-input', type: 'text', maxlength: String(CREATOR_MAX), value: draft.area, placeholder: '例: 神奈川県藤沢市', autocomplete: 'off' });
      area.addEventListener('input', () => { draft.area = area.value; });

      const whereChips = h('div', { class: 'md-suggest', role: 'group', 'aria-label': 'どこで観たか' });
      function renderWhere() {
        whereChips.replaceChildren(...MOVIE_WHERE.map((w) => h('button', {
          type: 'button', class: 'chip chip-sm', 'aria-pressed': String(draft.where === w),
          onClick: () => { draft.where = draft.where === w ? '' : w; renderWhere(); },
        }, w)));
      }
      function renderGenres() {
        genreChips.replaceChildren(...OTHER_GENRES.map((g) => h('button', {
          type: 'button', class: 'chip chip-sm', 'aria-pressed': String(draft.creator === g),
          onClick: () => { draft.creator = draft.creator === g ? '' : g; creator.value = draft.creator; renderGenres(); },
        }, g)));
      }
      creator.addEventListener('input', () => { if (draft.kind === 'other') renderGenres(); });

      const dateLabel = h('label', { class: 'field-label', for: 'md-date' });
      const dateInput = h('input', { id: 'md-date', class: 'text-input', type: 'date', value: draft.date, max: toDateKey() });
      dateInput.addEventListener('input', () => { draft.date = dateInput.value; });

      const review = h('textarea', { id: 'md-review', class: 'text-input md-review', rows: 6, maxlength: String(REVIEW_MAX), placeholder: '感じたこと、心に残った場面や言葉、だれかにすすめたいところ など' });
      review.value = draft.review;
      const reviewCount = h('span', { class: 'char-count' });
      const updateCount = () => {
        const n = [...review.value].length;
        reviewCount.textContent = `${n}/${REVIEW_MAX}`;
        reviewCount.dataset.level = n >= REVIEW_MAX ? 'max' : n > REVIEW_MAX * 0.9 ? 'near' : '';
      };
      review.addEventListener('input', () => { draft.review = review.value; updateCount(); });
      updateCount();

      const creatorField = h('div', { class: 'field' }, creatorLabel, creator, genreChips);
      const whereField = h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'どこで観た？', h('span', { class: 'field-hint' }, '任意')), whereChips);
      const areaField = h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'md-area' }, '場所・住所', h('span', { class: 'field-hint' }, '任意')), area);

      function renderKind() {
        const k = kindOf(draft.kind);
        for (const b of kindBtns) b.setAttribute('aria-pressed', String(b.dataset.kind === k.id));
        photoLabel.textContent = k.photoLabel;
        titleLabel.replaceChildren(k.titleLabel, h('span', { class: 'field-hint' }, '必須'));
        title.placeholder = k.titlePlaceholder;
        dateLabel.replaceChildren(k.dateLabel);
        creatorField.hidden = !['book', 'other'].includes(k.id);
        creatorLabel.replaceChildren(k.id === 'book' ? '作者・著者' : 'ジャンル', h('span', { class: 'field-hint' }, '任意'));
        creator.placeholder = k.id === 'book' ? '例: サン＝テグジュペリ' : '例: ドラマ';
        genreChips.hidden = k.id !== 'other';
        whereField.hidden = k.id !== 'movie';
        areaField.hidden = k.id !== 'place';
        renderPhoto();
        renderWhere();
        renderGenres();
      }

      // ---------- 保存 ----------
      const footer = h('div', { class: 'sheet-actions' },
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-ghost', onClick: sheet.close }, 'キャンセル'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, icon('check'), '保存'),
      );

      const form = h('form', {
        class: 'form md-form',
        novalidate: true,
        onSubmit: (event) => {
          event.preventDefault();
          if (draft.date > toDateKey()) { showError('まだ来ていない日は選べません。'); dateInput.focus(); return; }
          try {
            const input = { ...draft, creator: ['book', 'other'].includes(draft.kind) ? draft.creator : '' };
            const saved = item ? repo.update(item.id, input) : repo.add(input);
            sheet.close();
            onSaved?.(saved, { isNew: !item });
          } catch (err) {
            showError(err.message);
            if (err.field === 'title') { title.setAttribute('aria-invalid', 'true'); title.focus(); }
            if (err.field === 'review') review.focus();
          }
        },
      },
        !item ? kindRow : null,
        h('div', { class: 'field' }, photoLabel, photoBox, fileInput),
        h('div', { class: 'field' }, titleLabel, title),
        creatorField,
        whereField,
        areaField,
        h('div', { class: 'form-row-2' },
          h('div', { class: 'field' }, dateLabel, dateInput),
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, '評価'), starPicker(draft.rating, (v) => { draft.rating = v; })),
        ),
        h('div', { class: 'field' },
          h('div', { class: 'label-row' }, h('label', { class: 'field-label', for: 'md-review' }, '感想', h('span', { class: 'field-hint' }, '任意')), reviewCount),
          review,
        ),
        error,
        footer,
      );
      // 日本語入力の確定 Enter で送信しない
      form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.preventDefault(); });

      renderKind();
      return form;
    },
  });
}
