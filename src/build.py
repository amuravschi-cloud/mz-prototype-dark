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
            '<div class="stage" id="stage" aria-hidden="true"></div>\n'
            '  <aside class="mcard" id="mcard" aria-live="polite"></aside>\n'
            '  <div class="hint3d">Потяните, чтобы покрутить · наведите на изделие</div>', body)
body = sub1(r'<section class="hero">', '<section class="hero dark">', body)
for sid, theme in [('catalog', 'light'), ('calc', 'dark'), ('hand', 'light'), ('service', 'dark'),
                   ('about', 'light'), ('bases', 'dark'), ('order', 'light')]:
    body = sub1(r'<section class="sec(?: alt)?" id="%s">' % sid, '<section class="sec %s" id="%s">' % (theme, sid), body)
body = sub1(r'<div class="grid" id="cards"></div>', '<div class="tiles" id="cards"></div>', body)

# --- логика: каталог картинками вместо карточек ---
script = sub1(r"\$\('#cards'\)\.innerHTML=C\.products\.map\(.*?\}\)\.join\(''\);",
"""$('#cards').innerHTML=C.products.map(p=>`<div class="tile" role="button" tabindex="0" data-id="${p.id}">
  <div class="pic ph"><img alt="${esc(p.title)}" data-thumb="${p.id}"></div>
  <button class="add" type="button" data-act="order" title="Заказать" aria-label="Заказать: ${esc(p.title)}">+</button>
  <div class="cap"><div class="no">${p.code}</div><h3>${esc(p.title)}</h3><div class="sub">${esc(cleanSub(p))}</div><span class="more">Размеры →</span></div></div>`).join('');""",
script, re.S)
script = sub1(r"\$\('#cards'\)\.onclick=e=>\{.*?\n\};",
"""function openSizes(p){cur=p;$('#dszt').textContent=p.title;$('#dszs').value='';renderList();$('#dsz').showModal();}
const byId=id=>C.products.find(x=>x.id===id);
window.mzOpenSizes=id=>openSizes(byId(id));
window.mzOrder=id=>{add(byId(id).title);document.getElementById('order').scrollIntoView();};
$('#cards').onclick=e=>{const t=e.target.closest('.tile');if(!t)return;
  if(e.target.closest('[data-act=order]'))window.mzOrder(t.dataset.id);else openSizes(byId(t.dataset.id));};
$('#cards').onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&e.target.classList.contains('tile')){e.preventDefault();openSizes(byId(e.target.dataset.id));}};""",
script, re.S)

module = r"""
import { initMetalHero, METAL_ITEMS, renderProductThumbs } from './metal-hero.js';
const C = JSON.parse(document.getElementById('d-content').textContent);
const P = Object.fromEntries(C.products.map(p => [p.id, p]));
const esc = s => String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const MAP = { profile: 'pipes_prof', round: 'pipes_round', channel: 'channels', angle: 'angles', rebar: 'armatura' };
const items = METAL_ITEMS.filter(i => P[MAP[i.id]]).map(i => ({ ...i, product: P[MAP[i.id]] }));
const SUB_FIX = { beams: 'Двутавр IPE / IPN', euro_beam: 'Широкополочные двутавры HEA / HEB' };
const cleanSub = p => SUB_FIX[p.id] || p.subtitle.replace(/\s*\([^)]*\d[^)]*\)/g, '').replace(/\s*№\s*\d.*$/, '').trim();

function renderCard(card, item) {
  if (!item) { card.classList.remove('is-visible'); return; }
  const p = item.product;
  card.innerHTML = `<div class="no">${p.code}</div><h3>${esc(p.title)}</h3><div class="sub">${esc(cleanSub(p))}</div>
    <dl>${p.specs.slice(0, 2).map(s => `<div><dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd></div>`).join('')}</dl>
    <div class="tag">${esc(p.tag)}</div>
    <div class="act"><button class="btn primary xs" type="button" data-order="${p.id}">Заказать</button><button class="btn outline xs" type="button" data-open="${p.id}">Размеры</button></div>`;
  card.classList.add('is-visible');
}
const card = document.getElementById('mcard');
card.addEventListener('click', e => {
  const o = e.target.closest('[data-open]'), z = e.target.closest('[data-order]');
  if (o) window.mzOpenSizes(o.dataset.open);
  if (z) window.mzOrder(z.dataset.order);
});
initMetalHero(document.getElementById('stage'), { items, card, renderCard, fadeBehind: document.querySelector('.hero .copy') });

// картинки номенклатуры — рендерятся тем же 3D-металлом, когда каталог приближается к экрану
const cat = document.getElementById('catalog');
const io = new IntersectionObserver(async ([en]) => {
  if (!en.isIntersecting) return;
  io.disconnect();
  const imgs = [...document.querySelectorAll('img[data-thumb]')];
  const urls = await renderProductThumbs(imgs.map(i => i.dataset.thumb));
  imgs.forEach(i => { if (urls[i.dataset.thumb]) { i.src = urls[i.dataset.thumb]; i.parentElement.classList.remove('ph'); } });
}, { rootMargin: '600px 0px' });
io.observe(cat);
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
out = head + body + data + "\n<script>" + script + "</script>\n<script type=\"module\">" + module + "</script>\n</body></html>\n"
(ROOT / 'index.html').write_text(out)
print('ok', len(out))
