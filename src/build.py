# Сборка тёмной версии из исходного прототипа.
# Тексты, данные каталога (d-content, d-nom) и логика берутся из ../mz-prototype-src/index.html без изменений;
# меняются только стили, первый экран (3D) и вид номенклатуры (картинки с подписями).
import re, pathlib, hashlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT.parent / 'mz-prototype-src' / 'index.html'
s = SRC.read_text()

css = (ROOT / 'src' / 'style.css').read_text()
data = ''.join(re.findall(r'<script type="application/json" id="d-(?:content|nom)">.*?</script>', s, re.S))
script = re.search(r'</dialog>.*?<script>(.*?)</script>', s, re.S).group(1)
body = re.search(r'<body>(.*?)<script type="application/json"', s, re.S).group(1)  # svg-спрайт
body += re.search(r'</script>\s*(<div class="top">.*?)<script>\s*\(async', s, re.S).group(1)

def sub1(pat, rep, text, flags=0):
    new, n = re.subn(pat, rep, text, count=1, flags=flags)
    assert n == 1, pat
    return new

# --- разметка ---
body = sub1(r'img/logo-green\.png', 'img/logo-white.png', body)
body = sub1(r'<div class="photo"[^>]*></div>',
            '<div class="stage" id="stage" aria-hidden="true"></div>', body)
body = sub1(r'<section class="hero">', '<section class="hero dark">', body)
for sid, theme in [('catalog', 'light'), ('calc', 'dark'), ('hand', 'light'), ('service', 'dark'),
                   ('about', 'light'), ('bases', 'dark'), ('order', 'light')]:
    body = sub1(r'<section class="sec(?: alt)?" id="%s">' % sid, '<section class="sec %s" id="%s">' % (theme, sid), body)
body = sub1(r'(<button class="fab" id="fab"[^>]*>.*?</button>)', r'\1\n<button class="totop" id="totop" type="button" aria-label="Наверх"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>', body, re.S)
body = sub1(r'<div class="grid" id="cards"></div>', '<div class="tiles" id="cards"></div>', body)

# --- логика: каталог картинками вместо карточек ---
script = sub1(r"\$\('#cards'\)\.innerHTML=C\.products\.map\(.*?\}\)\.join\(''\);",
"""$('#cards').innerHTML=C.products.map(p=>`<div class="tile" role="button" tabindex="0" data-id="${p.id}">
  <div class="pic"><img alt="${esc(p.title)}" src="img/products/${p.id}.webp" width="640" height="480" decoding="async"></div>
  <button class="add" type="button" data-act="order" title="Выбрать размер" aria-label="Выбрать размер: ${esc(p.title)}">+</button>
  <div class="cap"><div class="no">${p.code}</div><h3>${esc(p.title)}</h3><div class="sub">${esc(cleanSub(p))}</div><span class="more">Размеры →</span></div></div>`).join('');""",
script, re.S)
script = sub1(r"\$\('#cards'\)\.onclick=e=>\{.*?\n\};",
"""function openSizes(p){cur=p;$('#dszt').textContent=p.title;$('#dszs').value='';renderList();$('#dsz').showModal();}
const byId=id=>C.products.find(x=>x.id===id);
window.mzOpenSizes=id=>openSizes(byId(id));
window.mzOrder=id=>{add(byId(id).title);document.getElementById('order').scrollIntoView();};
$('#cards').onclick=e=>{const t=e.target.closest('.tile');if(!t)return;
  openSizes(byId(t.dataset.id));};  // и «+», и клик по картинке — список размеров
$('#cards').onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&e.target.classList.contains('tile')){e.preventDefault();openSizes(byId(e.target.dataset.id));}};""",
script, re.S)

module = r"""
import { initMetalHero, METAL_ITEMS } from './metal-hero.js';
const C = JSON.parse(document.getElementById('d-content').textContent);
const P = Object.fromEntries(C.products.map(p => [p.id, p]));
const esc = s => String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const MAP = { profile: 'pipes_prof', round: 'pipes_round', channel: 'channels', angle: 'angles', rebar: 'armatura' };
const items = METAL_ITEMS.filter(i => P[MAP[i.id]]).map(i => ({ ...i, product: P[MAP[i.id]] }));
const SUB_FIX = { beams: 'Двутавр IPE / IPN', euro_beam: 'Широкополочные двутавры HEA / HEB' };
const cleanSub = p => SUB_FIX[p.id] || p.subtitle.replace(/\s*\([^)]*\d[^)]*\)/g, '').replace(/\s*№\s*\d.*$/, '').trim();

initMetalHero(document.getElementById('stage'), { items, pick: false, fadeBehind: document.querySelector('.hero .copy') });

// кнопка «наверх»
const toTop = document.getElementById('totop');
const onTop = () => toTop.classList.toggle('show', window.scrollY > window.innerHeight * 0.8);
window.addEventListener('scroll', onTop, { passive: true }); onTop();
toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
"""

head = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Metalica Zuev — металлопрокат в Молдове (тёмная версия)</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/"}}</script>
<style>
""" + css + "\n</style></head><body>\n"

ver = hashlib.md5((ROOT / 'metal-hero.js').read_bytes()).hexdigest()[:8]
module = module.replace("from './metal-hero.js'", "from './metal-hero.js?v=%s'" % ver)
# --- телефоны в одном формате: +373, код, группы цифр через пробел ---
PHONES = {'+373 68 47-15-30': '+373 68 471 530', '0235 80 008': '+373 235 80 008', '+373 ___ __ ___': '+373 __ ___ ___'}
for old, new in PHONES.items():
    body = body.replace(old, new); data = data.replace(old, new); script = script.replace(old, new)
out = head + body + data + "\n<script>" + script + "</script>\n<script type=\"module\">" + module + "</script>\n</body></html>\n"
(ROOT / 'index.html').write_text(out)
print('ok', len(out))
