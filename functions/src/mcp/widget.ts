// Picture cards ChatGPT shows under show_props / get_prop (Apps SDK widget: ChatGPT renders this page and hands it the tool's
// structured result in window.openai.toolOutput). Black & Gold like the app. No scripts from anywhere else; images only from
// our Firebase Storage.
export const WIDGET_URI = 'ui://widget/prime-capitol-props-v1.html'
export const WIDGET_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:transparent;font:14px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#F5F5F7}
.row{display:flex;gap:12px;overflow-x:auto;padding:4px 2px 10px;scroll-snap-type:x mandatory}
.card{flex:0 0 168px;scroll-snap-align:start;background:#1C1C1E;border-radius:18px;overflow:hidden;box-shadow:inset 0 0 0 .5px rgba(255,255,255,.08)}
.ph{width:100%;aspect-ratio:1;object-fit:cover;background:#2C2C2E;display:block}
.b{padding:9px 11px 12px}.n{font-weight:600;font-size:14px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.m{color:#8E8E93;font-size:12px;margin-top:3px}.f{display:inline-block;margin-top:6px;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(52,199,89,.15);color:#30D158}
.f.no{background:rgba(255,69,58,.15);color:#FF453A}.brand{color:#C9A961;font-weight:700;font-size:12px;margin:0 2px 6px}
</style></head><body><div class="brand">PRIME CAPITOL</div><div id="r" class="row"></div>
<script>
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
function draw(){var o=(window.openai&&window.openai.toolOutput)||{};var list=o.props||(o.id?[o]:[]);var el=document.getElementById('r');
el.innerHTML=list.map(function(p){var img=p.photo||(p.photos&&p.photos[0])||'';var free=p.free_that_day;
return '<div class="card">'+(img?'<img class="ph" loading="lazy" src="'+esc(img)+'" alt="'+esc(p.name)+'">':'<div class="ph"></div>')+'<div class="b"><div class="n">'+esc(p.name)+'</div><div class="m">'+esc(p.category||'')+' · x'+esc(p.how_many)+'</div>'+(free==null?'':'<span class="f'+(free>0?'':' no')+'">'+(free>0?free+' free':'Booked')+'</span>')+'</div></div>'}).join('')||'<div class="m">No props to show.</div>'}
draw();window.addEventListener('openai:set_globals',draw);
</script></body></html>`
