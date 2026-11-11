// Random identifiers generator: a random name and address, made in this browser only.
// (In the code these are a "persona". People see the words "random identifiers".)
// The card shows them with copy buttons. The caller saves them (encrypted, like a label).
import { h, replace, uid } from '../lib/dom.js';
import { COUNTRIES, generatePersona, fullName, addressLines, singleLine, isPersona } from '../lib/persona/index.js';
import { icon } from './icons.js';
import { button, copyButton, checkbox, runBusy, reportError } from './components.js';
import { openDialog, confirmDialog } from './dialog.js';
import { toast } from './toast.js';
import { phoneText } from '../lib/format.js';
import { setItemPersona, setItemExtra } from '../lib/data.js';
import { store, appName } from '../lib/store.js';
import { makeUsername, makePassword, passwordStrength, MIN_LENGTH } from '../lib/credentials.js';
import { why, whyParts, whyGroup } from './why.js';

// The words for the fields that differ between countries.
const WORDS = {
  US: { unit: 'Apartment', region: 'State', postalCode: 'ZIP code' },
  default: { unit: 'Unit', region: 'Region', postalCode: 'Postal code' },
};

export const HONEST_LINE = 'These identifiers are made up. Do not use them where the law requires your real name and address, for example at a bank or on a government form.';

// A saved username, checked (another version of the app may have written it). '' = none.
export const cleanUsername = (value) => (typeof value === 'string' && /^[a-z][a-z0-9_]{2,39}$/.test(value) ? value : '');

const PASSWORD_LENGTHS = [12, 16, 20, 24, 32];
// The strength in plain words, from the number of random bits of the password.
function strengthWords(length, symbols) {
  const bits = passwordStrength(length, symbols);
  return bits >= 100 ? 'Very strong' : bits >= 75 ? 'Strong' : 'Good for most websites';
}

// persona: the saved details or null. onSave(next) saves and returns a promise
// (next = new identifiers, or null to remove). The card repaints after a save.
// username: the saved username or ''. onSaveUsername(next) saves it (next = a username, or null to remove).
// A password is made and shown here, and saved nowhere: it is gone when the card paints again or goes away.
export function personaCard({ persona = null, onSave, username = '', onSaveUsername = null, headingLevel = 'h3', showTitle = true }) {
  let current = isPersona(persona) ? persona : null;
  let country = current ? current.country : COUNTRIES[0].code;
  let name = cleanUsername(username);
  const el = h('section', { class: 'persona', 'aria-label': 'Random identifiers generator' });

  // ---- username (saved encrypted) and password (never saved) ----
  const loginSlot = h('div', { class: 'persona-login' });
  let passwordLength = 20;
  let passwordSymbols = true;
  const passwordSlot = h('div', { class: 'persona-password' });

  function paintPassword(value) {
    if (!value) {
      replace(passwordSlot, h('div', null, button('Make a password', { size: 'sm', iconName: 'key', onClick: () => { paintPassword(makePassword({ length: passwordLength, symbols: passwordSymbols })); passwordSlot.querySelector('.password-value')?.focus(); } })));
      return;
    }
    const lengthId = uid('pwlen');
    const length = h('select', { id: lengthId, class: 'input select', onChange: (e) => { passwordLength = Number(e.target.value) || 20; remake(); } },
      PASSWORD_LENGTHS.filter((n) => n >= MIN_LENGTH).map((n) => h('option', { value: String(n), selected: n === passwordLength }, `${n} characters`)));
    const symbols = checkbox('With symbols', { checked: passwordSymbols, onChange: (on) => { passwordSymbols = on; remake(); } });
    const remake = () => { paintPassword(makePassword({ length: passwordLength, symbols: passwordSymbols })); };
    replace(passwordSlot,
      h('div', { class: 'password-box' },
        h('p', { class: 'password-value mono break', tabIndex: -1, 'aria-label': 'New password' }, value),
        copyButton(() => value, 'Copy password', { what: 'Password copied', withLabel: true, cls: 'btn-sm' }),
      ),
      h('p', { class: 'password-warning', role: 'note' }, `${appName()} does not save this password. Save it in your password manager now.`),
      h('p', { class: 'small muted password-strength' }, 'Strength: ', h('span', { class: 'strong' }, strengthWords(passwordLength, passwordSymbols)), '.'),
      h('div', { class: 'password-options' },
        h('div', { class: 'field' }, h('label', { class: 'label', for: lengthId }, 'Length'), h('div', { class: 'select-wrap' }, length, icon('chevronDown', { size: 16, cls: 'select-caret' }))),
        symbols.el,
      ),
      h('div', { class: 'row row-wrap row-2' },
        button('Make another password', { size: 'sm', iconName: 'refresh', onClick: () => { remake(); passwordSlot.querySelector('.password-value')?.focus(); } }),
        button('Hide', { size: 'sm', onClick: () => { paintPassword(''); passwordSlot.querySelector('button')?.focus(); } }),
      ),
    );
  }

  function paintLogin() {
    if (!onSaveUsername || !current) { replace(loginSlot); return; }
    const save = (btn, next, done) => runBusy(btn, async () => {
      await onSaveUsername(next);
      name = next || '';
      paintLogin();
      toast(done, { kind: 'ok', timeout: 2200 });
      loginSlot.querySelector(next ? '.persona-username' : 'button')?.focus?.();
    });
    replace(loginSlot,
      h('h4', { class: 'persona-subtitle' }, 'Username and password'),
      name
        ? h('div', { class: 'persona-username-row' },
          h('span', { class: 'small muted' }, 'Username'),
          h('span', { class: 'persona-username mono strong break', tabIndex: -1 }, name),
          copyButton(() => name, 'Copy username', { what: 'Username copied', cls: 'icon-btn-sm' }),
        )
        : null,
      h('div', { class: 'row row-wrap row-2' },
        button(name ? 'Make new username' : 'Make a username', { size: 'sm', iconName: name ? 'refresh' : 'person', onClick: (e, btn) => save(btn, makeUsername(current), name ? 'New username made' : 'Username made') }),
        name ? button('Remove username', { size: 'sm', onClick: (e, btn) => save(btn, null, 'Username removed') }) : null,
      ),
      h('p', { class: 'hint' }, 'The username is saved with these identifiers, encrypted. A password is never saved.'),
      passwordSlot,
    );
  }

  const countryPicker = () => {
    const id = uid('country');
    const select = h('select', { id, class: 'input select', onChange: (e) => { country = e.target.value; } },
      COUNTRIES.map((c) => h('option', { value: c.code, selected: c.code === country }, c.label)));
    return h('div', { class: 'field persona-country' },
      h('label', { class: 'label', for: id }, 'Country for new identifiers'),
      h('div', { class: 'select-wrap' }, select, icon('chevronDown', { size: 16, cls: 'select-caret' })),
    );
  };

  async function make(btn, replaceOld) {
    if (replaceOld) {
      const ok = await confirmDialog({
        title: 'Make new identifiers?', confirmLabel: 'Make new identifiers', danger: false,
        message: 'The name and address you have now are replaced. If you gave them to a site, write them down first.',
      });
      if (!ok) return;
    }
    await runBusy(btn, async () => {
      const next = await generatePersona(country);
      await onSave(next);
      current = next;
      paint();
      toast(replaceOld ? 'New identifiers made' : 'Identifiers made', { kind: 'ok', timeout: 2200 });
      el.querySelector('.persona-name')?.focus?.();
    });
  }

  function fieldRow(label, value, extra = '') {
    return h('div', { class: 'persona-field' },
      h('dt', null, label),
      h('dd', null, h('span', { class: 'persona-value break' }, value), extra ? h('span', { class: 'persona-extra' }, extra) : null),
      copyButton(() => value, `Copy ${label.toLowerCase()}`, { what: `${label} copied`, cls: 'icon-btn-sm' }),
    );
  }

  function paint() {
    const title = showTitle ? h(headingLevel, { class: 'persona-title' }, 'Random identifiers generator') : null;
    paintPassword(''); // a password never stays when the card is painted again
    paintLogin();
    if (!current) {
      replace(el,
        title,
        h('p', { class: 'small muted' }, 'A random name and address for sign-up forms. The city, state and ZIP code are real. The street and the person are not.'),
        why('made-up-details', { text: 'Why random identifiers?' }),
        countryPicker(),
        h('div', null, button('Make random identifiers', { iconName: 'plus', onClick: (e, btn) => make(btn, false) })),
        h('p', { class: 'persona-honest hint' }, HONEST_LINE),
      );
      return;
    }
    const p = current;
    const words = WORDS[p.country] || WORDS.default;
    const lines = addressLines(p);
    replace(el,
      title,
      h('div', { class: 'persona-card' },
        h('div', { class: 'persona-block' },
          h('div', { class: 'grow' }, h('p', { class: 'persona-name', tabIndex: -1 }, fullName(p))),
          copyButton(() => fullName(p), 'Copy name', { what: 'Name copied', withLabel: true, cls: 'btn-sm' }),
        ),
        h('div', { class: 'persona-block' },
          h('address', { class: 'grow persona-address' }, lines.map((line) => h('span', null, line))),
          copyButton(() => singleLine(p), 'Copy address', { what: 'Address copied', withLabel: true, cls: 'btn-sm' }),
        ),
        h('dl', { class: 'persona-fields' },
          fieldRow('First name', p.firstName),
          fieldRow('Last name', p.lastName),
          fieldRow('Street', p.street),
          p.unit ? fieldRow(words.unit, p.unit) : null,
          fieldRow('City', p.city),
          fieldRow(words.region, p.region, p.regionName && p.regionName !== p.region ? p.regionName : ''),
          fieldRow(words.postalCode, p.postalCode),
        ),
        loginSlot,
      ),
      h('p', { class: 'persona-honest hint' }, HONEST_LINE),
      why('made-up-details', { text: 'Why random identifiers?' }),
      h('div', { class: 'persona-actions' },
        countryPicker(),
        h('div', { class: 'row row-wrap row-2' },
          button('Make new identifiers', { size: 'sm', iconName: 'refresh', onClick: (e, btn) => make(btn, true) }),
          button('Remove identifiers', { size: 'sm', kind: 'danger', onClick: async (e, btn) => {
            const ok = await confirmDialog({ title: 'Remove these identifiers?', message: 'The random name and address are deleted. You cannot get the same ones back.', confirmLabel: 'Remove identifiers' });
            if (!ok) return;
            await runBusy(btn, async () => {
              await onSave(null);
              current = null;
              // The username belongs to the card: it goes with it.
              if (name && onSaveUsername) { try { await onSaveUsername(null); } catch { /* the identifiers are removed; the username can be removed later */ } name = ''; }
              paint();
              toast('Identifiers removed', { kind: 'ok', timeout: 2200 });
            });
          } }),
        ),
      ),
    );
  }

  paint();
  // The saved details changed somewhere else (another tab, a reload).
  el.setPersona = (next) => {
    const value = isPersona(next) ? next : null;
    if (JSON.stringify(value) === JSON.stringify(current)) return;
    current = value;
    if (current) country = current.country;
    paint();
  };
  // The saved username changed somewhere else. The password that is on the screen stays.
  el.setUsername = (next) => {
    const value = cleanUsername(next);
    if (value === name) return;
    name = value;
    paintLogin();
  };
  return el;
}

// The card in a dialog, for one alias or one number (from the row menu).
export function openPersonaDialog(item) {
  const kind = item.kind;
  const now = ((kind === 'alias' ? store.get('aliases') : store.get('numbers')) || []).find((x) => x.id === item.id);
  if (!now) { reportError(new Error('This item does not exist any more.')); return; }
  openDialog({
    title: 'Random identifiers generator', size: 'md',
    content: (api) => h('div', { class: 'stack' },
      h('p', { class: 'mono small muted break' }, kind === 'number' ? phoneText(now.number) : now.address),
      personaCard({ persona: now.persona, showTitle: false, onSave: (next) => setItemPersona(kind, item.id, next), username: now.extra && now.extra.username, onSaveUsername: (next) => setItemExtra(kind, item.id, { username: next }) }),
      h('div', { class: 'dialog-actions' }, button('Done', { kind: 'primary', onClick: () => api.close() })),
    ),
    cls: 'persona-dialog',
  });
}
