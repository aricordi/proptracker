// The cards ChatGPT (and other MCP hosts that show apps) draw under some tools: prop photos, free times, one shoot.
// One page for every kind; it reads the tool's structured result from either
//   • ChatGPT's Apps SDK: window.openai.toolOutput (+ the openai:set_globals event), template text/html+skybridge, or
//   • the MCP Apps standard: a ui/initialize handshake with the host, then ui/notifications/tool-result over postMessage,
//     template text/html;profile=mcp-app.
// Black & Gold like the app. No outside scripts; images only from our Firebase Storage. Display only: every change still
// goes through the assistant asking the person (the widget never calls tools by itself). Links open the app.
export const WIDGET_URI = 'ui://widget/prime-capitol-v2.html'               // MCP Apps standard
export const WIDGET_URI_SKYBRIDGE = 'ui://widget/prime-capitol-v2-sb.html'  // ChatGPT (older key)
export const WIDGET_MIME = 'text/html;profile=mcp-app'
export const WIDGET_MIME_SKYBRIDGE = 'text/html+skybridge'
export const WIDGET_TOOLS: Record<string, { invoking: string; invoked: string }> = {
  show_props: { invoking: 'Getting the props…', invoked: 'Props from the closet' },
  get_prop: { invoking: 'Getting the prop…', invoked: 'Prop details' },
  props_for_idea: { invoking: 'Checking the closet…', invoked: 'What the closet has' },
  find_free_times: { invoking: 'Checking the schedule…', invoked: 'Free times' },
  get_shoot: { invoking: 'Getting your shoot…', invoked: 'Your shoot' },
}

export const WIDGET_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:transparent;font:14px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#F5F5F7}
.brand{color:#C9A961;font-weight:700;font-size:12px;letter-spacing:.02em;margin:2px 2px 8px}
.row{display:flex;gap:12px;overflow-x:auto;padding:2px 2px 10px;scroll-snap-type:x mandatory}
.card{flex:0 0 168px;scroll-snap-align:start;background:#1C1C1E;border-radius:18px;overflow:hidden;box-shadow:inset 0 0 0 .5px rgba(255,255,255,.08)}
.ph{width:100%;aspect-ratio:1;object-fit:cover;background:#2C2C2E;display:block}
.b{padding:9px 11px 12px}.n{font-weight:600;font-size:14px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.m{color:#8E8E93;font-size:12px;margin-top:3px}.pill{display:inline-block;margin-top:6px;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(52,199,89,.15);color:#30D158}
.pill.no{background:rgba(255,69,58,.15);color:#FF453A}.pill.wait{background:rgba(255,204,0,.15);color:#FFD60A}
.h{font-weight:600;font-size:13px;color:#C9A961;margin:10px 2px 6px}
.list{display:flex;flex-direction:column;gap:6px}
.t{display:flex;align-items:center;gap:10px;background:#1C1C1E;border-radius:14px;padding:10px 12px;box-shadow:inset 0 0 0 .5px rgba(255,255,255,.08)}
.t .when{font-variant-numeric:tabular-nums;font-weight:600;min-width:110px}.t .where{color:#8E8E93;font-size:12px}
.box{background:#1C1C1E;border-radius:18px;padding:14px;box-shadow:inset 0 0 0 .5px rgba(255,255,255,.08)}
.big{font-size:17px;font-weight:700}.line{margin-top:6px}.muted{color:#8E8E93}
a.btn{display:inline-block;margin-top:10px;background:#C9A961;color:#111;font-weight:700;text-decoration:none;padding:9px 14px;border-radius:12px}
</style></head><body><div class="brand">PRIME CAPITOL</div><div id="r"></div>
<script>
(function(){
var data=null;
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
function photoOk(u){return /^https:\\/\\/firebasestorage\\.googleapis\\.com\\//.test(String(u||''))}
function link(u){return /^https:\\/\\/proptracker\\.arbcreative\\.co\\//.test(String(u||''))?u:''}
function card(p){var img=photoOk(p.photo)?p.photo:(p.photos&&photoOk(p.photos[0])?p.photos[0]:'');var free=p.free_that_day;
 return '<div class="card">'+(img?'<img class="ph" loading="lazy" src="'+esc(img)+'" alt="'+esc(p.name)+'">':'<div class="ph"></div>')+'<div class="b"><div class="n">'+esc(p.name)+'</div><div class="m">'+esc(p.category||'')+(p.how_many!=null?' · x'+esc(p.how_many):'')+'</div>'+(free==null?'':'<span class="pill'+(free>0?'':' no')+'">'+(free>0?esc(free)+' free':'Booked that day')+'</span>')+'</div></div>'}
function cards(list){return list.length?'<div class="row">'+list.map(card).join('')+'</div>':'<div class="m">Nothing to show.</div>'}
function draw(){var o=data||{};var el=document.getElementById('r');var h='';
 if(o.groups){o.groups.forEach(function(g){h+='<div class="h">'+esc(g.scene?g.scene+' · ':'')+esc(g.need)+'</div>'+(g.matches&&g.matches.length?cards(g.matches):'<div class="m">Nothing in the closet: could be a custom prop.</div>')})}
 else if(o.options){h+=o.options.length?'<div class="list">'+o.options.map(function(t){return '<div class="t"><span class="when">'+esc(t.day)+'<br>'+esc(t.start)+'–'+esc(t.end)+'</span><span><b>'+esc(t.house||t.place)+'</b><br><span class="where">free '+esc(t.free_stretch||'')+(t.needs_guideline_pdf?' · needs guideline':'')+'</span></span></div>'}).join('')+'</div>':'<div class="m">No free times found.</div>'}
 else if(o.day&&o.place&&o.start){var st=String(o.status||'');var cls=/approved/.test(st)?'':(/waiting/.test(st)?' wait':' no');
  h+='<div class="box"><div class="big">'+esc(o.place)+' · '+esc(o.day)+'</div><div class="line">'+esc(o.start)+'–'+esc(o.end)+'</div><span class="pill'+cls+'">'+esc(st)+'</span>'+
  (o.collaborators&&o.collaborators.length?'<div class="line muted">With '+o.collaborators.map(function(c){return esc(c.name)}).join(', ')+'</div>':'')+
  ((o.props_requests||[]).map(function(r){return '<div class="line">Props "'+esc(r.video)+'": <span class="muted">'+esc(r.status)+'</span><div class="m">'+esc((r.items||[]).join(', '))+'</div></div>'}).join(''))+
  (o.props_deadline?'<div class="line m">Add closet props by '+esc(o.props_deadline)+'</div>':'')+
  (link(o.app_link)?'<a class="btn" target="_blank" rel="noopener" href="'+esc(o.app_link)+'">Open in the app</a>':'')+'</div>'}
 else{var list=o.props||(o.prop?[o.prop]:(o.id?[o]:[]));h+=cards(list)}
 el.innerHTML=h;
 try{var H=document.body.scrollHeight;parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:H}},'*')}catch(e){}}
function fromOpenAI(){if(window.openai&&window.openai.toolOutput){data=window.openai.toolOutput;draw();return true}return false}
window.addEventListener('openai:set_globals',fromOpenAI);
window.addEventListener('message',function(ev){var m=ev.data;if(!m||m.jsonrpc!=='2.0')return;
 if(m.method==='ui/notifications/tool-result'&&m.params){data=m.params.structuredContent||data;draw()}
 if(m.id===1&&m.result){try{parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*')}catch(e){}}});
if(!fromOpenAI()){try{parent.postMessage({jsonrpc:'2.0',id:1,method:'ui/initialize',params:{protocolVersion:'2025-06-18',appInfo:{name:'Prime Capitol',version:'2'},appCapabilities:{}}},'*')}catch(e){}draw()}
})();
</script></body></html>`
