// Voicemail: the switch in the Settings tab of a number, and the line with "Play" under a call.
//
// The server records nothing by itself: voicemail is off for each number until the person
// turns it on here. Before that, this section says the price, the longest message, the words
// of the greeting, and what the phone company hears and keeps.
import { h, replace } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { api, ApiError } from '../lib/api.js';
import { registerNumberSetting, registerCallAddon } from '../lib/registry.js';
import { loadNumbers } from '../lib/data.js';
import { money } from '../lib/format.js';
import { button, toggle, callout } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { switchOf, setSwitch, loadSwitches, voicemailOf, askVoicemail, loadVoicemailAudio } from './voicemail/calls.js';
import { voicemailLine } from './voicemail/line.js';

// The words that the caller hears. The server says exactly this (docs/API.md, "Voicemail").
export const GREETING = 'The person you called is not available. Please leave a message after the tone.';

const appName = () => { const c = store.get('config'); return (c && c.appName) || 'Postern'; };
const lengthText = (seconds) => (seconds % 60 === 0 ? `${seconds / 60} ${seconds === 60 ? 'minute' : 'minutes'}` : `${seconds} seconds`);

// ---------- the Settings tab of a number ----------

// The server said "the phone company cannot record" in this tab. /api/config does not say it yet.
let noRecording = false;

function phoneCompanyNote() {
  const app = appName();
  return callout('info', 'What the phone company hears and keeps',
    h('p', null, 'The phone company plays the greeting and records the message. So it hears the whole message.'),
    h('p', null, `${app} deletes the recording at the phone company right after it has stored its own encrypted copy. From then on, only your browser can play the message.`),
    h('p', null, `The phone company can keep its call records: who called which number, when, and for how long. It can also keep its own backups for some time. ${app} cannot delete those.`),
    h('p', null, `${app} does not ask the phone company to turn the message into text.`),
  );
}

function voicemailSetting({ number, scope }) {
  const config = store.get('config') || {};
  const features = config.features || {};
  if (!features.phone) return null;
  if (!number.voice) return h('p', { class: 'muted read', dataset: { vm: 'no-voice' } }, 'This number cannot make or get calls, so it has no voicemail.');
  const price = (config.prices && config.prices.voicemail) || 0;
  const maxSeconds = config.voicemailMaxSeconds || 120;
  const box = h('div', { class: 'sheet sheet-pad stack' });

  function paint() {
    if (noRecording || features.voicemail === false) {
      replace(box, h('p', { class: 'muted read', dataset: { vm: 'no-recording' } }, 'The phone company of this server cannot record a caller, so there is no voicemail here.'));
      return;
    }
    const on = switchOf(number);
    const balance = store.get('balance') || 0;
    const control = on === undefined
      ? h('span', { class: 'small muted', role: 'status' }, 'Loading…')
      : toggle({ checked: on, label: 'Take voicemail', withText: true, onChange: async (next) => {
        let res;
        try {
          res = await api.patch(`/api/numbers/${number.id}`, { voicemail: next });
        } catch (err) {
          if (err instanceof ApiError && err.code === 'no_voicemail') { noRecording = true; if (!scope.disposed) paint(); return; }
          throw err; // the switch goes back; a 402 opens "Add funds"
        }
        setSwitch(number.id, res && res.number ? res.number.voicemail === true : next);
        loadNumbers().catch(() => {});
        toast(next ? 'Voicemail turned on' : 'Voicemail turned off', { kind: 'ok', timeout: 2600 });
        if (!scope.disposed) paint();
      } });
    replace(box,
      h('dl', { class: 'kv kv-left' },
        h('dt', null, 'Price'), h('dd', null, price ? [h('span', { class: 'mono' }, money(price)), ' for each message that is stored'] : 'Free'),
        h('dt', null, 'Longest message'), h('dd', null, lengthText(maxSeconds)),
        h('dt', null, 'Greeting'), h('dd', null, h('p', null, `“${GREETING}”`), h('p', { class: 'small muted' }, 'The greeting has no name and no number in it.')),
      ),
      phoneCompanyNote(),
      number.status !== 'active' ? h('p', { class: 'small muted' }, 'This number is paused. A caller gets no voicemail until it is on again.') : null,
      price && on && balance < price ? h('p', { class: 'small', dataset: { vm: 'low' } },
        `Your balance is below ${money(price)}. A caller gets no voicemail until you add funds. `,
        features.pay ? h('a', { href: '/funds', 'data-link': true }, 'Add funds') : null) : null,
      h('div', { class: 'switch-row' },
        h('div', { class: 'grow' },
          h('p', { class: 'strong' }, 'Take voicemail'),
          h('p', { class: 'small muted' }, 'When a call is not forwarded, or when nobody answers, the caller hears the greeting and can leave a message. You find it in the Calls tab.'),
        ),
        control,
      ),
    );
  }
  paint();
  if (switchOf(number) === undefined) {
    const load = () => loadSwitches().then(() => { if (!scope.disposed) paint(); }).catch(() => {
      if (scope.disposed) return;
      replace(box, h('p', { class: 'muted' }, 'This setting did not load.'), h('div', null, button('Try again', { size: 'sm', iconName: 'refresh', onClick: () => { paint(); load(); } })));
    });
    load();
  }
  // The low-balance line follows the balance. A section that left the page stops listening.
  const off = store.subscribe(['balance'], () => {
    if (scope.disposed || !box.isConnected) { off(); return; }
    if (switchOf(number) !== undefined) paint();
  });
  scope.add(off);
  return box;
}

registerNumberSetting({
  id: 'voicemail',
  title: 'Voicemail',
  lede: 'A caller who does not reach you can leave a message. It is encrypted for you like your mail. Voicemail is off until you turn it on.',
  order: 25,
  render: voicemailSetting,
});

// ---------- the Calls tab ----------

const lineOf = (call, voicemail) => voicemailLine({ key: call.id, seconds: voicemail.seconds, at: call.at, load: () => loadVoicemailAudio(call.id, voicemail) });

registerCallAddon((call, number) => {
  if (call.direction !== 'in') return null;
  const voicemail = voicemailOf(call, number);
  if (voicemail) return lineOf(call, voicemail);
  // A call with a voicemail is in the list as a missed call. Other calls need no question.
  if (voicemail === null || call.status !== 'missed') return null;
  const holder = h('span', { hidden: true });
  askVoicemail(call, number).then((found) => { if (found && holder.isConnected) holder.replaceWith(lineOf(call, found)); });
  return holder;
});
