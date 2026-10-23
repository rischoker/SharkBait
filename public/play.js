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
let me = { name: store.get('name', ''), base: store.get('base', BASES[Math.floor(Math.random()*BASES.length)][0]), color: +store.get('color', Math.floor(Math.random()*COLORS.length)), voice: store.get('voice', '') };
if (me.voice !== 'f' && me.voice !== 'm') me.voice = me.base === 'anne' ? 'f' : 'm';
let voicePicked = store.get('voice', '') !== '';
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
  [...$('voices').children].forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === me.voice)));
  $('pvName').textContent = ($('nameIn').value.trim() || 'Pirate');
}
$('bases').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; me.base = b.dataset.b; if (!voicePicked) me.voice = me.base === 'anne' ? 'f' : 'm'; renderPicker(); });
$('voices').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; me.voice = b.dataset.v; voicePicked = true; renderPicker(); });
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
function sendJoin(){ send({type:'join', clientId, name:me.name, base:me.base, color:me.color, voice:me.voice}); }
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
  if (voicePicked) store.set('voice', me.voice);
  joined = true; $('nameIn').blur(); sendJoin(); wake();
  show('sWait'); renderMe();
});
$('editBtn').addEventListener('click', () => { show('sJoin'); renderPicker(); });
// "Ahoy!" — your pirate waves and shouts on the big screen
let ahoyUntil = 0;
$('ahoyBtn').addEventListener('click', () => {
  if (Date.now() < ahoyUntil) return;
  ahoyUntil = Date.now() + 3000; send({type:'ahoy', voice:me.voice});
  if (navigator.vibrate) try { navigator.vibrate(30); } catch(e){}
  const b = $('ahoyBtn'); b.disabled = true; b.textContent = 'Ahoy! 📣'; setTimeout(() => { b.disabled = false; b.textContent = 'Ahoy! 🏴‍☠️'; }, 3000);
});

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
  clearInterval(clockTimer); $('preview').hidden = true; $('ahoyBtn').hidden = d.phase !== 'lobby' && d.phase !== 'approach' && d.phase !== 'captain';
  const npc = d.npc ? `${d.npc.name} the ${d.npc.role}` : '';
  switch (d.phase){
    case 'lobby': show('sWait'); renderMe(); $('waitTitle').textContent = "You're aboard!"; $('waitMsg').textContent = 'Look at the big screen. The game starts soon. Say hello to the crew!'; $('editBtn').hidden = false; $('ahoyBtn').hidden = false; break;
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
    case 'summary': showReview(d); break;
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

// ---- end-of-round review (like Castle Quest's): rank, strengths, what to study, every prisoner, and a saved image ----
const RANKS = [
  {min:95, icon:'🏴‍☠️', title:'Pirate Legend', line:'The seven seas tremble at your English. Nobody walks the plank on your watch.'},
  {min:90, icon:'👑', title:'Pirate Captain', line:'Outstanding! You could command your own ship.'},
  {min:80, icon:'⚓', title:'First Mate', line:'You passed! A worthy officer of the crew.'},
  {min:70, icon:'🧭', title:'Bosun', line:'So close to passing! A little more practice and you will be an officer.'},
  {min:60, icon:'⛵', title:'Deckhand', line:'You know the ropes, but some prisoners paid for your mistakes.'},
  {min:40, icon:'🧹', title:'Swabbie', line:'You are scrubbing the deck for now. Study the topics below and try again.'},
  {min:0,  icon:'🦈', title:'Shark Bait', line:'The sharks are licking their lips! Study the topics below and come back stronger.'},
];
const clean = w => String(w || '').replace(/^[✓✗]\s*/, '');
function feedback(d){
  const rev = d.review || [], total = rev.length;
  const right = rev.filter(r => r.pick === r.correct), wrong = rev.filter(r => r.pick != null && r.pick !== r.correct), missed = rev.filter(r => r.pick == null);
  const acc = total ? Math.round(right.length / total * 100) : 0;
  const pass = d.pass || 80;
  const rank = total < 2 ? {icon:'🕯️', title:'Lookout', line:'Too few prisoners to judge. Join the next round from the start!'} : RANKS.find(k => acc >= k.min);
  const uniq = a => [...new Set(a)];
  const strengths = uniq(right.map(r => r.topic)).slice(0, 4);
  const weak = uniq(wrong.concat(missed).map(r => r.topic)).slice(0, 4);
  const tips = [];
  wrong.slice(0, 3).forEach(r => tips.push(`${r.topic}: "${r.opts[r.pick]}" is wrong (${clean(r.why[r.pick])}). Say: "${r.opts[r.correct]}"`));
  if (missed.length) tips.push(`You didn't vote for ${missed.length} prisoner${missed.length === 1 ? '' : 's'}. No vote can't save anyone: always choose an answer!`);
  if (acc >= 90 && total >= 3) tips.push('Too easy? Ask your teacher for the next level.');
  else if (acc < pass && !wrong.length && !missed.length) tips.push('Read every option slowly before you vote.');
  if (!tips.length) tips.push('Perfect round! Keep practising to stay sharp.');
  return {rank, acc, right:right.length, total, missed:missed.length, strengths, weak, tips, passed:acc >= pass};
}
let reviewBlob = null, reviewData = null;
function showReview(d){
  show('sSummary'); reviewData = d;
  const f = feedback(d);
  $('rankIcon').textContent = f.rank.icon; $('rankTitle').textContent = f.rank.title; $('rankLine').textContent = f.rank.line;
  $('rankCard').className = 'rankcard ' + (f.passed ? 'pass' : 'fail');
  $('sumAcc').textContent = f.acc + '%'; $('sumScore').textContent = me.score || 0; $('sumRank').textContent = d.rank ? `${d.rank}/${d.of || '?'}` : '–';
  $('sumMsg').textContent = `${f.right} of ${f.total} right · the crew saved ${d.saved || 0} and fed ${d.lost || 0} to the sharks.`;
  const li = a => a.map(x => `<li>${esc(x)}</li>`).join('');
  $('fb').innerHTML = (f.strengths.length ? `<div class="good"><h3>💪 Strengths</h3><ul>${li(f.strengths)}</ul></div>` : '') +
    (f.weak.length ? `<div class="bad"><h3>🎯 Needs work</h3><ul>${li(f.weak)}</ul></div>` : '') +
    `<div class="tip"><h3>🧭 How to improve</h3><ul>${li(f.tips)}</ul></div>`;
  $('rev').innerHTML = (d.review || []).map((r, k) => {
    const mine = r.pick, ok = mine === r.correct;
    return `<article class="ri ${ok ? 'ok' : mine == null ? 'miss' : 'ko'}">
      <header><b>${k + 1}. ${esc(r.who)}</b><span class="fate ${r.saved ? 'saved' : 'eaten'}">${r.saved ? 'Saved' : 'Eaten 🦈'} · ${r.pct}%</span></header>
      <small>${esc(r.lvl)} · ${esc(r.topic)}</small>
      <ul>${r.opts.map((o, j) => `<li class="${j === r.correct ? 'right' : j === mine ? 'mine' : ''}"><i>${j === r.correct ? '✓' : j === mine ? '✗' : '·'}</i><span>${esc(o)}${j === mine && !ok ? `<em>${esc(clean(r.why[j]))}</em>` : ''}${j === mine ? ' <u>your answer</u>' : ''}</span></li>`).join('')}</ul>
      ${mine == null ? '<p class="nov">You didn\'t vote.</p>' : ''}
    </article>`;
  }).join('');
  $('saveMsg').textContent = 'Saves an image of this review to your phone.';
  reviewBlob = null; renderReviewImage(d, f).then(b => { reviewBlob = b; }).catch(() => {});
}
// the image is drawn as soon as the review appears, so the share sheet opens straight away when tapped (iPhone needs that)
function wrapText(x, text, maxW){
  const words = String(text).split(/\s+/), lines = []; let line = '';
  words.forEach(w => { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > maxW && line){ lines.push(line); line = w; } else line = t; });
  if (line) lines.push(line); return lines;
}
async function renderReviewImage(d, f){
  try { await document.fonts.ready; } catch(e){}
  const W = 1080, P = 56, c = document.createElement('canvas'); c.width = W; c.height = 7000;
  const x = c.getContext('2d');
  const C = {parch:'#f1d9a6', ink:'#2a160b', rope:'#94592a', gold:'#f0b43a', blood:'#c7342b', ok:'#2e9a55', paper:'#fff8e6'};
  const disp = n => `400 ${n}px "Pirata One", Georgia, serif`, body = (n, w=700) => `${w} ${n}px "Baloo 2", "Trebuchet MS", sans-serif`;
  x.fillStyle = '#0b2a33'; x.fillRect(0, 0, W, c.height);
  let y = P;
  const text = (t, font, color, xx, yy, align='left') => { x.font = font; x.fillStyle = color; x.textAlign = align; x.textBaseline = 'alphabetic'; x.fillText(t, xx, yy); };
  const para = (t, font, color, xx, maxW, lh) => { x.font = font; wrapText(x, t, maxW).forEach(l => { y += lh; text(l, font, color, xx, y); }); };
  const box = (yy, h, fill, stroke) => { x.fillStyle = fill; x.strokeStyle = stroke; x.lineWidth = 5; x.beginPath(); if (x.roundRect) x.roundRect(P/2, yy, W - P, h, 26); else x.rect(P/2, yy, W - P, h); x.fill(); x.stroke(); };
  // header
  text('Shark Bait', disp(84), C.gold, P, y + 70); y += 96;
  const dt = new Date();
  text(`${dt.toLocaleDateString('en-GB', {day:'numeric', month:'long', year:'numeric'})} · Level ${d.level === 'MIX' ? 'Mixed' : d.level || ''}`, body(30), '#a9e6ec', P, y + 10); y += 40;
  // player + rank card (drawn on a parchment panel)
  const top = y; let img = null;
  try { img = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = portrait(me.base, me.color); }); } catch(e){}
  const panelH = 300; box(top, panelH, C.parch, C.rope);
  if (img) x.drawImage(img, P, top + 24, 190, 190);
  text(me.name || 'Pirate', disp(72), C.ink, P + 220, top + 92);
  text(`${f.rank.icon}  ${f.rank.title}`, disp(58), f.passed ? C.ok : C.blood, P + 220, top + 160);
  y = top + 180; x.font = body(28, 700); wrapText(x, f.rank.line, W - P*2 - 230).slice(0, 2).forEach(l => { y += 36; text(l, body(28, 700), C.rope, P + 220, y); });
  y = top + panelH + 24;
  // stats
  const stats = [[f.acc + '%', 'accuracy'], [String(me.score || 0), 'points'], [d.rank ? `${d.rank}/${d.of || '?'}` : '–', 'place'], [`${f.right}/${f.total}`, 'right']];
  const sw = (W - P - 3*16) / 4;
  stats.forEach(([v, l], i) => { const sx = P/2 + i*(sw + 16); x.fillStyle = C.paper; x.beginPath(); if (x.roundRect) x.roundRect(sx, y, sw, 130, 20); else x.rect(sx, y, sw, 130); x.fill();
    text(v, body(54, 800), i === 0 ? (f.passed ? C.ok : C.blood) : C.ink, sx + sw/2, y + 72, 'center'); text(l.toUpperCase(), body(22, 800), C.rope, sx + sw/2, y + 110, 'center'); });
  y += 160;
  // feedback blocks
  const block = (title, items, color) => {
    if (!items.length) return;
    x.font = body(30, 700); const lines = items.map(t => wrapText(x, t, W - P*2 - 50));
    const h = 76 + lines.reduce((a, l) => a + l.length*40 + 10, 0);
    box(y, h, C.paper, color); text(title, disp(46), color, P, y + 56); let yy = y + 66;
    lines.forEach(ls => { ls.forEach((l, k) => { yy += 40; if (!k) text('•', body(30, 800), color, P, yy); text(l, body(30, 700), C.ink, P + 30, yy); }); yy += 10; });
    y += h + 20;
  };
  block('Strengths', f.strengths, C.ok); block('Needs work', f.weak, C.blood); block('How to improve', f.tips, C.rope);
  // every prisoner
  text('Prisoner by prisoner', disp(56), C.gold, P, y + 56); y += 76;
  (d.review || []).forEach((r, k) => {
    x.font = body(29, 700);
    const rows = r.opts.map((o, j) => ({j, lines:wrapText(x, (j === r.correct ? '✓ ' : j === r.pick ? '✗ ' : '· ') + o + (j === r.pick ? '  (your answer)' : ''), W - P*2 - 30),
      why:j === r.pick && r.pick !== r.correct ? wrapText(x, '→ ' + clean(r.why[j]), W - P*2 - 60) : []}));
    const h = 110 + rows.reduce((a, rr) => a + rr.lines.length*38 + rr.why.length*36 + 8, 0) + (r.pick == null ? 40 : 0);
    const ok = r.pick === r.correct;
    box(y, h, C.parch, ok ? C.ok : C.blood);
    text(`${k + 1}. ${r.who}`, body(34, 800), C.ink, P, y + 48);
    text(r.saved ? `Saved · ${r.pct}%` : `Eaten · ${r.pct}%`, body(28, 800), r.saved ? C.ok : C.blood, W - P, y + 48, 'right');
    text(`${r.lvl} · ${r.topic}`, body(26, 700), C.rope, P, y + 86);
    let yy = y + 92;
    rows.forEach(rr => {
      const col = rr.j === r.correct ? C.ok : rr.j === r.pick ? C.blood : '#6b5a48';
      rr.lines.forEach(l => { yy += 38; text(l, body(29, rr.j === r.correct || rr.j === r.pick ? 800 : 700), col, P + 10, yy); });
      rr.why.forEach(l => { yy += 36; text(l, body(26, 700), C.rope, P + 40, yy); });
      yy += 8;
    });
    if (r.pick == null){ yy += 36; text("You didn't vote.", body(28, 800), C.blood, P + 10, yy); }
    y += h + 18;
  });
  text('shark-bait · say it right… or feed the sharks', body(24, 700), '#6fb6c0', W/2, y + 40, 'center'); y += 70;
  const out = document.createElement('canvas'); out.width = W; out.height = Math.ceil(y);
  out.getContext('2d').drawImage(c, 0, 0);
  return await new Promise(res => out.toBlob(res, 'image/png'));
}
$('saveBtn').addEventListener('click', async () => {
  if (!reviewData) return;
  if (!reviewBlob){ $('saveMsg').textContent = 'Drawing your review…'; try { reviewBlob = await renderReviewImage(reviewData, feedback(reviewData)); } catch(e){ $('saveMsg').textContent = 'Could not draw the image. Take a screenshot instead!'; return; } }
  const fname = `shark-bait-${(me.name || 'pirate').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
  const file = new File([reviewBlob], fname, {type:'image/png'});
  try {
    if (navigator.canShare && navigator.canShare({files:[file]})){ await navigator.share({files:[file], title:'Shark Bait review'}); $('saveMsg').textContent = 'Choose "Save Image" to keep it in your photos.'; return; }
  } catch(e){ if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(reviewBlob), a = document.createElement('a');
  a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  $('saveMsg').textContent = 'Saved! Look in your downloads.';
});

// keep the screen awake while playing (ignored where unsupported)
let lock = null;
async function wake(){ try { if ('wakeLock' in navigator && !lock){ lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => lock = null); } } catch(e){} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && joined) wake(); });

show('sConnect'); renderPicker();
})();
