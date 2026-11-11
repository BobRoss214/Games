// Home warnings: what the balance will not cover, and what is paused.
//
// Everything is worked out in the browser from data that the app has already: the balance,
// the prices, and the "paid until" time and the status of each inbox and number.
// This file has no access to the page, to the network, or to storage.
//
// How the server renews (server/core/renew.js): when the paid time of an inbox or a number
// ends, the server takes the price for the next period from the balance. If the balance is
// too low, the item is paused. A paused number is released some days later (graceDays).
// A paused inbox is kept.

const DAY = 86400;
export const WARN_DAYS = 7;

const price = (prices, kind) => {
  const value = prices ? (kind === 'inbox' ? prices.mailboxMonth : prices.numberMonth) : 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
};
const list = (value) => (Array.isArray(value) ? value.filter((x) => x && typeof x === 'object') : []);

// now: Unix seconds. balance and prices: credits (100 = $1.00).
// mailboxes, numbers: [{ id, status, paidUntil }] as the store has them.
// Returns {
//   renewals: null, or { items: [{ kind, id, dueAt, cost }], total, firstAt, missing } when the
//             renewals of the next 7 days cost more than the balance (items: the earliest first),
//   paused:   [{ kind, id, releaseAt }]  releaseAt: when a paused number is released, or null,
// }
export function homeWarnings({ now, balance = 0, prices = null, graceDays = 0, mailboxes = [], numbers = [], days = WARN_DAYS } = {}) {
  const out = { renewals: null, paused: [] };
  if (!Number.isFinite(now)) return out;
  const have = Number.isFinite(balance) && balance > 0 ? balance : 0;
  const grace = Number.isFinite(graceDays) && graceDays > 0 ? graceDays : 0;
  const until = now + days * DAY;

  const due = [];
  for (const [kind, items] of [['inbox', list(mailboxes)], ['number', list(numbers)]]) {
    const cost = price(prices, kind);
    for (const item of items) {
      const paidUntil = Number.isFinite(item.paidUntil) && item.paidUntil > 0 ? item.paidUntil : 0;
      if (item.status !== 'active') {
        out.paused.push({ kind, id: item.id, releaseAt: kind === 'number' && grace && paidUntil ? paidUntil + grace * DAY : null });
      } else if (cost > 0 && paidUntil && paidUntil <= until) {
        due.push({ kind, id: item.id, dueAt: paidUntil, cost });
      }
    }
  }
  due.sort((a, b) => a.dueAt - b.dueAt);
  const total = due.reduce((sum, item) => sum + item.cost, 0);
  if (due.length && total > have) out.renewals = { items: due, total, firstAt: due[0].dueAt, missing: total - have };
  return out;
}
