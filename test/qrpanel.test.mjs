/**
 * The QR panel beside the shortcut field, run rather than read.
 *
 * Every other test of this script looks for strings in its source, which
 * is how the panel came to advertise the wrong link for as long as it did:
 * the shortcut field was read, the directory select was never mentioned,
 * and nothing was looking for a mention that had never been there. A code
 * for `ptra.dev/o` beside a link that lives at `ptra.dev/a/o` scans, opens
 * something else, and looks right while doing it.
 *
 * So this suite runs the script the browser is served, against a stub of
 * the few DOM calls it makes, and reads back the URL the panel asked for.
 * The stub answers the selectors this screen provides and `null` for the
 * rest, the way a real page without those controls would; a script that
 * starts looking somewhere else fails here loudly rather than quietly
 * drawing the wrong code.
 */
import { Harness } from './harness.js';
import { JS } from '../assets.js';

let passed = 0;
let failed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; return; }
  failed++;
  console.log('  FAIL: ' + name + (extra ? ' -- ' + extra : ''));
}
function section(n) { console.log('\n' + n); }

/* ------------------------------------------------------------ the stub */

/** One element: the handful of members the script touches, nothing more. */
function node(attrs = {}, inside = {}) {
  const self = {
    attrs: { ...attrs },
    value: attrs.value === undefined ? '' : String(attrs.value),
    hidden: false,
    textContent: '',
    fired: {},
    getAttribute: (name) => (name in self.attrs ? String(self.attrs[name]) : null),
    setAttribute: (name, value) => { self.attrs[name] = String(value); },
    addEventListener: (name, fn) => { (self.fired[name] = self.fired[name] || []).push(fn); },
    querySelector: (sel) => inside[sel] || null,
    /** What the browser does when somebody types or picks. */
    emit: (name) => { for (const fn of self.fired[name] || []) fn({}); },
  };
  return self;
}

/**
 * A page carrying only the QR panel and the fields it reads.
 *
 * `panel` is built from the attributes the server actually rendered, so
 * the markup and the script are tested against each other rather than
 * against a copy of what either was expected to say.
 */
function screen(panelAttrs, { pathField, dirValue = null, hostValue = null }) {
  const img = node();
  const label = node();
  const panel = node(panelAttrs, { img, '[data-slink-qr-label]': label });
  const shortcut = node({ value: '' });
  const dir = dirValue === null ? null : node({ value: dirValue });
  const host = hostValue === null ? null : node({ value: hostValue });

  const by = {
    '[data-slink-qr]': panel,
    ['[name="' + pathField + '"]']: shortcut,
    'select[name="dir"]': dir,
    'select[name="host"]': host,
  };

  const pending = [];
  const win = {
    setTimeout: (fn) => { pending.push(fn); return pending.length; },
    clearTimeout: (id) => { if (id) pending[id - 1] = null; },
    confirm: () => true,
  };
  const doc = {
    documentElement: { classList: { add() {} } },
    body: node(),
    addEventListener() {},
    createElement: () => node(),
    getElementById: () => null,
    querySelector: (sel) => (sel in by ? by[sel] : null),
  };

  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'location', 'history', 'navigator', 'screen', JS)(
    win,
    doc,
    { hash: '', pathname: '/admin/links/edit', search: '' },
    { replaceState() {} },
    {},
    {}
  );

  return {
    panel, img, label, shortcut, dir, host,
    /** Run whatever the debounce is holding. */
    settle: () => { for (const fn of pending.splice(0)) if (fn) fn(); },
  };
}

/* ------------------------------------------------ the rendered markup */

const root = new Harness();
await root.signIn('root@pontera.com');

const mkDir = async (host, path, extra = {}) => {
  const token = Harness.csrfFor(
    await (await root.req('https://ptra.dev/admin/directories')).text(),
    '/admin/directories/new'
  );
  return root.req('https://ptra.dev/admin/directories/new', {
    form: { _csrf: token, host, path, ...extra },
  });
};
const mkLink = async (form) =>
  root.req('https://ptra.dev/admin/links/new', {
    form: {
      _csrf: Harness.csrf(await (await root.req('https://ptra.dev/admin/links/new')).text()),
      status: '302',
      ...form,
    },
  });

await mkDir('ptra.dev', 'a');
await mkLink({ host: 'ptra.dev', dir: 'ptra.dev/a', path: 'o', target: 'https://example.com/okta' });

const page = async (url) => (await root.req(url)).text();

/** The panel's own attributes, as the server wrote them. */
function panelOf(html) {
  const tag = html.match(/<aside class="qrfloat"[\s\S]*?>/);
  if (!tag) return null;
  const attrs = {};
  for (const m of tag[0].matchAll(/([a-z-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
  return attrs;
}

const EDIT = 'https://ptra.dev/admin/links/edit?host=ptra.dev&path=a%2Fo';

/* ------------------------------------- 1. the directory is half the link */
section('the panel asks for the link the screen is editing');
{
  const html = await page(EDIT);
  const attrs = panelOf(html);
  ok('the edit screen carries the panel', !!attrs);
  ok('and names the directory select it must read', attrs['data-dir-field'] === 'dir',
     String(attrs['data-dir-field']));
  // The field it names has to be on the page, or the script reads nothing
  // and silently falls back to a shortcut with no directory in front.
  ok('which the screen really has',
     new RegExp('<select[^>]*name="' + attrs['data-dir-field'] + '"').test(html));

  const s = screen(attrs, { pathField: attrs['data-path-field'], dirValue: 'ptra.dev/a' });
  s.shortcut.value = 'o';
  s.shortcut.emit('input');
  s.settle();
  const src = s.img.getAttribute('src') || '';
  ok('the directory is in front of the shortcut', /[?&]path=a%2Fo(&|$)/.test(src), src);
  ok('and the caption says the same', s.label.textContent === 'ptra.dev/a/o', s.label.textContent);
  ok('the panel is shown', s.panel.hidden === false);

  // Moving it is a directory change with no keystroke in the shortcut.
  s.dir.value = 'ptra.dev/';
  s.dir.emit('change');
  s.settle();
  ok('choosing the root drops the directory again',
     /[?&]path=o(&|$)/.test(s.img.getAttribute('src') || ''),
     s.img.getAttribute('src') || '');
  ok('and the caption follows', s.label.textContent === 'ptra.dev/o', s.label.textContent);

  // The select carries its own domain, so a move across domains moves the
  // code with it without a separate host control to agree with.
  s.dir.value = 'ptra.cc/pub';
  s.dir.emit('change');
  s.settle();
  const moved = s.img.getAttribute('src') || '';
  ok('a place on another domain takes the code with it',
     /[?&]host=ptra\.cc(&|$)/.test(moved) && /[?&]path=pub%2Fo(&|$)/.test(moved), moved);
}

/* ------------------------------------- 2. what the card is showing */
section('the panel shows what the card shows');
{
  const plain = panelOf(await page(EDIT));
  ok('a screen with no choices made asks for no centre image', plain['data-logo'] === '',
     plain['data-logo']);

  const chosen = await page(EDIT + '&qrlogo=1&qrecc=Q&qrscale=0.25');
  const attrs = panelOf(chosen);
  ok('the brand mark reaches the panel', attrs['data-logo'] === '1', attrs['data-logo']);
  ok('with the durability chosen', attrs['data-ecc'] === 'Q', attrs['data-ecc']);
  ok('and the size chosen', attrs['data-logoscale'] === '0.25', attrs['data-logoscale']);

  // The card's own preview is rendered server-side; both must be asking
  // the same endpoint for the same picture, or the small one is a lie
  // about what a scan would get.
  // As written into an attribute, so the ampersands are escaped.
  const card = ((chosen.match(/<img class="qr" src="([^"]+)"/) || [])[1] || '').replace(/&amp;/g, '&');
  const s = screen(attrs, { pathField: attrs['data-path-field'], dirValue: 'ptra.dev/a' });
  s.shortcut.value = 'o';
  s.shortcut.emit('input');
  s.settle();
  const src = s.img.getAttribute('src') || '';
  const options = (u) => {
    const q = new URLSearchParams(u.slice(u.indexOf('?') + 1));
    return ['host', 'path', 'ecc', 'logo', 'logoscale'].map((k) => k + '=' + (q.get(k) || '')).join(' ');
  };
  ok('the two agree on what is being shown', options(src) === options(card),
     options(src) + '  vs  ' + options(card));
}

/* ------------------------------------- 3. the create screen */
section('the create screen, where there is no link yet');
{
  const attrs = panelOf(await page('https://ptra.dev/admin/links/new'));
  ok('it carries the panel too', !!attrs);
  const s = screen(attrs, {
    pathField: attrs['data-path-field'],
    dirValue: 'ptra.dev/a',
    hostValue: 'ptra.dev',
  });
  ok('nothing typed yet shows nothing', s.panel.hidden === true);

  s.shortcut.value = 'deck';
  s.shortcut.emit('input');
  s.settle();
  ok('a shortcut in a directory reads as one',
     /[?&]path=a%2Fdeck(&|$)/.test(s.img.getAttribute('src') || ''),
     s.img.getAttribute('src') || '');

  // A shortcut the server would refuse is not a request worth making. A
  // trailing slash is not one of those: it is trimmed, the way the server
  // trims it.
  s.shortcut.value = 'deck/';
  s.shortcut.emit('input');
  s.settle();
  ok('a trailing slash is trimmed rather than refused',
     /[?&]path=a%2Fdeck(&|$)/.test(s.img.getAttribute('src') || ''),
     s.img.getAttribute('src') || '');

  s.shortcut.value = 'my deck';
  s.shortcut.emit('input');
  s.settle();
  ok('a shortcut with a space in it asks for nothing', s.panel.hidden === true);
}

console.log(`\nqr panel: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
