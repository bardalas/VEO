"""Navigation QA driver (see docs/qa/navigation.md).
import sys as _s
try:
    _s.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

Presses the remote's keys on the emulator/device over adb and reads the focused element over the WebView's
DevTools socket, then checks the rules N1-N9. Writes tools/navqa-report.md.

    python tools/navqa.py [screen-hash ...]       (default: every screen)

Needs: adb on PATH (or ANDROID_SDK), `pip install websocket-client`, a debug build running, signed in or the
sign-in screen removable (the driver removes it).
"""
import json, os, subprocess, sys, time, urllib.request
from websocket import create_connection

ADB = os.environ.get('ADB') or os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Android', 'Sdk', 'platform-tools', 'adb.exe')
HERE = os.path.dirname(os.path.abspath(__file__))
KEYS = {'up': 19, 'down': 20, 'left': 21, 'right': 22, 'ok': 23, 'back': 4}
SETTLE = 0.9          # seconds for the focus/scroll to settle after a press

SCREENS = ['', 'cat/movies', 'cat/series', 'all/movie', 'all/series', 'library', 'live', 'shows',
           'shows/kan', 'shows/keshet', 'shows/reshet', 'search', 'settings/general', 'settings/profiles',
           'settings/account', 'settings/watch', 'settings/services', 'settings/home', 'settings/look',
           'settings/live', 'detail/movie/tt0133093', 'detail/series/tt0903747']       # route names; '#/' is put in front

PROBE = r"""
(() => {
  const vis = r => { const vh = innerHeight, vw = innerWidth;
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)), w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    return r.width * r.height ? +(h * w / (r.width * r.height)).toFixed(2) : 0; };
  const area = a => a.closest('#rail') ? 'rail' : a.closest('.strip') ? 'strip#' + [...document.querySelectorAll('.strip')].indexOf(a.closest('.strip'))
    : a.closest('.stabs') ? 'stabs' : a.closest('.spane') ? 'spane' : a.closest('.sortbar,.pagehead,.srctabs') ? 'head'
    : a.closest('.grid,.cards') ? 'grid' : a.closest('.epl,.eps,.episodes') ? 'episodes' : 'other';
  window.__qa = () => { const a = document.activeElement;
    if(!a || a === document.body) return {lost: true, sy: Math.round(scrollY), hash: location.hash};
    const r = a.getBoundingClientRect();
    return {lost: false, tag: a.tagName, id: a.id || '', txt: (a.innerText || a.getAttribute('aria-label') || a.getAttribute('title') || a.dataset.fid || '').trim().replace(/\s+/g, ' ').slice(0, 22),
      area: area(a), top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), vis: vis(r), sy: Math.round(scrollY),
      disabled: !!a.disabled, hidden: getComputedStyle(a).visibility === 'hidden' || a.offsetParent === null && getComputedStyle(a).position !== 'fixed', hash: location.hash}; };
  return 1;
})()
"""


class Cdp:
    def __init__(self):
        subprocess.run([ADB, 'forward', 'tcp:9222', 'localabstract:webview_devtools_remote_' + self.pid()], capture_output=True)
        pages = json.load(urllib.request.urlopen('http://localhost:9222/json'))
        page = next((p for p in pages if 'appassets' in p.get('url', '')), pages[0])
        self.ws = create_connection(page['webSocketDebuggerUrl'], timeout=30, suppress_origin=True)
        self.n = 0

    @staticmethod
    def pid():
        return subprocess.run([ADB, 'shell', 'pidof', 'com.veo.player'], capture_output=True, text=True).stdout.strip().split()[0]

    def eval(self, expr):
        self.n += 1
        self.ws.send(json.dumps({'id': self.n, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'awaitPromise': True, 'returnByValue': True}}))
        while True:
            r = json.loads(self.ws.recv())
            if r.get('id') == self.n:
                return r.get('result', {}).get('result', {}).get('value')


def key(name, n=1):
    for _ in range(n):
        subprocess.run([ADB, 'shell', 'input', 'keyevent', str(KEYS[name])], capture_output=True)
        time.sleep(SETTLE)


class Run:
    def __init__(self):
        self.c = Cdp()
        self.findings = []
        self.c.eval(PROBE)

    def at(self):
        v = self.c.eval('JSON.stringify(window.__qa())')
        return json.loads(v) if v else None

    def say(self, screen, rule, msg, ctx=None):
        self.findings.append((screen, rule, msg, ctx))
        print(f'  ! {rule} {msg}', flush=True)

    def enter_content(self):
        """A screen opened by address puts the focus where the app chooses (often the menu): go into the content the way a viewer
        would - away from the menu - so the run tests the screen, not the menu."""
        d = self.at()
        for _ in range(3):
            if d and not d.get('lost') and d['area'] != 'rail':
                return d
            key('left')
            d = self.at()
        return d

    def open(self, h):
        h = '#/' + h
        self.c.eval("(()=>{document.querySelector('#acctgate')?.remove(); location.hash='%s'; return 1})()" % h)
        time.sleep(6)
        self.c.eval(PROBE)
        self.enter_content()

    # ------------------------------------------------------------------ the sequences
    def check_stop(self, screen, step, d):
        if d.get('lost'):
            self.say(screen, 'N1', f'focus lost after {step}', d)
            return False
        if d['vis'] < 0.6:
            self.say(screen, 'N2', f'{step}: "{d["txt"]}" only {int(d["vis"] * 100)}% on screen (top={d["top"]}, scroll={d["sy"]})', d)
        if d.get('disabled') or d.get('hidden'):
            self.say(screen, 'N9', f'{step}: focus on a disabled/hidden element "{d["txt"]}"', d)
        return True

    def vertical(self, screen, n=22):
        start = self.at()
        if not start or start.get('lost'):
            self.say(screen, 'N1', 'nothing focused when the screen opened', start)
            # try to get a focus: one Down
            key('down'); start = self.at()
            if not start or start.get('lost'):
                return
        down = [start]
        stalls = 0
        for i in range(n):
            key('down')
            d = self.at()
            if not self.check_stop(screen, f'Down #{i + 1}', d):
                return
            prev = down[-1]
            # N3: rows are the strips: a jump of two strips in one press
            if prev['area'].startswith('strip#') and d['area'].startswith('strip#'):
                jump = int(d['area'][6:]) - int(prev['area'][6:])
                if jump > 1:
                    self.say(screen, 'N3', f'Down #{i + 1} jumped {jump} rows ("{prev["txt"]}" -> "{d["txt"]}")', d)
            moved = not (d['top'] == prev['top'] and d['left'] == prev['left'] and d['txt'] == prev['txt'] and d['sy'] == prev['sy'])
            if not moved:
                stalls += 1
                if stalls >= 2:
                    break                # the end of the page: two presses did nothing
                continue
            stalls = 0
            down.append(d)
        steps = len(down) - 1
        # go back up the same number of presses
        up = []
        for i in range(steps):
            key('up')
            d = self.at()
            if not self.check_stop(screen, f'Up #{i + 1}', d):
                return
            up.append(d)
            if len(up) >= 2:
                prev = up[-2]
                if prev['area'].startswith('strip#') and d['area'].startswith('strip#'):
                    jump = int(prev['area'][6:]) - int(d['area'][6:])
                    if jump > 1:
                        self.say(screen, 'N3', f'Up #{i + 1} jumped {jump} rows ("{prev["txt"]}" -> "{d["txt"]}")', d)
        end = self.at()
        if end and not end.get('lost') and (end['txt'], end['area']) != (start['txt'], start['area']):
            self.say(screen, 'N4', f'Down x{steps} then Up x{steps} ended on "{end["txt"]}" ({end["area"]}), not "{start["txt"]}" ({start["area"]})', end)
        # N5: more Ups must reach the top
        for _ in range(6):
            key('up')
        top = self.at()
        if top and not top.get('lost') and top['sy'] > 40:
            self.say(screen, 'N5', f'after 6 more Ups the page is still scrolled {top["sy"]}px (focus "{top["txt"]}", {top["area"]})', top)

    def horizontal(self, screen, n=8):
        first = self.at()
        if not first or first.get('lost'):
            return
        # the row the focus is in
        seen = [first]
        for i in range(n):
            key('left')
            d = self.at()
            if not self.check_stop(screen, f'Left #{i + 1}', d):
                return
            if d['area'] != first['area'] and not (first['area'] == 'rail'):
                self.say(screen, 'N6', f'Left #{i + 1} left the row: {first["area"]} -> {d["area"]} ("{d["txt"]}")', d)
                break
            seen.append(d)
        for i in range(len(seen) - 1):
            key('right')
        back = self.at()
        if back and not back.get('lost') and (back['txt'], back['area']) != (first['txt'], first['area']):
            self.say(screen, 'N6', f'Left x{len(seen) - 1} then Right x{len(seen) - 1} ended on "{back["txt"]}", not "{first["txt"]}"', back)

    def menu(self, screen):
        d0 = self.at()
        if not d0 or d0.get('lost') or d0['area'] == 'rail':
            return
        rounds = 0
        d = d0
        while d['area'] != 'rail' and rounds < 14:
            key('right'); d = self.at(); rounds += 1
            if d.get('lost'):
                self.say(screen, 'N7', 'focus lost on the way to the menu', d); return
            if d['area'] == d0['area'] and (d['txt'], d['top'], d['left']) == (d0['txt'], d0['top'], d0['left']) and rounds > 1:
                pass
        if d['area'] != 'rail':
            self.say(screen, 'N7', f'the menu was not reached with {rounds} presses towards it (on "{d["txt"]}", {d["area"]})', d)
            return
        key('left')
        back = self.at()
        if back.get('lost') or back['area'] == 'rail':
            self.say(screen, 'N7', 'could not leave the menu with the opposite key', back)

    def screen(self, h):
        print(f'== #/{h}', flush=True)
        self.open(h)
        first = self.at()
        print(f'   start: {first}', flush=True)
        self.vertical(h)
        self.open(h)
        self.horizontal(h)
        self.open(h)
        self.menu(h)

    def report(self, path):
        lines = ['# Navigation QA report', '', f'Run: {time.strftime("%Y-%m-%d %H:%M")}', '']
        by = {}
        for s, r, m, ctx in self.findings:
            by.setdefault(s, []).append((r, m))
        lines.append(f'**{len(self.findings)} findings** on {len(by)} screens.')
        lines.append('')
        for s, items in by.items():
            lines.append(f'## {s}')
            for r, m in items:
                lines.append(f'- **{r}** {m}')
            lines.append('')
        open(path, 'w', encoding='utf-8').write('\n'.join(lines))
        print(f'\n{len(self.findings)} findings -> {path}')


if __name__ == '__main__':
    screens = sys.argv[1:] or SCREENS
    run = Run()
    for h in screens:
        try:
            run.screen(h)
        except Exception as e:                       # a screen that breaks the driver is itself a finding
            run.say(h, 'DRV', f'driver error: {e!r}')
    run.report(os.path.join(HERE, 'navqa-report.md'))
