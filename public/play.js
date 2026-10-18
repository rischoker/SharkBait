/* Shark Bait — phone controller. Joins the room through the Socket.IO relay and votes A/B/C. */
'use strict';
(() => {
const $ = id => document.getElementById(id);
const BASES = [['henry','Henry'],['anne','Anne'],['mako','Mako'],['sharky','Sharky'],['skeleton','Bones'],['skeleton2','Rattles']];
const COLORS = ['#c0392b','#2e9a55','#3a6fd8','#c9b52a','#8e44ad','#16a2a8','#e0559a','#d9822b','#5e5aa8','#6aa83a'];
const portrait = (base, color) => `assets/portraits/${base}-${color}.png`;

// ---- identity kept on the phone ----
const store = { get(k, d){ try { const v = localStorage.getItem('sb-' + k); return v == null ? d : v; } catch(e){ return d; } }, set(k, v){ try { localStorage.setItem('sb-' + k, v); } catch(e){} } };
let clientId = store.get('id', '');
if (!clientId){ clientId = (crypto.randomUUID ? crypto.randomUUID() : 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36)); store.set('id', clientId); }
let me = { name: store.get('name', ''), base: store.get('base', BASES[Math.floor(Math.random()*BASES.length)][0]), color: +store.get('color', Math.floor(Math.random()*COLORS.length)) };
let joined = store.get('joined-room', '') !== '';
let room = (new URLSearchParams(location.search).get('room') || store.get('room', '')).toUpperCase().trim();

// ---- screens ----
const SCREENS = ['sConnect','sJoin','sWait','sVote','sResult','sSummary'];
function show(id){ SCREENS.forEach(s => $(s).hidden = s !== id); }
function setNet(text, ok){ $('net').textContent = text; $('net').classList.toggle('ok', !!ok); }

// ---- character picker ----
function renderPicker(){
  $('bases').innerHTML = BASES.map(([b, n]) => `<button type="button" role="radio" data-b="${b}" aria-checked="${me.base === b}"><img src="${portrait(b, me.color)}" alt="">${n}</button>`).join('');
  $('colors').innerHTML = COLORS.map((c, i) => `<button type="button" role="radio" data-c="${i}" aria-checked="${me.color === i}" aria-label="Color ${i+1}" style="background:${c}"></button>`).join('');
  $('pv').src = portrait(me.base, me.color);
  $('pvName').textContent = ($('nameIn').value.trim() || 'Pirate');
}
$('bases').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; me.base = b.dataset.b; renderPicker(); });
$('colors').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; me.color = +b.dataset.c; renderPicker(); });
$('nameIn').addEventListener('input', () => { $('pvName').textContent = $('nameIn').value.trim() || 'Pirate'; });
$('nameIn').value = me.name;

// ---- socket (polling first: works behind proxies and on old iPhones) ----
const socket = io({transports:['polling','websocket'], reconnection:true, reconnectionDelay:700, reconnectionDelayMax:4000, timeout:15000});
let inRoom = false, lastState = null, myPick = null, voteNpc = null, clockEnd = 0, clockTimer = 0;
function send(d){ if (inRoom && socket.connected) socket.emit('c:d', d); }
function joinRoom(){
  if (!room){ show('sConnect'); $('connectMsg').textContent = 'Type the room code from the big screen.'; $('codeForm').hidden = false; return; }
  socket.emit('c:join', {room, clientId}, res => {
    if (!res || !res.ok){
      inRoom = false;
      if (res && res.error === 'no-room'){ setNet('No ship'); show('sConnect'); $('connectMsg').textContent = `Room ${room} isn't open. Check the code on the big screen.`; $('codeForm').hidden = false; $('codeIn').value = room; }
      else if (res && res.error === 'full'){ show('sConnect'); $('connectMsg').textContent = 'This ship is full!'; }
      return;
    }
    inRoom = true; store.set('room', room); setNet(res.hostOnline ? 'Aboard' : 'Waiting for host', res.hostOnline);
    if (joined && me.name) sendJoin(); else { show('sJoin'); renderPicker(); }
  });
}
function sendJoin(){ send({type:'join', clientId, name:me.name, base:me.base, color:me.color}); }
socket.on('connect', () => { setNet('Connected', true); joinRoom(); });
socket.on('disconnect', () => { inRoom = false; setNet('Reconnecting…'); });
socket.on('connect_error', () => setNet('Reconnecting…'));
socket.on('c:rejoin', () => { setNet('Aboard', true); if (joined && me.name) sendJoin(); });
socket.on('c:hostgone', ({closed}) => { setNet(closed ? 'Ship closed' : 'Host away…'); if (closed){ show('sConnect'); $('connectMsg').textContent = 'The game was closed. Scan the new QR code.'; } });
socket.on('c:kicked', () => { joined = false; store.set('joined-room', ''); show('sConnect'); $('connectMsg').textContent = 'You were removed from the crew. Scan the QR again to rejoin.'; });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible'){ if (!socket.connected) socket.connect(); else if (joined) sendJoin(); } });

$('codeForm').addEventListener('submit', e => { e.preventDefault(); room = $('codeIn').value.toUpperCase().trim(); $('codeForm').hidden = true; $('connectMsg').textContent = 'Boarding…'; joinRoom(); });
$('joinBtn').addEventListener('click', () => {
  me.name = ($('nameIn').value.trim() || 'Pirate').slice(0, 14);
  store.set('name', me.name); store.set('base', me.base); store.set('color', String(me.color)); store.set('joined-room', room);
  joined = true; $('nameIn').blur(); sendJoin(); wake();
  show('sWait'); renderMe();
});
$('editBtn').addEventListener('click', () => { show('sJoin'); renderPicker(); });

// ---- host messages ----
socket.on('c:d', d => {
  if (!d || typeof d !== 'object') return;
  if (d.type === 'full'){ show('sConnect'); $('connectMsg').textContent = 'This ship is full!'; return; }
  if (d.type === 'voted'){ myPick = d.pick; markPick(); return; }
  if (d.type !== 'state') return;
  if (!joined) return;                 // broadcasts before this phone picked a pirate
  lastState = d;
  if (d.you) Object.assign(me, {name:d.you.name, base:d.you.base, color:d.you.color, score:d.you.score, correct:d.you.correct, answered:d.you.answered});
  renderState(d);
});
function renderMe(){
  $('meImg').src = portrait(me.base, me.color); $('meName').textContent = me.name;
  $('meScore').textContent = me.score ? `${me.score} points · ${me.correct || 0} right` : 'Ready to vote';
}
function renderState(d){
  clearInterval(clockTimer); $('preview').hidden = true;
  const npc = d.npc ? `${d.npc.name} the ${d.npc.role}` : '';
  switch (d.phase){
    case 'lobby': show('sWait'); renderMe(); $('waitTitle').textContent = "You're aboard!"; $('waitMsg').textContent = 'Look at the big screen. The game starts soon.'; $('editBtn').hidden = false; break;
    case 'approach': case 'captain': show('sWait'); renderMe(); $('editBtn').hidden = true; $('waitTitle').textContent = 'Listen to the captain!'; $('waitMsg').textContent = 'Prisoners will tell three versions of their story. Only one is proper English.'; break;
    case 'walk': show('sWait'); renderMe(); $('editBtn').hidden = true; $('waitTitle').textContent = `Prisoner ${d.idx} of ${d.total}`; $('waitMsg').textContent = `${npc} walks the plank…`; break;
    case 'sentences': show('sWait'); renderMe(); $('editBtn').hidden = true; $('waitTitle').textContent = 'Listen and read carefully'; $('waitMsg').textContent = `${npc} says:`;
      $('preview').innerHTML = (d.options || []).map(o => `<li>${esc(o)}</li>`).join(''); $('preview').hidden = false; break;
    case 'vote': {
      show('sVote'); $('vNpc').textContent = npc;
      if (voteNpc !== d.npcIdx){ voteNpc = d.npcIdx; myPick = d.yourPick != null ? d.yourPick : null; }
      else if (d.yourPick != null) myPick = d.yourPick;
      $('opts').innerHTML = (d.options || []).map((o, i) => `<button type="button" data-i="${i}" aria-pressed="false"><b>${'ABC'[i]}</b><span>${esc(o)}</span></button>`).join('');
      markPick();
      clockEnd = Date.now() + (d.endsIn || 0); tickClock(); clockTimer = setInterval(tickClock, 250);
      break;
    }
    case 'verdict': {
      show('sResult');
      const voted = d.yourPick != null;
      $('rIcon').textContent = !voted ? '…' : d.right ? '✓' : '✗';
      $('rIcon').className = 'ricon ' + (!voted ? '' : d.right ? 'right' : 'wrong');
      $('rTitle').textContent = !voted ? 'No vote this time' : d.right ? 'You got it right!' : 'Not this time';
      $('rMsg').textContent = `${d.pct}% of the crew chose right — ${d.saved ? 'the prisoner is saved!' : 'to the sharks!'}`;
      $('rAnswer').textContent = `✓ ${d.answer}`;
      if (navigator.vibrate) try { navigator.vibrate(d.right ? 60 : [40, 60, 40]); } catch(e){}
      break;
    }
    case 'summary':
      show('sSummary'); $('sumCorrect').textContent = `${me.correct || 0}/${me.answered || 0}`; $('sumScore').textContent = me.score || 0; $('sumRank').textContent = d.rank ? `${d.rank}` : '–';
      $('sumMsg').textContent = d.saved ? `Your crew saved ${d.saved} prisoner${d.saved === 1 ? '' : 's'}. Well sailed!` : 'Every pirate learns from the sea. Next round!';
      break;
  }
}
function tickClock(){
  const left = Math.max(0, Math.ceil((clockEnd - Date.now())/1000));
  $('vClock').textContent = left; $('vClock').classList.toggle('hurry', left <= 5);
  if (left <= 0){ clearInterval(clockTimer); [...$('opts').children].forEach(b => b.disabled = true); $('vMsg').textContent = 'Time! Look at the big screen…'; }
}
function markPick(){
  [...$('opts').children].forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.i === myPick)));
  $('vMsg').textContent = myPick == null ? 'Tap your answer. You can change it until time runs out.' : `You chose ${'ABC'[myPick]}. You can still change it.`;
}
$('opts').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  myPick = +b.dataset.i; markPick();
  if (navigator.vibrate) try { navigator.vibrate(25); } catch(e){}
  send({type:'vote', npc:voteNpc, pick:myPick});
});
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// keep the screen awake while playing (ignored where unsupported)
let lock = null;
async function wake(){ try { if ('wakeLock' in navigator && !lock){ lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => lock = null); } } catch(e){} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && joined) wake(); });

show('sConnect'); renderPicker();
})();
