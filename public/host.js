/* Shark Bait — host screen (projector).
   Runs the 3D scene, the round logic and the room. Phones vote through the Socket.IO relay (server.js). */
'use strict';
(() => {
const $ = id => document.getElementById(id);
const LEVELS = ['A1','A2','B1','B2','C1','MIX'];
const LEVEL_MEAN = {A1:.9, A2:.86, B1:.82, B2:.78, C1:.74};
const CHAR_BASES = ['henry','anne','mako','sharky','skeleton','skeleton2'];
const DEMO_CREW = [
  {name:'Valen', base:'anne', color:1}, {name:'Santi', base:'henry', color:2}, {name:'Mafe', base:'sharky', color:3},
  {name:'Juanjo', base:'mako', color:4}, {name:'Isa', base:'skeleton2', color:5}, {name:'Tomi', base:'henry', color:6},
];
// Clothing recolors. Index 0 keeps the original colors. Phones pick one of these by index.
const VARIANTS = [
  {hue:0, sat:1, val:1, skin:-1}, {hue:140, sat:1.1, val:1, skin:0}, {hue:220, sat:1, val:0.95, skin:3}, {hue:70, sat:1.1, val:1, skin:1},
  {hue:280, sat:1, val:1, skin:2}, {hue:180, sat:1.05, val:1, skin:4}, {hue:330, sat:1, val:1.05, skin:1}, {hue:30, sat:0.9, val:1, skin:3},
  {hue:250, sat:0.8, val:0.9, skin:0}, {hue:100, sat:1, val:0.95, skin:4},
];
const variantFor = (base, i) => Object.assign({}, VARIANTS[((i % VARIANTS.length) + VARIANTS.length) % VARIANTS.length],
  base.startsWith('skeleton') ? {noSkin:true, browns:true} : {}, base === 'anne' ? {browns:true} : {}, base === 'mako' ? {browns:true, greys:true} : {});
const CHIP_COLORS = ['#c0392b','#2e9a55','#3a6fd8','#c9b52a','#8e44ad','#16a2a8','#e0559a','#d9822b','#5e5aa8','#6aa83a'];

/* ---------- Settings ---------- */
const DEFAULTS = {level:'A1', n:5, t:20, pass:80, cap:true, snd:true, read:true, demo:false};
let cfg = {...DEFAULTS};
try { Object.assign(cfg, JSON.parse(localStorage.getItem('sharkbait-cfg') || '{}')); } catch(e){}
const saveCfg = () => { try { localStorage.setItem('sharkbait-cfg', JSON.stringify(cfg)); } catch(e){} };
const bankFor = level => level === 'MIX' ? Object.entries(BANK).flatMap(([l, a]) => a.map(x => [l, x])) : BANK[level].map(x => [level, x]);
function renderSettings(){
  $('lvlSeg').innerHTML = LEVELS.map(l => `<button type="button" data-l="${l}" aria-pressed="${cfg.level === l}">${l === 'MIX' ? 'Mixed' : l}</button>`).join('');
  $('bankInfo').textContent = `${bankFor(cfg.level).length} sentence trios in the bank`;
  $('sN').value = cfg.n; $('oN').textContent = cfg.n;
  $('sT').value = cfg.t; $('oT').textContent = cfg.t + ' s';
  $('sP').value = cfg.pass; $('oP').textContent = cfg.pass + '%';
  $('sCap').checked = cfg.cap; $('sSnd').checked = cfg.snd; $('sRead').checked = cfg.read; $('sDemo').checked = cfg.demo;
}
$('lvlSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; cfg.level = b.dataset.l; saveCfg(); renderSettings(); });
[['sN','n'],['sT','t'],['sP','pass']].forEach(([id,k]) => $(id).addEventListener('input', e => { cfg[k] = +e.target.value; saveCfg(); renderSettings(); }));
[['sCap','cap'],['sSnd','snd'],['sRead','read'],['sDemo','demo']].forEach(([id,k]) => $(id).addEventListener('change', e => {
  cfg[k] = e.target.checked; saveCfg(); if (k === 'snd') sea(cfg.snd); if (k === 'demo') syncDemoCrew(); updateStartNote();
}));
renderSettings();

let round = null, seq = [], si = 0, pt = 0, T = 0, playing = false, typer = null;   // round state (used by audio too)
let toastT = 0;
function toast(msg){ const t = $('toast'); t.textContent = msg; t.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => t.style.opacity = 0, 3200); }

/* ---------- Audio: ElevenLabs files in assets/audio (several takes per sound), synth fallback ---------- */
// Every mp3 in assets/audio is listed by the server. "splash.mp3", "splash-2.mp3", "splash-3.mp3"… are takes of the same
// sound: a random one plays each time, so games sound different. Optional files the game uses when present:
// ahoy-m*.mp3 / ahoy-f*.mp3 (crew greeting), scream-m*.mp3 / scream-f*.mp3, count5.mp3 … count1.mp3 (captain countdown).
let actx = null, master = null;
const SFX = {};                 // name -> [AudioBuffer, …]
const lastPick = {};
const FALLBACK_LIST = ['sea-loop','splash','bite','cheer','groan','parrot','fanfare','doom','bell','tick','captain-intro','captain-saved','captain-doom','lobby-song','ahoy-m'].map(n => n + '.mp3');
function loadSounds(){
  fetch('assets/audio/index.json', {cache:'no-cache'}).then(r => r.ok ? r.json() : Promise.reject()).catch(() => FALLBACK_LIST).then(list => list.forEach(f => {
    const m = /^(.+?)(?:-(\d+))?\.mp3$/i.exec(f); if (!m) return;
    fetch('assets/audio/' + encodeURIComponent(f)).then(r => r.ok ? r.arrayBuffer() : Promise.reject()).then(b => new Promise((ok, no) => actx.decodeAudioData(b, ok, no))).then(buf => {
      (SFX[m[1]] = SFX[m[1]] || []).push(buf);
      if (m[1] === 'sea-loop') sea(cfg.snd);
      if (m[1] === 'lobby-song') music();
    }).catch(() => {});
  }));
}
function unlockAudio(){
  if (!actx){
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); master = actx.createGain(); master.gain.value = 0.9; master.connect(actx.destination); } catch(e){ return; }
    loadSounds();
  }
  if (actx.state === 'suspended') actx.resume();
  sea(cfg.snd); music();
}
['pointerdown','keydown'].forEach(ev => window.addEventListener(ev, unlockAudio, {passive:true}));
// start downloading the sounds right away (the context stays suspended until the first click)
try { unlockAudio(); } catch(e){}
const has = name => !!(SFX[name] && SFX[name].length);
function pickBuf(name){
  const list = SFX[name]; if (!list || !list.length) return null;
  let k = Math.floor(Math.random()*list.length);
  if (list.length > 1 && k === lastPick[name]) k = (k + 1) % list.length;   // never the same take twice in a row
  lastPick[name] = k; return list[k];
}
function playBuf(name, vol=1, rate=1, when=0, buf=null){
  if (!cfg.snd || !actx) return false;
  buf = buf || pickBuf(name); if (!buf) return false;
  const s = actx.createBufferSource(), g = actx.createGain(); s.buffer = buf; s.playbackRate.value = rate; g.gain.value = vol;
  s.connect(g).connect(master); s.start(actx.currentTime + when); return s;
}
function beep(freq, dur, type='square', vol=0.06, when=0){
  if (!cfg.snd || !actx) return;
  const t = actx.currentTime + when, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, cutoff, vol, when=0, type='lowpass'){
  if (!cfg.snd || !actx) return;
  const len = Math.floor(actx.sampleRate*dur), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
  for (let i=0;i<len;i++) d[i] = (Math.random()*2-1) * Math.pow(1 - i/len, 2.5) * Math.min(1, i/200);
  const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  f.type = type; f.frequency.value = cutoff; g.gain.value = vol; s.buffer = buf; s.connect(f).connect(g).connect(master); s.start(actx.currentTime + when);
}
/* Cartoon scream: a sawtooth "Aaaaah!" through vowel formants, falling in pitch (used until scream-*.mp3 files exist) */
function synthScream(fem, dur=1.6, when=0){
  if (!cfg.snd || !actx) return;
  const t = actx.currentTime + when, f0 = (fem ? 560 : 250) * (0.9 + Math.random()*0.2);
  const o = actx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(f0*0.8, t); o.frequency.linearRampToValueAtTime(f0*1.4, t + 0.16);
  o.frequency.setValueAtTime(f0*1.4, t + dur*0.35); o.frequency.exponentialRampToValueAtTime(f0*0.5, t + dur);
  const lfo = actx.createOscillator(), lg = actx.createGain(); lfo.frequency.value = 6.5 + Math.random()*2; lg.gain.value = f0*0.06; lfo.connect(lg).connect(o.frequency);
  const out = actx.createGain();
  out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
  out.gain.setValueAtTime(0.5, t + dur*0.6); out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const F = fem ? [[950,1,7],[1500,.55,9],[2900,.3,11]] : [[750,1,7],[1150,.6,9],[2500,.25,11]];
  F.forEach(([f, gn, q]) => { const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; const gg = actx.createGain(); gg.gain.value = gn*2.6; o.connect(bp).connect(gg).connect(out); });
  out.connect(master); o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  noise(dur*0.8, fem ? 3200 : 2400, 0.05, when, 'bandpass');
}
function gurgle(when=0){ // bubbles after the bite
  if (!cfg.snd || !actx) return;
  for (let i=0;i<9;i++){
    const t = actx.currentTime + when + i*0.09 + Math.random()*0.05, o = actx.createOscillator(), g = actx.createGain(), f = 220 + Math.random()*260;
    o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f*2.6, t + 0.07);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.1);
  }
}
const sfx = {
  splash: () => playBuf('splash', 0.9, 0.95 + Math.random()*0.1) || noise(0.7, 900, 0.5),
  bite:   () => playBuf('bite', 0.95) || (beep(140, 0.12, 'square', 0.12), beep(90, 0.18, 'sawtooth', 0.1, 0.06)),
  cheer:  () => playBuf('cheer', 0.8) || [523,659,784].forEach((f,i) => beep(f, 0.18, 'triangle', 0.05, i*0.08)),
  groan:  () => playBuf('groan', 0.8) || [330,294,262].forEach((f,i) => beep(f, 0.3, 'sawtooth', 0.03, i*0.15)),
  // Ernest the parrot: the same squawk at different pitches, sometimes twice
  parrot: () => { const r = 0.85 + Math.random()*0.45; if (!playBuf('parrot', 0.7, r)) [1800,2300,1600].forEach((f,i) => beep(f*r, 0.07, 'sawtooth', 0.025, i*0.08)); else if (Math.random() < 0.4) playBuf('parrot', 0.55, r*1.12, 0.32); },
  fanfare:() => playBuf('fanfare', 0.8) || [523,659,784,1047].forEach((f,i) => beep(f, 0.22, 'triangle', 0.08, i*0.11)),
  doom:   () => playBuf('doom', 0.85) || [392,349,311,262].forEach((f,i) => beep(f, 0.35, 'sawtooth', 0.04, i*0.18)),
  bell:   () => playBuf('bell', 0.6) || beep(1320, 0.5, 'sine', 0.06),
  // the countdown opens with a double clang
  bell2:  () => { const b = pickBuf('bell'); if (b){ playBuf('bell', 0.65, 1, 0, b); playBuf('bell', 0.6, 0.97, 0.36, b); } else { beep(1320, 0.5, 'sine', 0.06); beep(1320, 0.5, 'sine', 0.05, 0.36); } },
  tick:   final => playBuf('tick', final ? 0.8 : 0.5, final ? 1.3 : 1) || beep(final ? 1320 : 880, 0.08, 'square', 0.04),
  scream: fem => playBuf(fem ? 'scream-f' : 'scream-m', 1, 0.95 + Math.random()*0.1) || synthScream(fem),
  gurgle: () => gurgle(),
};
let seaSrc = null, seaGain = null, seaSynth = null;
// MP3 files carry a few milliseconds of encoder silence at both ends, which clicks every time a loop restarts.
// Cut that off and blend the end of the sound into its beginning, so the loop has no seam at all.
function seamless(buf, fade=0.6){
  const sr = buf.sampleRate, cut = Math.floor(0.08*sr), F = Math.floor(fade*sr);
  const len = buf.length - 2*cut - F; if (len <= F) return buf;
  const out = actx.createBuffer(buf.numberOfChannels, len, sr);
  for (let ch = 0; ch < buf.numberOfChannels; ch++){
    const src = buf.getChannelData(ch), dst = out.getChannelData(ch);
    for (let i = 0; i < len; i++) dst[i] = src[cut + i];
    for (let i = 0; i < F; i++){ const t = i/F; dst[i] = dst[i]*Math.sin(t*Math.PI/2) + src[cut + len + i]*Math.cos(t*Math.PI/2); }
  }
  return out;
}
function sea(on){
  if (!actx) return;
  if (!on){ if (seaGain) seaGain.gain.setTargetAtTime(0, actx.currentTime, 0.4); return; }
  if (!seaGain){ seaGain = actx.createGain(); seaGain.gain.value = 0; seaGain.connect(master); }
  seaGain.gain.setTargetAtTime(playing ? 0.32 : 0.16, actx.currentTime, 0.6);
  if (has('sea-loop')){
    if (seaSynth){ try { seaSynth.stop(); } catch(e){} seaSynth = null; }
    if (!seaSrc){ seaSrc = actx.createBufferSource(); seaSrc.buffer = seamless(SFX['sea-loop'][0]); seaSrc.loop = true; seaSrc.connect(seaGain); seaSrc.start(); }
  } else if (!seaSynth){
    // soft brown-noise surf until the ElevenLabs loop is loaded
    const len = actx.sampleRate*4, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0); let last = 0;
    for (let i=0;i<len;i++){ last = (last + 0.02*(Math.random()*2-1)) / 1.02; d[i] = last*3.2*(0.6 + 0.4*Math.sin(i/len*Math.PI*2)); }
    seaSynth = actx.createBufferSource(); seaSynth.buffer = buf; seaSynth.loop = true;
    const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; seaSynth.connect(f).connect(seaGain); seaSynth.start();
  }
}
/* Lobby song: loops while the crew gathers, fades out when the ship sets sail */
let songSrc = null, songGain = null;
function music(){
  if (!actx || !has('lobby-song')) return;
  const want = cfg.snd && !playing;
  if (!songGain){ songGain = actx.createGain(); songGain.gain.value = 0; songGain.connect(master); }
  if (want && !songSrc && actx.state === 'running'){
    songSrc = actx.createBufferSource(); songSrc.buffer = seamless(SFX['lobby-song'][0], 1.5); songSrc.loop = true; songSrc.connect(songGain); songSrc.start();
  }
  songGain.gain.cancelScheduledValues(actx.currentTime);
  songGain.gain.setTargetAtTime(want ? 0.42 : 0, actx.currentTime, want ? 0.8 : 0.6);
  if (!want && songSrc){ const s = songSrc; songSrc = null; setTimeout(() => { try { s.stop(); } catch(e){} }, 4000); }
}
let capVoice = null;
function stopCaptain(){ if (capVoice){ try { capVoice.stop(); } catch(e){} capVoice = null; } }
function captainLine(name, buf){ stopCaptain(); capVoice = playBuf(name, 1, 1, 0, buf); return capVoice ? capVoice.buffer.duration : 0; }

/* Browser voices (read aloud, prisoners, fallbacks). Women prisoners get a female voice, men a male one. */
const VOICES = {any:null, f:null, m:null};
const isFemaleVoice = v => /female|zira|aria|jenny|michelle|samantha|susan|hazel|libby|sonia|emma|karen|moira|tessa|victoria|fiona|serena|ava|allison|natasha|clara|google us english/i.test(v.name);
const isMaleVoice = v => !isFemaleVoice(v) && /\bmale|david|guy|mark|daniel|george|ryan|alex|fred|thomas|arthur|christopher|eric|roger|brian|andrew|william|liam|oliver/i.test(v.name);
function pickVoices(){
  const vs = ((window.speechSynthesis && speechSynthesis.getVoices()) || []).filter(v => /^en/i.test(v.lang));
  const rank = v => (/natural|online|neural/i.test(v.name) ? 0 : 2) + (/en[-_](US|GB)/i.test(v.lang) ? 0 : 1) + (v.localService ? 0 : 0.5);
  const best = list => list.slice().sort((a, b) => rank(a) - rank(b))[0] || null;
  VOICES.f = best(vs.filter(isFemaleVoice)); VOICES.m = best(vs.filter(isMaleVoice));
  VOICES.any = vs.find(v => /en[-_](US|GB)/i.test(v.lang) && /natural|google|samantha|daniel|aria|jenny/i.test(v.name)) || vs[0] || null;
}
if (window.speechSynthesis){ pickVoices(); speechSynthesis.onvoiceschanged = pickVoices; }
// gender 'f' / 'm' picks a voice; when the computer only has one voice, the pitch still tells them apart
function utter(text, opts={}){
  if (!window.speechSynthesis) return null;
  const u = new SpeechSynthesisUtterance(text);
  const v = (opts.g && VOICES[opts.g]) || VOICES.any;
  if (v){ u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
  const sameVoice = opts.g && !VOICES[opts.g];
  u.rate = opts.rate || 0.92;
  u.pitch = Math.max(0.1, Math.min(2, (opts.pitch || 1) * (sameVoice ? (opts.g === 'f' ? 1.35 : 0.7) : 1)));
  u.volume = opts.volume == null ? 1 : opts.volume;
  if (opts.onstart) u.onstart = opts.onstart;
  speechSynthesis.speak(u); return u;
}
function speak(text, opts={}){ return cfg.read ? utter(text, opts) : null; }          // listening practice (setting)
function shout(text, opts={}){ return cfg.snd ? utter(text, opts) : null; }           // sound effects made of words
function hush(){ try { window.speechSynthesis && speechSynthesis.cancel(); } catch(e){} }
// Captain's countdown: count5.mp3 … count1.mp3 if present, otherwise a deep browser voice
const COUNT_WORDS = ['', 'One!', 'Two!', 'Three!', 'Four!', 'Five!'];
function countdown(n){
  if (playBuf('count' + n, 1)) return;
  if (cfg.snd && window.speechSynthesis){ speechSynthesis.cancel(); utter(COUNT_WORDS[n], {g:'m', pitch:0.55, rate:1.15}); }
}
// "Ahoy!" when a pirate joins or taps the button on the phone
let lastAhoy = 0;
function ahoy(p){
  const now = performance.now(); if (now - lastAhoy < 450) return; lastAhoy = now;
  const fem = p.voice === 'f';
  const rate = fem ? 0.95 + Math.random()*0.15 : 1.0 + ((p.color * 37 + p.name.length * 13) % 25) / 100;
  if (playBuf(fem ? 'ahoy-f' : 'ahoy-m', 1, rate)) return;
  const lines = ['Ahoy!', 'Ahoy there!', 'Ahoy, matey!'];
  if (cfg.snd && window.speechSynthesis){ utter(lines[Math.floor(Math.random()*lines.length)], {g:fem ? 'f' : 'm', pitch:fem ? 1.15 : 0.85 + Math.random()*0.2, rate:1.05}); }
}

/* ---------- Three.js ---------- */
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputEncoding = THREE.sRGBEncoding;
const scene = new THREE.Scene();
const C = hex => new THREE.Color(hex).convertSRGBToLinear();
const FOG = C(0xb4e6ec);
scene.fog = new THREE.Fog(FOG, 110, 420);
const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 900);
function resize(){
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w / h < 1 ? 62 : 46; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();
const M = (c, o={}) => new THREE.MeshPhongMaterial(Object.assign({color:C(c), flatShading:true, shininess:6}, o));
const B = (c, o={}) => new THREE.MeshBasicMaterial(Object.assign({color:C(c)}, o));
const mesh = (g, m, x=0,y=0,z=0) => { const o = new THREE.Mesh(g, m); o.position.set(x,y,z); return o; };
scene.add(new THREE.HemisphereLight(C(0xe2f8ff), C(0x2a6f6f), 1.05));
const SUN_DIR = new THREE.Vector3(0.45, 0.62, -0.64).normalize();
const sun = new THREE.DirectionalLight(C(0xfff0d0), 0.95); sun.position.copy(SUN_DIR).multiplyScalar(100); scene.add(sun);

{ // sky dome + sun
  const g = new THREE.SphereGeometry(800, 32, 16);
  const col = [], top = C(0x2f97d0), hor = C(0xcff4f2), p = g.attributes.position;
  for (let i=0;i<p.count;i++){ const t = Math.max(0, p.getY(i)/800); const c = hor.clone().lerp(top, Math.pow(t,0.55)); col.push(c.r,c.g,c.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col,3));
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({vertexColors:true, side:THREE.BackSide, fog:false})));
  scene.add(mesh(new THREE.SphereGeometry(18,16,12), B(0xfff6c8, {fog:false}), SUN_DIR.x*700, SUN_DIR.y*700, SUN_DIR.z*700));
  // a few puffy clouds
  const cm = new THREE.MeshLambertMaterial({color:C(0xffffff), emissive:C(0x9fb8c4), fog:false});
  for (let i=0;i<14;i++){
    const cl = new THREE.Group(), a = i/14*Math.PI*2 + Math.random()*0.3, r = 420 + Math.random()*160;
    for (let k=0;k<5;k++){ const s = mesh(new THREE.IcosahedronGeometry(14 + Math.random()*12, 1), cm, (k-2)*16 + Math.random()*6, Math.random()*8, Math.random()*10); s.scale.y = 0.55; cl.add(s); }
    cl.position.set(Math.cos(a)*r, 90 + Math.random()*70, Math.sin(a)*r); cl.lookAt(0, cl.position.y, 0); scene.add(cl);
  }
}

/* ---------- Ocean: GPU waves, foam, sun glints ---------- */
const WAVES = [ // dirX, dirZ, amplitude, k (2π/λ), speed
  [ 0.96,  0.28, 0.42, 0.28, 1.15],
  [-0.37,  0.93, 0.30, 0.41, 1.45],
  [ 0.71, -0.71, 0.16, 0.86, 2.05],
  [-0.98, -0.20, 0.09, 1.65, 2.80],
  [ 0.20,  0.98, 0.05, 2.70, 3.40],
];
function waveHeight(x, z, t){ let h = 0; for (const [dx,dz,a,k,s] of WAVES) h += a*Math.sin((dx*x + dz*z)*k + t*s); return h; }
const SHIP_FOAM = new THREE.Vector4(-1.8, 0, 17.5, 6.6); // wake: center x,z, half length, half width
const HULL = new THREE.Vector4(0, 0, 11.6, 4.9);          // hull at the waterline: no water inside it, calm water around it
const ISLES = [];                                          // x, z, radius x, radius z of each island's sand
// Waves calm down next to the hull and the beaches, and the sea sits a little lower there, so it never floods them.
function shoreDamp(x, z){
  let d = 1;
  const hx = (x - HULL.x)/HULL.z, hz = (z - HULL.y)/HULL.w;
  d = Math.min(d, 0.22 + 0.78*smooth(1.0, 1.7, Math.sqrt(hx*hx + hz*hz)));
  for (const [ix, iz, rx, rz] of ISLES){ const ex = (x - ix)/rx, ez = (z - iz)/rz; d = Math.min(d, 0.2 + 0.8*smooth(1.0, 1.5, Math.sqrt(ex*ex + ez*ez))); }
  return d;
}
function smooth(a, b, x){ const t = Math.min(1, Math.max(0, (x - a)/(b - a))); return t*t*(3 - 2*t); }
function seaLevel(x, z, t){ const d = shoreDamp(x, z); return waveHeight(x, z, t)*d - (1 - d)*0.3; }
const seaMat = new THREE.ShaderMaterial({
  uniforms:{
    uTime:{value:0}, uDeep:{value:C(0x064c62)}, uShallow:{value:C(0x17b3bf)}, uSky:{value:C(0xbfeef2)}, uFoam:{value:C(0xf4ffff)},
    uSun:{value:SUN_DIR}, uFog:{value:FOG}, uFogNear:{value:110}, uFogFar:{value:420}, uShip:{value:SHIP_FOAM}, uHull:{value:HULL},
    uIsles:{value:[0,1,2,3,4,5].map(() => new THREE.Vector4(0,0,0,0))},
  },
  vertexShader:`
    uniform float uTime; uniform vec4 uHull; uniform vec4 uIsles[6];
    varying vec3 vWorld; varying vec3 vNormal; varying float vH;
    void wave(vec2 p, float dx, float dz, float a, float k, float s, inout float h, inout vec2 d){
      float ph = (dx*p.x + dz*p.y)*k + uTime*s; h += a*sin(ph); float c = a*k*cos(ph); d += vec2(dx*c, dz*c);
    }
    void main(){
      vec4 w = modelMatrix * vec4(position, 1.0);
      float h = 0.0; vec2 d = vec2(0.0);
      ${WAVES.map(([dx,dz,a,k,s]) => `wave(w.xz, ${dx.toFixed(3)}, ${dz.toFixed(3)}, ${a.toFixed(3)}, ${k.toFixed(3)}, ${s.toFixed(3)}, h, d);`).join('\n      ')}
      float damp = 0.22 + 0.78*smoothstep(1.0, 1.7, length((w.xz - uHull.xy)/uHull.zw));
      for (int i = 0; i < 6; i++){ if (uIsles[i].z <= 0.0) continue; damp = min(damp, 0.2 + 0.8*smoothstep(1.0, 1.5, length((w.xz - uIsles[i].xy)/uIsles[i].zw))); }
      h *= damp; d *= damp;
      w.y += h - (1.0 - damp)*0.3; vH = h; vWorld = w.xyz; vNormal = normalize(vec3(-d.x, 1.0, -d.y));
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader:`
    uniform float uTime; uniform vec3 uDeep, uShallow, uSky, uFoam, uSun, uFog; uniform float uFogNear, uFogFar;
    uniform vec4 uShip; uniform vec4 uHull; uniform vec4 uIsles[6];
    varying vec3 vWorld; varying vec3 vNormal; varying float vH;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    float fbm(vec2 p){ return vnoise(p)*0.55 + vnoise(p*2.1+7.3)*0.3 + vnoise(p*4.3-2.1)*0.15; }
    void main(){
      vec2 p = vWorld.xz;
      if (length((p - uHull.xy)/uHull.zw) < 1.0) discard;   // no sea inside the hull
      float n1 = fbm(p*0.32 + vec2(uTime*0.11, uTime*0.07));
      float n2 = fbm(p*0.32 + vec2(0.37, 0.0) + vec2(uTime*0.11, uTime*0.07));
      float n3 = fbm(p*0.32 + vec2(0.0, 0.37) + vec2(uTime*0.11, uTime*0.07));
      vec3 N = normalize(vNormal + vec3(n1 - n2, 0.0, n1 - n3) * 1.4);
      vec3 V = normalize(cameraPosition - vWorld);
      float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
      vec3 col = mix(uDeep, uShallow, smoothstep(-0.55, 0.75, vH + (n1-0.5)*0.4));
      col = mix(col, uSky, fres * 0.6);
      float spec = pow(max(dot(reflect(-uSun, N), V), 0.0), 140.0) * 1.6;
      float glint = step(0.93, vnoise(p*3.2 + uTime*1.7)) * pow(max(dot(reflect(-uSun, N), V), 0.0), 18.0) * 0.9;
      float foam = smoothstep(0.62, 0.95, vH + (n1 - 0.5)*0.6) * 0.42;
      // wake around the ship
      vec2 q = (p - uShip.xy) / vec2(uShip.z, uShip.w);
      float e = length(q);
      foam += smoothstep(1.22, 1.02, e) * smoothstep(0.85, 1.02, e) * smoothstep(0.35, 0.75, vnoise(p*1.4 + uTime*0.9)) * 0.75;
      // surf rings around islands
      for (int i = 0; i < 6; i++){
        if (uIsles[i].z <= 0.0) continue;
        vec2 rel = (p - uIsles[i].xy) / uIsles[i].zw;
        float dd = (length(rel) - 1.0) * min(uIsles[i].z, uIsles[i].w);
        if (dd < -0.8) discard;                                  // under the sand: no sea poking through
        float ring = smoothstep(4.0, 0.0, dd) * smoothstep(-0.8, 0.6, dd);
        float lap = 0.5 + 0.5*sin(dd*1.6 - uTime*2.2 + n1*4.0);
        foam += ring * (0.35 + 0.65*lap) * (0.6 + 0.4*vnoise(p*0.9 + uTime*0.4));
        col = mix(col, uShallow*1.25, smoothstep(9.0, 0.0, dd) * 0.55);
      }
      col = mix(col, uFoam, clamp(foam, 0.0, 0.9));
      col += vec3(1.0, 0.95, 0.85) * (spec + glint);
      float dist = length(vWorld - cameraPosition);
      col = mix(col, uFog, smoothstep(uFogNear, uFogFar, dist));
      gl_FragColor = linearToOutputTexel(vec4(col, 1.0));
    }`,
});
const ocean = new THREE.Mesh(new THREE.PlaneGeometry(900, 900, 220, 220).rotateX(-Math.PI/2), seaMat);
scene.add(ocean);
function addIsle(x, z, rx, rz=rx){ const i = ISLES.length; if (i < 6){ seaMat.uniforms.uIsles.value[i].set(x, z, rx, rz); ISLES.push([x, z, rx, rz]); } }

/* ---------- Models ---------- */
const gltf = new THREE.GLTFLoader();
const MODELS = ['captain', ...CHAR_BASES, 'shark','ship','small-ship','palm-tree','palm2','palm3','bigrock1','bigrock2','bigrock3',
  'house','house2','house3','dock','dock-broken','chest-gold','barrel','large-bone','skull','red-x'];
const G = {};
function loadAll(){
  let done = 0;
  const jobs = MODELS.map(n => new Promise(res => gltf.load(`assets/models/${n}.glb`, g => { G[n] = g; res(); }, undefined, () => res())));
  jobs.forEach(j => j.then(() => { done++; if (!ready) $('start').textContent = `Loading ship… ${Math.round(done/jobs.length*100)}%`; }));
  return Promise.all(jobs);
}
function inst(name, x=0, y=0, z=0, s=1, ry=0){
  if (!G[name]) return null;
  const o = G[name].scene.clone(true); o.position.set(x,y,z); o.scale.setScalar(s); o.rotation.y = ry; return o;
}

/* ---------- Recolor (each copy gets its own clothes) ---------- */
const atlasCache = new Map();
function rgb2hsv(r,g,b){ r/=255; g/=255; b/=255; const mx = Math.max(r,g,b), mn = Math.min(r,g,b), d = mx - mn; let h = 0;
  if (d){ if (mx === r) h = ((g-b)/d) % 6; else if (mx === g) h = (b-r)/d + 2; else h = (r-g)/d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx ? d/mx : 0, mx]; }
function hsv2rgb(h,s,v){ const c = v*s, x = c*(1 - Math.abs((h/60) % 2 - 1)), m = v - c; let r=0,g=0,b=0;
  if (h < 60) [r,g,b] = [c,x,0]; else if (h < 120) [r,g,b] = [x,c,0]; else if (h < 180) [r,g,b] = [0,c,x]; else if (h < 240) [r,g,b] = [0,x,c]; else if (h < 300) [r,g,b] = [x,0,c]; else [r,g,b] = [c,0,x];
  return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)]; }
const SKINS = [[247,206,160],[229,178,128],[198,140,92],[150,98,62],[104,68,44]];
function recolorTexture(tex, key, v){
  if (atlasCache.has(key)) return atlasCache.get(key);
  const img = tex.image, N = 1024, S = 256, cell = 32, k = S / N;
  const src = document.createElement('canvas'); src.width = src.height = N;
  const sx = src.getContext('2d'); sx.drawImage(img, 0, 0, N, N);
  const data = sx.getImageData(0, 0, N, N).data;
  const out = document.createElement('canvas'); out.width = out.height = S;
  const ox = out.getContext('2d'); ox.imageSmoothingEnabled = false; ox.drawImage(src, 0, 0, S, S);
  for (let cy = 0; cy < N; cy += cell) for (let cx = 0; cx < N; cx += cell){
    const i = ((cy + cell/2) * N + (cx + cell/2)) * 4;
    let r = data[i], g = data[i+1], b = data[i+2];
    if (r > 248 && g > 248 && b > 248) continue;
    let [h, s, val] = rgb2hsv(r, g, b);
    const isSkin = !v.noSkin && h >= 12 && h <= 38 && s >= 0.2 && s <= 0.58 && val >= 0.62;
    const isFabric = s >= 0.28 && val >= 0.22 && !(h >= 12 && h <= 52);
    if (isSkin && v.skin >= 0){ const t = SKINS[v.skin], f = val / 0.82; [r, g, b] = t.map(c => Math.min(255, Math.round(c * f))); }
    else if (isFabric){ h = (h + v.hue + 360) % 360; s = Math.min(1, s * v.sat); [r, g, b] = hsv2rgb(h, s, Math.min(1, val * v.val)); }
    else if (v.browns && v.hue && h >= 12 && h <= 52 && s >= 0.3 && val >= 0.16 && val < 0.62){ [r, g, b] = hsv2rgb((h + v.hue + 340) % 360, Math.min(1, s*0.95), Math.min(1, val*1.15)); }
    else if (v.greys && v.hue && s < 0.2 && val >= 0.35 && val <= 0.86){ [r, g, b] = hsv2rgb((v.hue + 190) % 360, 0.3, val); }
    else continue;
    ox.fillStyle = `rgb(${r},${g},${b})`; ox.fillRect(cx*k, cy*k, cell*k, cell*k);
  }
  const t = new THREE.CanvasTexture(out);
  t.flipY = false; t.encoding = THREE.sRGBEncoding; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  atlasCache.set(key, t); return t;
}

/* ---------- Animated actors ---------- */
const CHAR_S = 1.3;
const mixers = [];
const ANIMS = ['Idle','Walk','Run','Jump','Duck','HitReact','Death','No','Yes','Wave','Sword','Punch'];
const ONCE = new Set(['Jump','HitReact','Death']);
function nameplate(text, color='#f1d9a6'){
  const c = document.createElement('canvas'); c.width = 400; c.height = 80;
  const x = c.getContext('2d');
  x.font = '800 36px "Baloo 2", "Trebuchet MS", sans-serif';
  const w = Math.min(390, x.measureText(text).width + 40);
  x.fillStyle = 'rgba(42,22,11,.82)';
  if (x.roundRect){ x.beginPath(); x.roundRect((400-w)/2, 10, w, 58, 29); x.fill(); } else x.fillRect((400-w)/2, 10, w, 58);
  x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 200, 41);
  const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, depthTest:false, transparent:true}));
  s.scale.set(2.1, 0.42, 1); s.renderOrder = 20; return s;
}
function makeActor(base, opts={}){
  const src = G[base]; if (!src) return null;
  const root = THREE.SkeletonUtils.clone(src.scene);
  root.scale.setScalar(opts.scale || CHAR_S);
  const v = opts.variant;
  root.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    if (opts.unarmed && /^Weapon/i.test(o.name)) { o.visible = false; return; }
    if (v){
      const swap = m => { const n = m.clone(); if (m.map) n.map = recolorTexture(m.map, `${base}|${v.hue}|${v.skin}|${v.sat}|${v.val}`, v); return n; };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    }
  });
  const g = new THREE.Group(); g.add(root);
  const mixer = new THREE.AnimationMixer(root); mixers.push(mixer);
  const actions = {};
  ANIMS.forEach(n => {
    const clip = src.animations.find(a => a.name.split('|')[3] === n);
    if (!clip) return;
    const a = mixer.clipAction(clip);
    if (ONCE.has(n)){ a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
    actions[n] = a;
  });
  if (opts.label){ const p = nameplate(opts.label, opts.labelColor); p.position.y = 1.6*(opts.scale || CHAR_S) + 0.45; g.add(p); g.userData.plate = p; }
  const actor = {g, root, mixer, actions, cur:null};
  mixer.timeScale = 0.9 + Math.random()*0.2;
  play(actor, 'Idle'); mixer.update(Math.random()*2);
  return actor;
}
function disposeActor(a){
  if (!a) return;
  a.g.parent && a.g.parent.remove(a.g);
  const k = mixers.indexOf(a.mixer); if (k >= 0) mixers.splice(k, 1);
  if (a.g.userData.plate){ a.g.userData.plate.material.map.dispose(); a.g.userData.plate.material.dispose(); }
}
function play(a, name, fade=0.22){
  if (!a || a.cur === name) return;
  const next = a.actions[name]; if (!next) return;
  next.reset(); next.enabled = true; next.setEffectiveWeight(1); next.play();
  if (a.cur && a.actions[a.cur]) a.actions[a.cur].crossFadeTo(next, fade, false);
  a.cur = name;
}

/* ---------- World ---------- */
const ship = new THREE.Group(); scene.add(ship);
const SHIP_S = 2.2, SHIP_Y = 0.55;   // gun ports sit well above the waterline
const DECK = 1.0*SHIP_S + SHIP_Y, FORE = 1.5*SHIP_S + SHIP_Y, QUARTER = 1.95*SHIP_S + SHIP_Y;
const PLANK_X = 1.8;
const PLANK_START = new THREE.Vector3(PLANK_X, DECK, 3.4), PLANK_END = new THREE.Vector3(PLANK_X, DECK + 0.14, 8.7);
const SPLASH = new THREE.Vector3(PLANK_X, 0.2, 10.0);
const SHARK_C = new THREE.Vector3(PLANK_X, 0, 13.2), SHARK_R = 3.2;
const CAP_POS = new THREE.Vector3(10.0, QUARTER, 0);
const SKULL_ISLE = new THREE.Vector3(-46, 0, -120);
const SAND_Y = 0.62;
let captain = null, navy = null, flag = null, flagGeo = null, flagBase = null;
// Three sharks circle the plank. sharks[0] leaps for the prisoner, the other two join the feeding frenzy.
const sharks = [];
const SHARK_RINGS = [[3.4, 0.7, 0, 1.0], [6.2, -0.48, 2.3, 0.9], [9.0, 0.36, 4.4, 1.12]];   // radius, turn speed, start angle, size

function sandIsland(r){
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(r, r*1.3, 2.4, 18), M(0xedd49b), 0, -0.6, 0));
  g.add(mesh(new THREE.CylinderGeometry(r*0.62, r*0.8, 0.5, 14), M(0x7cbf4f), r*0.08, 0.75, -r*0.05));
  return g;
}
function jollyRogerTexture(){
  const W = 1024, H = 660, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#141414'; x.fillRect(0, 0, W, H);
  for (let i=0;i<2600;i++){ x.fillStyle = `rgba(255,255,255,${Math.random()*0.035})`; x.fillRect(Math.random()*W, Math.random()*H, 2 + Math.random()*6, 1); }
  x.fillStyle = 'rgba(255,255,255,.05)'; for (let i=0;i<5;i++){ x.beginPath(); x.ellipse(Math.random()*W, Math.random()*H, 40+Math.random()*90, 10, Math.random(), 0, 7); x.fill(); }
  const cx = W/2, cy = H*0.44, bone = '#f3ead2';
  // crossed bones
  x.strokeStyle = bone; x.lineCap = 'round';
  for (const s of [-1, 1]){
    x.save(); x.translate(cx, cy + 70); x.rotate(s*0.62);
    x.lineWidth = 46; x.beginPath(); x.moveTo(-300, 0); x.lineTo(300, 0); x.stroke();
    x.fillStyle = bone; for (const e of [-1, 1]) for (const k of [-1, 1]){ x.beginPath(); x.arc(e*310, k*26, 34, 0, 7); x.fill(); }
    x.restore();
  }
  // skull
  x.fillStyle = bone;
  x.beginPath(); x.ellipse(cx, cy - 20, 175, 160, 0, 0, 7); x.fill();
  x.beginPath(); x.roundRect ? x.roundRect(cx - 110, cy + 70, 220, 105, 30) : x.rect(cx - 110, cy + 70, 220, 105); x.fill();
  x.fillStyle = '#141414';
  for (const s of [-1, 1]){ x.beginPath(); x.ellipse(cx + s*68, cy - 10, 52, 58, s*0.25, 0, 7); x.fill(); }
  x.beginPath(); x.moveTo(cx, cy + 40); x.lineTo(cx - 24, cy + 82); x.lineTo(cx + 24, cy + 82); x.closePath(); x.fill();
  // shark teeth
  x.fillStyle = '#141414'; x.fillRect(cx - 100, cy + 112, 200, 46);
  x.fillStyle = bone;
  for (let i=0;i<7;i++){ const tx = cx - 100 + i*(200/7); x.beginPath(); x.moveTo(tx, cy + 112); x.lineTo(tx + 200/14, cy + 140); x.lineTo(tx + 200/7, cy + 112); x.fill();
    x.beginPath(); x.moveTo(tx + 200/14, cy + 158); x.lineTo(tx + 200/7, cy + 132); x.lineTo(tx + 200/7 + 200/14, cy + 158); x.fill(); }
  // red bandana
  x.fillStyle = '#c7342b'; x.beginPath(); x.ellipse(cx, cy - 115, 182, 70, 0, Math.PI, 0); x.fill();
  x.fillRect(cx - 182, cy - 120, 364, 22);
  x.beginPath(); x.moveTo(cx + 170, cy - 112); x.lineTo(cx + 270, cy - 160); x.lineTo(cx + 250, cy - 95); x.fill();
  x.beginPath(); x.moveTo(cx + 170, cy - 104); x.lineTo(cx + 280, cy - 70); x.lineTo(cx + 215, cy - 40); x.fill();
  x.fillStyle = 'rgba(255,255,255,.85)'; for (let i=0;i<9;i++){ x.beginPath(); x.arc(cx - 140 + i*35, cy - 140 + (i%2)*18, 7, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
}
function buildSkullIsland(){
  const g = new THREE.Group(); g.position.copy(SKULL_ISLE); scene.add(g);
  g.add(sandIsland(24));
  const spit = mesh(new THREE.CylinderGeometry(15, 17, 2.4, 22), M(0xf0d9a2), 0, -0.6, 27); spit.scale.set(1.35, 1, 0.75); g.add(spit);
  [['bigrock2', -9, 0, -8, 3.4, 0.3], ['bigrock1', 10, 0, -6, 3.0, 1.9], ['bigrock3', 0, 0, -12, 3.2, 0.9], ['bigrock1', -16, 0, 6, 1.8, 2.6]]
    .forEach(([n,x,y,z,s,r]) => { const o = inst(n,x,y,z,s,r); if (o) g.add(o); });
  const sk = inst('skull', 0, 1.5, -1, 28, 0);
  if (sk){ g.add(sk); g.updateMatrixWorld(true); sk.lookAt(SKULL_ISLE.x + 4, 6, SKULL_ISLE.z + 60); }
  [['palm-tree', 14, 0.9, 12, 2.6, 0.4], ['palm2', -14, 0.9, 14, 2.8, 2], ['palm3', 18, 0.9, -2, 2.4, 1], ['palm2', -20, 0.9, -4, 2.2, 3]]
    .forEach(([n,x,y,z,s,r]) => { const o = inst(n,x,y,z,s,r); if (o) g.add(o); });
  addIsle(SKULL_ISLE.x, SKULL_ISLE.z, 24); addIsle(SKULL_ISLE.x, SKULL_ISLE.z + 27, 15*1.35, 15*0.75);
  // giant flag on a mast behind the skull
  const poleX = -24, poleZ = -10, poleH = 48;
  g.add(mesh(new THREE.CylinderGeometry(0.7, 1.0, poleH, 8), M(0x5a341a), poleX, poleH/2, poleZ));
  g.add(mesh(new THREE.SphereGeometry(1.4, 10, 8), M(0xf0b43a, {shininess:60}), poleX, poleH + 0.6, poleZ));
  const FW = 40, FH = 26;
  flagGeo = new THREE.PlaneGeometry(FW, FH, 46, 30); flagGeo.translate(FW/2, -FH/2, 0);
  flagBase = Float32Array.from(flagGeo.attributes.position.array);
  flag = new THREE.Mesh(flagGeo, new THREE.MeshLambertMaterial({map:jollyRogerTexture(), side:THREE.DoubleSide}));
  flag.position.set(poleX + 0.6, poleH - 1.2, poleZ); flag.rotation.y = 0.05; g.add(flag);
  g.userData.skull = sk;
  return g;
}
let skullIsle = null;
function updateFlag(t){
  if (!flag) return;
  const a = flagGeo.attributes.position.array, FW = 40;
  for (let i=0;i<a.length;i+=3){
    const x = flagBase[i], y = flagBase[i+1], u = x / FW;
    a[i+2] = (Math.sin(x*0.22 - t*3.1 + y*0.05)*2.2 + Math.sin(x*0.5 - t*4.7 + y*0.18)*0.6) * u;
    a[i+1] = y - u*u*1.6 + Math.sin(x*0.3 - t*2.6)*0.4*u;
  }
  flagGeo.attributes.position.needsUpdate = true; flagGeo.computeVertexNormals();
}

function buildWorld(){
  const hull = inst('ship', 0, SHIP_Y, 0, SHIP_S);
  if (hull){ hull.traverse(o => { if (o.isMesh){ o.material = o.material.clone(); o.material.side = THREE.DoubleSide; } }); ship.add(hull); }
  else ship.add(mesh(new THREE.BoxGeometry(24, 3, 7), M(0x8a5530), 0, DECK - 1.5, 0));
  ship.add(mesh(new THREE.BoxGeometry(1.0, 0.16, 6.2), M(0xb5793f), PLANK_X, DECK + 0.08, 6.25));
  ship.add(mesh(new THREE.BoxGeometry(1.25, 0.12, 0.4), M(0x5a341a), PLANK_X, DECK + 0.18, 3.5));
  for (const dz of [5.2, 7.2]) ship.add(mesh(new THREE.BoxGeometry(1.06, 0.06, 0.09), M(0x6b4022), PLANK_X, DECK + 0.17, dz));
  const chest = inst('chest-gold', 11.9, QUARTER, 2.4, 0.9, -Math.PI/2); if (chest) ship.add(chest);

  skullIsle = buildSkullIsland();
  // pirate port
  const port = sandIsland(26); port.position.set(70, 0, -150); scene.add(port); addIsle(70, -150, 26);
  [['house3', -6, 0.9, -4, 1.5, 0.3], ['house2', 9, 0.9, -8, 1.4, -0.2], ['house', -16, 0.9, 6, 1.4, 0.8], ['palm-tree', 12, 0.9, 8, 2.2, 1], ['palm2', 4, 0.9, 12, 2.4, 2],
   ['palm3', -14, 0.9, -12, 2.3, 0.4], ['palm-tree', 18, 0.9, -2, 2.0, 2.5], ['barrel', 2, 0.9, 6, 1.5, 0], ['chest-gold', -2, 0.9, 9, 1.3, 0.7]]
    .forEach(([n,x,y,z,s,r]) => { const o = inst(n,x,y,z,s,r); if (o) port.add(o); });
  for (let i=0;i<5;i++){ const d = inst(i === 3 ? 'dock-broken' : 'dock', 6 + i*2.6*1.4, 0.4, 25, 1.4, 0); if (d) port.add(d); }
  const boat = inst('small-ship', 16, -0.2, 31, 1.8, 0.2); if (boat) port.add(boat);
  // bone island
  const bones = sandIsland(14); bones.position.set(140, 0, -40); scene.add(bones); addIsle(140, -40, 14);
  [['palm2', -4, 0.9, -3, 2.4, 0], ['palm-tree', 5, 0.9, 2, 2.2, 1.4], ['large-bone', 1, 0.9, -6, 1.2, 0.5], ['red-x', 2, 1.0, 6, 2, 0]]
    .forEach(([n,x,y,z,s,r]) => { const o = inst(n,x,y,z,s,r); if (o) bones.add(o); });
  // rocky islet
  const rocky = sandIsland(12); rocky.position.set(-170, 0, 30); scene.add(rocky); addIsle(-170, 30, 12);
  [['bigrock2', 0, 0, 0, 2.2, 0.4], ['palm3', 6, 0.9, 5, 2.2, 0], ['palm-tree', -7, 0.9, 6, 2.0, 2]]
    .forEach(([n,x,y,z,s,r]) => { const o = inst(n,x,y,z,s,r); if (o) rocky.add(o); });
  [['bigrock1', 45, -64, 1.8], ['bigrock3', -55, 60, 1.6], ['bigrock2', 120, 60, 2.2], ['bigrock1', -100, -60, 1.3]]
    .forEach(([n,x,z,s]) => { const o = inst(n, x, -0.5, z, s, Math.random()*6); if (o) scene.add(o); });
  // another pirate ship patrolling the horizon
  navy = inst('ship', -200, -1.2, -230, 2.6, Math.PI/2);
  if (navy){ navy.traverse(o => { if (o.isMesh){ o.material = o.material.clone(); o.material.side = THREE.DoubleSide; } }); scene.add(navy); }

  if (G.shark) SHARK_RINGS.forEach((ring, i) => {
    const g = new THREE.Group(), pitch = new THREE.Group(); g.add(pitch); scene.add(g);
    const model = i === 0 ? G.shark.scene : THREE.SkeletonUtils.clone(G.shark.scene);
    model.scale.multiplyScalar(ring[3]); pitch.add(model);
    const mx = new THREE.AnimationMixer(model); mixers.push(mx); mx.timeScale = 0.85 + i*0.15;
    const acts = {}; ['Swim','Swim_Fast','Swim_Bite'].forEach(n => { const c = G.shark.animations.find(a => a.name.split('|')[3] === n); if (c) acts[n] = mx.clipAction(c); });
    const s = {g, pitch, actor:{mixer:mx, actions:acts, cur:null}, mode:'circle', a:ring[2], r:ring[0], w:ring[1], s:0, pos:new THREE.Vector3(), yaw:0, target:new THREE.Vector3()};
    play(s.actor, 'Swim'); sharks.push(s);
  });
  captain = makeActor('captain', {label:'Captain Barbarossa', labelColor:'#f0b43a', scale:CHAR_S*1.15});
  if (captain){ captain.g.position.copy(CAP_POS); ship.add(captain.g); }
}

/* ---------- Crew spots on deck ---------- */
const CREW_SPOTS = [];
for (const z of [-2.9, -2.1, -1.3]) for (let i=0;i<7;i++) CREW_SPOTS.push(new THREE.Vector3(-1.0 + i*1.15, DECK, z + (i%2)*0.15));
for (const z of [-1.5, -0.4]) for (let i=0;i<4;i++) CREW_SPOTS.push(new THREE.Vector3(-5.3 - i*1.2, FORE, z));
for (let i=0;i<5;i++) CREW_SPOTS.push(new THREE.Vector3(11.9, QUARTER, -2.4 + i*1.2));
// Lobby: the crew stands centered on the beach, big for small groups and smaller as more pirates join.
const BEACH_C = new THREE.Vector3(SKULL_ISLE.x + 3.2, SAND_Y, SKULL_ISLE.z + 31);   // middle of the free space between the panels
const BEACH_W = 13;                                                                  // width the front row may use
function beachLayout(){
  const list = [...players.values()].sort((a, b) => a.joinN - b.joinN), n = list.length;
  const sc = n <= 3 ? 3.0 : n <= 6 ? 2.6 : n <= 10 ? 2.0 : n <= 18 ? 1.6 : n <= 28 ? 1.3 : 1.05;
  const gap = 1.3*sc + 0.35;
  const perMax = Math.max(1, Math.floor(BEACH_W / gap) + 1);
  const rows = Math.ceil(n / perMax), per = Math.ceil(n / Math.max(1, rows));
  const out = new Map();
  list.forEach((p, i) => {
    const r = Math.floor(i / per), c = i % per, inRow = Math.min(per, n - r*per);
    const rowGap = gap * (r % 2 ? 1 : 1);
    out.set(p, {pos:new THREE.Vector3(BEACH_C.x + (c - (inRow - 1)/2)*rowGap + (r % 2)*gap*0.5*(inRow === per ? 1 : 0), SAND_Y, BEACH_C.z - (rows > 1 ? 2 : 0) - r*(2.4*sc + 1.2)), scale:sc});
  });
  return out;
}
let beach = new Map();
const queueSlot = j => j < 4 ? new THREE.Vector3(0.6 - j*1.2, DECK, 2.3) : new THREE.Vector3(-5.0 - (j-4)*1.2, FORE, 1.5);
const rescueSpot = k => k < 6 ? new THREE.Vector3(8.0, QUARTER, -2.6 + k*1.05) : new THREE.Vector3(9.0, QUARTER, -2.0 + (k-6)*1.3);
function shuffle(a){ for (let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; } return a; }
function gauss(){ return (Math.random()+Math.random()+Math.random()+Math.random()-2)/1.15; }

/* ---------- Players (phones) ---------- */
const players = new Map();   // clientId -> player
const bySid = new Map();     // socket id -> clientId
let ready = false;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function cleanName(n){ return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14) || 'Pirate'; }
function freeSpot(){ const used = new Set([...players.values()].map(p => p.spot)); for (let i=0;i<CREW_SPOTS.length;i++) if (!used.has(i)) return i; return Math.floor(Math.random()*CREW_SPOTS.length); }
function spawnActor(p, drop=true){
  if (!ready) return;
  disposeActor(p.actor);
  const base = CHAR_BASES.includes(p.base) ? p.base : CHAR_BASES[0];
  p.actor = makeActor(base, {label:p.name, variant:variantFor(base, p.color)});
  if (!p.actor) return;
  p.where = null; placeActor(p);
  if (drop){ p.dropT = 0; play(p.actor, 'Jump'); }
  else p.dropT = 1;
}
// Lobby: the crew gathers on the Skull Island beach. In game: on the ship's deck.
function onBeach(){ const ph = playing ? seq[si] : null; return !ph || (ph.id === 'approach' && pt < 1.4); }
function spotOf(p){ if (onBeach()){ const b = beach.get(p); return b ? b.pos : BEACH_C; } return CREW_SPOTS[p.spot % CREW_SPOTS.length]; }
function placeActor(p){
  if (!p.actor) return;
  const where = onBeach() ? 'beach' : 'ship';
  if (p.where === where) return;
  p.where = where; (where === 'beach' ? scene : ship).add(p.actor.g);
  if (where === 'ship'){ p.actor.g.scale.setScalar(1); p.size = 1; const pl = p.actor.g.userData.plate; if (pl){ pl.scale.set(2.1, 0.42, 1); pl.position.y = 1.6*CHAR_S + 0.45; } }
  else { const b = beach.get(p); p.size = b ? b.scale : 2; p.actor.g.scale.setScalar(p.size); }
  p.actor.g.position.copy(spotOf(p)); p.beachPos = spotOf(p).clone();
  if (where === 'ship') burst(new THREE.Vector3(CREW_SPOTS[p.spot % CREW_SPOTS.length].x, DECK + 1, CREW_SPOTS[p.spot % CREW_SPOTS.length].z), 6, [0xffffff, 0xf0b43a], {confetti:true, spread:1, up:2, g:5, life:0.9});
}
function addPlayer(id, info, isBot=false){
  let p = players.get(id);
  const name = cleanName(info.name), base = CHAR_BASES.includes(info.base) ? info.base : CHAR_BASES[Math.floor(Math.random()*CHAR_BASES.length)];
  const color = Math.max(0, Math.min(VARIANTS.length - 1, Math.floor(+info.color || 0)));
  const isNew = !p;
  const voice = info.voice === 'f' || info.voice === 'm' ? info.voice : (base === 'anne' ? 'f' : 'm');
  if (!p){ p = {id, sid:null, bot:isBot, name, base, color, voice, connected:true, actor:null, spot:freeSpot(), joinN:++joinCounter, score:0, correct:0, answered:0, vote:null, voteT:0, awayT:0, picks:[]}; players.set(id, p); }
  const changed = p.name !== name || p.base !== base || p.color !== color;
  Object.assign(p, {name, base, color, voice, connected:true});
  beach = beachLayout();
  if (isNew || changed || !p.actor) { spawnActor(p, isNew); if (isNew && !isBot) setTimeout(() => sayAhoy(p), 500); }
  renderCrew();
  return p;
}
let joinCounter = 0;
// "Ahoy!" speech bubble over a pirate (one shared texture)
let bubbleTex = null;
function ahoyBubble(){
  if (!bubbleTex){
    const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d');
    x.fillStyle = '#fff8e6'; x.strokeStyle = '#2a160b'; x.lineWidth = 8;
    x.beginPath(); x.ellipse(128, 54, 116, 46, 0, 0, Math.PI*2); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(98, 94); x.lineTo(82, 124); x.lineTo(124, 98); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = '#fff8e6'; x.beginPath(); x.ellipse(128, 54, 110, 40, 0, 0, Math.PI*2); x.fill();
    x.fillStyle = '#c7342b'; x.font = '400 64px "Pirata One", Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('Ahoy!', 128, 56);
    bubbleTex = new THREE.CanvasTexture(c); bubbleTex.encoding = THREE.sRGBEncoding;
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({map:bubbleTex, depthTest:false, transparent:true}));
  s.scale.set(1.5, 0.75, 1); s.renderOrder = 21; s.visible = false; return s;
}
function sayAhoy(p){
  if (!p.actor) return;
  if (!p.actor.g.userData.bubble){ const b = ahoyBubble(); b.position.set(0.9, 1.6*CHAR_S + 1.15, 0); p.actor.g.add(b); p.actor.g.userData.bubble = b; }
  p.ahoyT = T; ahoy(p);
}
function removePlayer(p){ disposeActor(p.actor); players.delete(p.id); beach = beachLayout(); renderCrew(); }
function syncDemoCrew(){
  const humans = [...players.values()].filter(p => !p.bot).length;
  const wantBots = cfg.demo;
  for (const p of [...players.values()]) if (p.bot && (!wantBots || humans)) removePlayer(p);
  if (wantBots && !humans) DEMO_CREW.forEach((d, i) => { if (!players.has('bot' + i)) addPlayer('bot' + i, d, true); });
  renderCrew();
}
function renderCrew(){
  const list = [...players.values()];
  const humans = list.filter(p => !p.bot);
  $('crewCount').textContent = humans.length ? `${humans.length} aboard` : (list.length ? 'demo crew' : '0');
  $('crewEmpty').hidden = humans.length > 0;
  $('crewChips').innerHTML = list.map(p => `<span class="chip${p.connected ? '' : ' away'}" data-id="${esc(p.id)}"><i style="background:${CHIP_COLORS[p.color % CHIP_COLORS.length]}"></i>${esc(p.name)}${p.bot ? ' 🤖' : ''}${p.bot ? '' : '<button type="button" title="Remove" aria-label="Remove ' + esc(p.name) + '">×</button>'}</span>`).join('');
  $('hudCrew').textContent = `${humans.length || list.length} crew`;
  updateStartNote();
}
$('crewChips').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const id = b.closest('.chip').dataset.id, p = players.get(id); if (!p) return;
  if (p.sid) socket.emit('h:kick', {sid:p.sid});
  removePlayer(p);
});
function updateStartNote(){
  const humans = [...players.values()].filter(p => !p.bot).length;
  $('startNote').textContent = humans ? `${humans} pirate${humans === 1 ? '' : 's'} ready to vote from their phones.` : 'Waiting for the crew. With no phones, the demo crew votes.';
}

/* ---------- Network (Socket.IO relay on Render) ---------- */
const net = {server:'connecting'};
let roomCode = '', hostToken = '';
try { const saved = JSON.parse(sessionStorage.getItem('sharkbait-host') || 'null'); if (saved){ roomCode = saved.room || ''; hostToken = saved.token || ''; } } catch(e){}
const socket = io({transports:['polling','websocket'], reconnection:true, reconnectionDelay:700, reconnectionDelayMax:4000, timeout:15000});
function joinUrl(){ const u = new URL('play.html', location.href); u.search = '?room=' + encodeURIComponent(roomCode); return u.href; }
function updateJoinInfo(){
  $('roomCode').textContent = roomCode || '····';
  $('joinUrl').textContent = roomCode ? joinUrl().replace(/^https?:\/\//, '') : 'Connecting to the server…';
  if (!roomCode) return;
  try { const q = window.qrcode(0, 'M'); q.addData(joinUrl()); q.make(); $('qr').src = q.createDataURL(8, 2); } catch(e){ console.warn('QR failed', e); }
}
socket.on('connect', () => {
  socket.emit('h:create', {room:roomCode, token:hostToken}, res => {
    if (!res || !res.ok){ toast('The server could not open a room — retrying…'); setTimeout(() => socket.connected && socket.disconnect().connect(), 2000); return; }
    const changed = res.room !== roomCode || !$('qr').getAttribute('src');
    roomCode = res.room; hostToken = res.token;
    try { sessionStorage.setItem('sharkbait-host', JSON.stringify({room:roomCode, token:hostToken})); } catch(e){}
    if (changed) updateJoinInfo();
    if (net.wasDown) toast('Server connection restored');
    net.server = 'online';
  });
});
socket.on('disconnect', () => { net.server = 'reconnecting'; net.wasDown = true; toast('Connection to the server lost — reconnecting…'); });
socket.on('connect_error', () => { if (net.server !== 'online'){ net.server = 'reconnecting'; } });
socket.on('h:open', ({sid}) => { /* waits for the phone's join message */ });
socket.on('h:close', ({sid}) => {
  const id = bySid.get(sid); bySid.delete(sid);
  const p = id && players.get(id); if (!p || p.sid !== sid) return;
  p.connected = false; p.sid = null; p.awayT = performance.now(); renderCrew();
});
socket.on('h:d', ({sid, d}) => {
  if (!d || typeof d !== 'object') return;
  if (d.type === 'join'){
    const id = String(d.clientId || sid).slice(0, 80);
    if (players.size >= 40 && !players.has(id)) return send(sid, {type:'full'});
    syncBotsForHumans();
    const p = addPlayer(id, d);
    if (p.sid && p.sid !== sid) bySid.delete(p.sid);
    p.sid = sid; bySid.set(sid, id);
    send(sid, stateFor(p));
    renderCrew();
  } else if (d.type === 'vote'){
    const p = players.get(bySid.get(sid)); if (!p) return;
    const ph = seq[si];
    if (!playing || !ph || ph.id !== 'vote' || d.npc !== ph.npc) return;
    const pick = Math.floor(+d.pick); if (!(pick >= 0 && pick <= 2)) return;
    p.vote = pick; p.voteT = pt;
    send(sid, {type:'voted', pick});
  } else if (d.type === 'ahoy'){
    const p = players.get(bySid.get(sid)); if (!p) return;
    if (p.ahoyT != null && T - p.ahoyT < 2.5) return;          // one greeting every few seconds per pirate
    if (d.voice === 'f' || d.voice === 'm') p.voice = d.voice;
    sayAhoy(p);
  } else if (d.type === 'ping'){ /* keepalive */ }
});
function syncBotsForHumans(){ if (!cfg.demo) for (const p of [...players.values()]) if (p.bot) removePlayer(p); }
function send(sid, d){ if (sid && socket.connected) socket.emit('h:d', {sid, d}); }
function broadcast(d){ if (socket.connected) socket.emit('h:all', d); }
function publicState(){
  const ph = playing ? seq[si] : {id:'lobby'};
  const it = ph.npc != null ? round.items[ph.npc] : null;
  const base = {type:'state', phase:ph.id, level:cfg.level, idx:ph.npc != null ? ph.npc + 1 : 0, total:round ? round.items.length : 0};
  if (it){ base.npc = {name:it.who.name, role:it.who.role}; }
  if (it && ['sentences','vote'].includes(ph.id)) base.options = it.opts.map(o => o.s);
  if (ph.id === 'vote'){ base.npcIdx = ph.npc; base.endsIn = Math.max(0, (ph.dur - pt))*1000; }
  return base;
}
function stateFor(p){
  const s = publicState();
  s.you = {name:p.name, base:p.base, color:p.color, score:p.score, correct:p.correct, answered:p.answered};
  const ph = playing ? seq[si] : null;
  if (ph && ph.id === 'vote' && p.vote != null) s.yourPick = p.vote;
  if (ph && ph.id === 'verdict') Object.assign(s, verdictFor(p, ph.npc));
  if (ph && ph.id === 'summary') Object.assign(s, summaryFor(p));
  return s;
}
function pushState(){ for (const p of players.values()) if (p.sid && p.connected) send(p.sid, stateFor(p)); }

/* ---------- Round ---------- */
const REVEAL = 2.6;   // seconds the bar takes to show the result before the verdict
function buildRound(){
  if (round) round.npcs.forEach(n => { if (!n.corpsed) disposeActor(n.a); });
  const pool = shuffle(bankFor(cfg.level).slice()).slice(0, cfg.n);
  const people = shuffle(PRISONERS.slice());
  const items = pool.map(([lvl, row], i) => {
    const [topic, ok, w1, w2, y1, y2] = row;
    const opts = shuffle([{s:ok, ok:true, why:'✓ ' + topic}, {s:w1, ok:false, why:'✗ ' + y1}, {s:w2, ok:false, why:'✗ ' + y2}]);
    return {lvl, topic, opts, correct:opts.findIndex(o => o.ok), final:0, counts:[0,0,0], cast:0, who:people[i % people.length]};
  });
  // women prisoners are Anne, men are Henry, Mako or Sharky (skeletons are already dead!)
  const menBases = shuffle(['henry','mako','sharky']);
  const npcs = items.map((it, i) => {
    const base = it.who.g === 'f' ? 'anne' : menBases[i % menBases.length];
    const a = makeActor(base, {label:`${it.who.name} the ${it.who.role}`, labelColor:'#ffd7c9', unarmed:true, variant:variantFor(base, i + 3 + Math.floor(Math.random()*7))});
    ship.add(a.g);
    const pos = queueSlot(i); a.g.position.copy(pos); a.g.rotation.y = Math.PI/2;
    return {a, mode:'queue', pos, from:null, rescuedAt:null};
  });
  round = {items, npcs, results:[]};
  sharks.forEach(s => { s.mode = 'circle'; play(s.actor, 'Swim'); }); clearParts();
}
function sentencesDur(it){ return cfg.read ? Math.max(9, 2.2 + it.opts.reduce((a, o) => a + o.s.split(/\s+/).length*0.42 + 1.4, 0)) : 8; }
function buildSeq(){
  seq = [{id:'approach', dur:4.5}];
  if (cfg.cap) seq.push({id:'captain', dur:13});
  round.items.forEach((it, i) => seq.push({id:'walk', dur:4.8, npc:i}, {id:'sentences', dur:sentencesDur(it), npc:i}, {id:'vote', dur:cfg.t, npc:i}, {id:'verdict', dur:7.5 + REVEAL, npc:i}));
  seq.push({id:'summary', dur:Infinity});
}
function ease(t){ t = Math.min(1, Math.max(0, t)); return t*t*(3 - 2*t); }
function faceDir(obj, dx, dz){ if (Math.abs(dx) + Math.abs(dz) > 1e-4) obj.rotation.y = Math.atan2(dx, dz); }
function say(who, face, text){
  $('dialog').hidden = false; $('who').textContent = who; $('face').textContent = face; $('line').textContent = '';
  let k = 0; clearInterval(typer);
  typer = setInterval(() => { k += 2; $('line').textContent = text.slice(0, k); if (k >= text.length) clearInterval(typer); }, 36);
}
function buildCards(it){
  const box = $('cards'); box.innerHTML = '';
  it.opts.forEach((o, j) => {
    const c = document.createElement('article'); c.className = 'card parch';
    c.innerHTML = `<div class="tag"><b>${'ABC'[j]}</b><span class="share"></span></div><p></p><div class="why"></div>`;
    c.querySelector('p').textContent = o.s; c.querySelector('.why').textContent = o.why;
    box.appendChild(c);
  });
}
function renderHud(){
  $('hud').hidden = !playing; $('lobby').hidden = playing;
  if (!playing) return;
  $('hudLevel').textContent = cfg.level === 'MIX' ? 'Mixed' : cfg.level;
  const cur = seq[si] && seq[si].npc;
  $('track').innerHTML = round.items.map((_, i) => { const r = round.results[i]; return `<i class="${r === true ? 'sv' : r === false ? 'dd' : ''} ${i === cur ? 'cur' : ''}">${r === true ? '✓' : r === false ? '✕' : ''}</i>`; }).join('');
  const sv = round.results.filter(r => r === true).length, dd = round.results.filter(r => r === false).length;
  $('hudScore').textContent = `${sv} saved · ${dd} overboard`;
}
function hideAll(keep=[]){ ['meter','cards','dialog','summary','banner'].forEach(id => { if (!keep.includes(id)) $(id).hidden = true; }); clearInterval(typer); }
const voters = () => [...players.values()].filter(p => p.bot || (p.connected && p.sid));

function enter(){
  const ph = seq[si]; pt = 0; hush(); if (ph.id !== 'verdict') stopCaptain();
  const it = ph.npc != null ? round.items[ph.npc] : null;
  hideAll(ph.id === 'vote' || ph.id === 'verdict' ? ['cards'] : []);
  if (ph.id === 'captain'){
    const text = `Ahoy, crew! These landlubbers say they're innocent. Each one will tell three versions of their story, but only ONE is proper English. Vote wisely on yer phones! If at least ${cfg.pass}% of ye choose right, they live. If not... the sharks be hungry today!`;
    say('Captain Barbarossa', 'B', text); sfx.parrot();
    // the phase lasts as long as the captain talks: the first prisoner only walks out when he's done
    const voiceLen = captainLine('captain-intro', pickBuf('captain-intro'));
    if (voiceLen) ph.dur = Math.max(ph.dur, voiceLen + 1.2);
    else if (cfg.read && window.speechSynthesis){
      ph.dur = 60;   // generous until the browser voice reports it finished
      setTimeout(() => { if (seq[si] !== ph) return; const u = speak(text, {g:'m', rate:0.95, pitch:0.7}); if (u) u.onend = () => { if (seq[si] === ph) ph.dur = pt + 1; }; else ph.dur = 13; }, 600);
    }
  }
  if (ph.id === 'walk'){ const n = round.npcs[ph.npc]; n.mode = 'walk'; n.from = n.pos.clone(); say(`${it.who.name} the ${it.who.role}`, it.who.name[0], it.who.plea); speak(it.who.plea, {rate:1.02, g:it.who.g, pitch:(it.who.pitch || 1)*1.08}); if (Math.random() < 0.5) setTimeout(sfx.parrot, 2600); }
  if (ph.id === 'sentences'){
    buildCards(it); $('cards').hidden = false;
    const cards = [...$('cards').children];
    it.opts.forEach((o, j) => speak(`${'ABC'[j]}. ${o.s}`, {g:it.who.g, pitch:it.who.pitch || 1, onstart:() => { cards.forEach(c => c.classList.remove('speaking')); cards[j].classList.add('in', 'speaking'); }}));
  }
  if (ph.id === 'vote'){
    players.forEach(p => { p.vote = null; p.voteT = 0; p.botAt = p.bot ? 2 + Math.random()*(ph.dur*0.6) : 0; });
    $('meter').hidden = false; $('fill').style.width = '0%'; $('fill').classList.remove('pass'); $('fill').style.background = 'var(--gold)';
    $('mark').hidden = true; $('meterLabel').textContent = 'Vote on your phones!'; $('pct').textContent = '';
    $('meter').classList.remove('judging', 'doomed', 'spared'); $('danger').style.width = '0%';
    [...$('cards').children].forEach(c => c.classList.remove('speaking'));
    lastTick = -1; sfx.bell2();
  }
  if (ph.id === 'verdict') closeVote(ph);
  if (ph.id === 'summary') showSummary();
  renderHud(); pushState();
}
function closeVote(ph){
  const it = round.items[ph.npc], vs = voters();
  it.counts = [0,0,0]; it.cast = 0;
  vs.forEach(p => {
    p.picks[ph.npc] = p.vote;
    if (p.vote == null) return;
    it.counts[p.vote]++; it.cast++; p.answered++;
    if (p.vote === it.correct){ p.correct++; p.score += 100 + Math.round(50 * Math.max(0, 1 - p.voteT / Math.max(1, seq.find(s => s.id === 'vote' && s.npc === ph.npc).dur))); }
  });
  it.final = it.cast ? it.counts[it.correct] / it.cast : 0;
  const saved = it.final*100 >= cfg.pass;
  round.results[ph.npc] = saved;
  $('meter').hidden = false; $('mark').hidden = false; $('mark').style.left = cfg.pass + '%'; $('markLbl').textContent = cfg.pass + '%';
  $('meter').classList.add('judging'); $('meter').classList.remove('doomed', 'spared'); $('danger').style.width = cfg.pass + '%';
  $('meterLabel').textContent = 'Crew got it right'; $('fill').style.background = ''; $('fill').style.width = '0%';
  $('votes').textContent = `${it.cast} of ${vs.length} votes`; $('secs').textContent = '⚓'; $('clock').classList.remove('hurry'); $('ring').setAttribute('stroke-dashoffset', '0');
  const b = $('banner'); b.className = saved ? 'saved' : 'doom';
  b.innerHTML = saved ? `Saved!<small>${esc(it.who.name)} joins the crew · ${Math.round(it.final*100)}%</small>` : `☠ To the sharks! ☠<small>${Math.round(it.final*100)}% · needed ${cfg.pass}%</small>`;
}
function verdictFor(p, k){
  const it = round.items[k];
  return {correct:it.correct, saved:round.results[k], pct:Math.round(it.final*100), yourPick:p.vote, right:p.vote === it.correct, answer:it.opts[it.correct].s};
}
function summaryFor(p){
  const ranked = [...players.values()].sort((a, b) => b.score - a.score);
  return {rank:ranked.indexOf(p) + 1, of:ranked.length, saved:round.results.filter(Boolean).length, lost:round.results.filter(r => r === false).length,
    level:cfg.level, pass:cfg.pass,
    review:round.items.map((it, k) => ({who:`${it.who.name} the ${it.who.role}`, topic:it.topic, lvl:it.lvl, opts:it.opts.map(o => o.s), why:it.opts.map(o => o.why),
      correct:it.correct, pick:p.picks[k] == null ? null : p.picks[k], saved:round.results[k] === true, pct:Math.round(it.final*100)}))};
}
function showSummary(){
  const sv = round.results.filter(Boolean).length, n = round.items.length;
  const avg = round.items.reduce((a, it) => a + it.final, 0) / n;
  const ranked = [...players.values()].filter(p => p.answered).sort((a, b) => b.score - a.score).slice(0, 6);
  const box = $('summary'); box.hidden = false;
  box.innerHTML = `<h2>Round over</h2>
    <div class="big3">
      <div class="ok"><b>${sv}</b><span>Saved</span></div>
      <div class="bad"><b>${n - sv}</b><span>Overboard</span></div>
      <div class="${avg*100 >= cfg.pass ? 'ok' : 'bad'}"><b>${Math.round(avg*100)}%</b><span>Crew average</span></div>
    </div>
    <div><h3>Grammar on trial</h3><div class="topics">${round.items.map(it => `<div class="trow"><span class="lv">${it.lvl}</span><span>${esc(it.topic)}</span>
      <span class="v ${it.final*100 >= cfg.pass ? 'ok' : 'bad'}">${Math.round(it.final*100)}%</span></div>`).join('')}</div></div>
    <div><h3>Sharpest eyes on deck</h3><div class="board">${ranked.length ? ranked.map((p, i) => `<div class="trow"><span class="rk">${i+1}</span><span>${esc(p.name)}</span><span class="v">${p.score}</span></div>`).join('') : '<p class="note">No votes this round.</p>'}</div></div>
    <div class="sumfoot"><p class="note">Green: the crew's strengths. Red: topics to review in class.</p><span class="spacer"></span>
      <button class="btn big" id="again" type="button">Another round</button><button class="btn" id="back" type="button">Lobby</button></div>`;
  $('again').onclick = startGame; $('back').onclick = toLobby;
  if (chestMixer) openChest();
}
let chestMixer = null; function openChest(){}
function next(){ if (si < seq.length - 1){ si++; enter(); } }
function startGame(){
  if (!ready) return;
  unlockAudio();
  if (!players.size) { cfg.demo = true; syncDemoCrew(); cfg.demo = false; }
  players.forEach(p => { p.score = 0; p.correct = 0; p.answered = 0; p.vote = null; p.picks = []; });
  buildRound(); buildSeq(); si = 0; playing = true; music(); sea(cfg.snd); enter();
}
function toLobby(){
  playing = false; hush(); hideAll(); renderSettings(); music(); sea(cfg.snd);
  if (ready) buildRound();
  syncDemoCrew(); renderHud(); pushState();
}
$('start').addEventListener('click', startGame);
$('skip').addEventListener('click', next);
$('toLobby').addEventListener('click', toLobby);

/* ---------- Particles ---------- */
const parts = [];
function burst(pos, n, colors, opts){
  for (let i=0;i<n;i++){
    const geo = opts.confetti ? new THREE.PlaneGeometry(0.18, 0.11) : opts.drop ? new THREE.SphereGeometry(0.026, 6, 4) : new THREE.IcosahedronGeometry(0.13 + Math.random()*0.12, 0);
    const m = mesh(geo, B(colors[i % colors.length], {side:THREE.DoubleSide, transparent:true}), pos.x, pos.y, pos.z);
    const a = Math.random()*Math.PI*2, sp = opts.spread*(0.4 + Math.random()*0.6);
    const v = opts.drop ? opts.dir.clone().multiplyScalar(0.8 + Math.random()*0.7).setY(opts.up*(0.7 + Math.random()*0.6)) : new THREE.Vector3(Math.cos(a)*sp, opts.up*(0.6 + Math.random()*0.6), Math.sin(a)*sp);
    if (opts.drop) m.scale.set(1, 1.6, 1);
    m.userData = {v, life:opts.life, max:opts.life, g:opts.g, spin:opts.confetti ? Math.random()*8 : 0};
    scene.add(m); parts.push(m);
  }
  if (!opts.confetti && !opts.drop){
    const r = mesh(new THREE.RingGeometry(0.3, 0.6, 22), B(opts.ring || 0xffffff, {transparent:true, side:THREE.DoubleSide}), pos.x, 0.4, pos.z);
    r.rotation.x = -Math.PI/2; r.userData = {ring:true, life:1.4, max:1.4}; scene.add(r); parts.push(r);
  }
}
function clearParts(){ parts.forEach(p => { scene.remove(p); p.geometry.dispose(); p.material.dispose(); }); parts.length = 0; }
function updateParts(dt){
  for (let i=parts.length-1;i>=0;i--){
    const p = parts[i], u = p.userData; u.life -= dt;
    if (u.ring){ const k = 1 - u.life/u.max; p.scale.setScalar(1 + k*7); p.material.opacity = 1 - k; }
    else { u.v.y -= u.g*dt; p.position.addScaledVector(u.v, dt); p.rotation.x += u.spin*dt; p.rotation.y += u.spin*dt*0.7; p.material.opacity = Math.min(1, u.life/(u.max*0.4)); }
    if (u.life <= 0){ scene.remove(p); p.geometry.dispose(); p.material.dispose(); parts.splice(i,1); }
  }
}

/* ---------- Camera ---------- */
const camPos = new THREE.Vector3(30, 9, 46), camLook = new THREE.Vector3(-20, 18, -80);
const tPos = new THREE.Vector3(), tLook = new THREE.Vector3();
const HEAD = PLANK_END.y + 1.75;
let camOverride = null;
const LOBBY_CAM = [SKULL_ISLE.x + 4, 7.5, SKULL_ISLE.z + 58, SKULL_ISLE.x, 13, SKULL_ISLE.z - 4];
function camTarget(){
  if (camOverride){ tPos.set(...camOverride.slice(0, 3)); tLook.set(...camOverride.slice(3)); return 50; }
  const id = playing ? seq[si].id : 'lobby';
  const capHead = CAP_POS.y + 2.1;
  switch (id){
    case 'lobby': { const s = Math.sin(T*0.07); tPos.set(LOBBY_CAM[0] + s*1.5, LOBBY_CAM[1] + Math.sin(T*0.11)*0.4, LOBBY_CAM[2] - s); tLook.set(LOBBY_CAM[3], LOBBY_CAM[4], LOBBY_CAM[5]); return 1.6; }
    case 'summary': { const a = -0.9 + T*0.03; tPos.set(Math.cos(a)*52 + 1, 19, Math.sin(a)*52 + 3); tLook.set(0, 3.5, 1); return 2.2; }
    // from round two on, the camera arrives low over last round's floating bodies: a reminder of what's at stake
    case 'approach': if (corpses.length){ tPos.set(7, 6.8, 27); tLook.set(1.5, 1.2, 6); } else { tPos.set(0, 8.5, 21); tLook.set(2, 2.6, 0); } return 1.0;
    case 'captain': tPos.set(CAP_POS.x - 1.2, capHead + 0.9, CAP_POS.z + 5.6); tLook.set(CAP_POS.x - 0.3, capHead - 0.35, CAP_POS.z); return 1.5;
    case 'walk': tPos.set(-3.5, 7.5, 15.5); tLook.set(1, 2.2, 3.5); return 1.5;
    case 'sentences': tPos.set(PLANK_X + 2.4, HEAD + 1.0, 4.6); tLook.set(PLANK_X, HEAD - 0.2, PLANK_END.z); return 1.5;
    case 'vote': tPos.set(PLANK_X + 1.0, HEAD + 0.35, 5.3); tLook.set(PLANK_X, HEAD - 0.05, PLANK_END.z); return 0.9;
    case 'verdict': return pt < REVEAL ? (tPos.set(PLANK_X + 1.0, HEAD + 0.35, 5.0), tLook.set(PLANK_X, HEAD - 0.05, PLANK_END.z), 0.9) : (tPos.set(15, 8.5, 22), tLook.set(PLANK_X + 1, 1.5, 8.5), 1.7);
  }
  return 2;
}

/* ---------- Animation ---------- */
function pathPoint(points, k){
  const segs = []; let total = 0;
  for (let i=1;i<points.length;i++){ const d = points[i].distanceTo(points[i-1]); segs.push(d); total += d; }
  let d = k*total;
  for (let i=0;i<segs.length;i++){ if (d <= segs[i] || i === segs.length-1){ const f = segs[i] ? Math.min(1, d/segs[i]) : 1; return {p:points[i].clone().lerp(points[i+1], f), dir:points[i+1].clone().sub(points[i])}; } d -= segs[i]; }
}
function updateNPCs(dt){
  if (!round) return;
  const ph = playing ? seq[si] : {id:'lobby'};
  let qi = 0;
  const doomNow = ph.id === 'verdict' && round.results[ph.npc] === false && pt - REVEAL > 0.8 && pt - REVEAL < 6;
  round.npcs.forEach((n, i) => {
    if (n.corpsed) return;
    const a = n.a, g = a.g;
    g.rotation.z = 0; g.rotation.x = 0; g.visible = n.mode !== 'gone';
    if (g.userData.plate) g.userData.plate.visible = !(n.mode === 'plank' && ['sentences','vote','verdict'].includes(ph.id));
    const vt = ph.npc === i && ph.id === 'verdict' ? pt - REVEAL : 99;
    if (n.mode === 'queue'){
      const target = queueSlot(qi++);
      const moving = n.pos.distanceTo(target) > 0.08;
      n.pos.lerp(target, 1 - Math.exp(-dt*2.5));
      g.position.copy(n.pos); g.rotation.y = Math.PI/2;
      // the others in line watch their friend go to the sharks… and sweat
      play(a, moving ? 'Walk' : doomNow ? 'Duck' : 'Idle');
      if (doomNow && Math.random() < dt*5) sweat(g);
    } else if (n.mode === 'walk'){
      const k = ph.npc === i && ph.id === 'walk' ? ease(pt/(ph.dur*0.85)) : 1;
      const {p, dir} = pathPoint([n.from, new THREE.Vector3(PLANK_X, DECK, 2.3), PLANK_START, PLANK_END], k);
      n.pos.copy(p); g.position.copy(p); faceDir(g, dir.x, dir.z); play(a, k < 1 ? 'Walk' : 'Idle');
      if (k >= 1) n.mode = 'plank';
    } else if (n.mode === 'plank'){
      g.position.copy(PLANK_END); g.rotation.y = Math.PI;
      const fear = ph.id === 'vote' || (ph.id === 'verdict' && ph.npc === i) ? 1 : 0.3;
      g.rotation.z = Math.sin(T*28)*0.03*fear; g.position.x += Math.sin(T*31)*0.02*fear;
      play(a, fear === 1 ? 'No' : 'Idle');
      // nervous sweat: a little while they talk, buckets while the crew votes
      const rate = ph.id === 'vote' ? 9 + 8*(1 - Math.max(0, ph.dur - pt)/Math.max(1, ph.dur)) : ph.id === 'verdict' ? 12 : ph.id === 'sentences' ? 2.5 : 0;
      if (rate && Math.random() < dt*rate) sweat(g, 1 + (Math.random() < 0.3 ? 1 : 0));
      if (ph.id === 'verdict' && ph.npc === i && vt >= 0) n.mode = round.results[i] ? 'saving' : 'falling';
    } else if (n.mode === 'saving'){
      const t = vt < 99 ? vt : 99;
      const spot = rescueSpot(round.results.slice(0, i).filter(Boolean).length);
      const k = ease((t - 1.2)/3.2);
      const {p, dir} = pathPoint([PLANK_END, PLANK_START, new THREE.Vector3(5.8, DECK, 1.6), new THREE.Vector3(7.4, QUARTER, 0.9), spot], k);
      if (t < 1.2){ g.position.copy(PLANK_END); g.rotation.y = Math.PI; play(a, 'Jump'); }
      else { g.position.copy(p); faceDir(g, dir.x, dir.z); play(a, k < 1 ? 'Run' : 'Wave'); }
      if (!n.burst && t > 0.2){ n.burst = true; burst(new THREE.Vector3(PLANK_END.x, PLANK_END.y + 2.2, PLANK_END.z), 80, [0xf0b43a,0xe84a5f,0x3a86ff,0x8ac926,0xffffff], {confetti:true, spread:3, up:5, g:5, life:3}); sfx.fanfare(); setTimeout(() => { sfx.cheer(); captainLine('captain-saved'); }, 500); }
      if (k >= 1){ n.mode = 'rescued'; n.rescuedAt = spot.clone(); }
    } else if (n.mode === 'rescued'){
      g.position.copy(n.rescuedAt); g.rotation.y = -Math.PI/2 + 0.4;
      play(a, (Math.floor(T/3 + i) % 3 === 0) ? 'Wave' : 'Idle');
    } else if (n.mode === 'falling'){
      const t = vt;
      if (!n.doomed){ n.doomed = true; sfx.doom(); setTimeout(() => captainLine('captain-doom'), 400); }
      if (!n.screamed && t > 0.85){ n.screamed = true; sfx.scream(round.items[i].who.g === 'f'); }
      if (t < 1.0){ g.position.copy(PLANK_END); g.rotation.y = Math.PI; play(a, 'HitReact'); if (Math.random() < dt*14) sweat(g, 2); }
      else if (t < 1.85){ const f = (t - 1.0)/0.85; g.position.set(PLANK_X, PLANK_END.y + 0.7*f - 2.9*f*f, PLANK_END.z + 1.3*f); g.rotation.y = Math.PI; g.rotation.x = -f*2.0; play(a, 'Jump'); }
      else {
        if (!n.splashed){ n.splashed = true; sfx.splash(); burst(SPLASH, 40, [0xffffff, 0xbff6f8, 0x7fe0e6], {spread:2.6, up:6.5, g:14, life:1.4}); setTimeout(sfx.groan, 1100); }
        g.visible = false;
        // …and a moment later what's left of them bobs back up, and stays there
        if (t > 3.9){ makeCorpse(n, round.items[i].who, false); sfx.splash(); burst(new THREE.Vector3(SPLASH.x, 0.3, SPLASH.z + 0.6), 26, [0xffffff, 0xd01020, 0xbff6f8], {spread:1.4, up:3, g:12, life:1});
          setTimeout(() => { if (Math.random() < 0.7) shout('Squawk! Shark bait! Shark bait!', {g:'f', pitch:1.9, rate:1.3}); sfx.parrot(); }, 700); }
      }
      if (t > 1.6 && sharks[0] && sharks[0].mode !== 'leap' && !n.leapt){ n.leapt = true; sharks[0].mode = 'leap'; sharks[0].s = 0; play(sharks[0].actor, 'Swim_Fast'); }
    }
    // a phase skipped with "Skip" must not leave a prisoner stuck mid-animation
    if (ph.npc !== i && ph.npc != null && ph.npc > i){
      if (n.mode === 'walk' || n.mode === 'plank'){ if (round.results[i] === false) return makeCorpse(n, round.items[i].who, true); if (round.results[i]) n.mode = 'rescued'; }
      if (n.mode === 'saving'){ n.mode = 'rescued'; n.rescuedAt = rescueSpot(round.results.slice(0, i).filter(Boolean).length); }
      if (n.mode === 'falling' || (n.mode === 'gone' && round.results[i] === false)) return makeCorpse(n, round.items[i].who, true);
      if (n.mode === 'rescued' && !n.rescuedAt) n.rescuedAt = rescueSpot(round.results.slice(0, i).filter(Boolean).length);
    }
  });
}
function updateCrew(dt){
  const ph = playing ? seq[si] : {id:'lobby'};
  const vt = ph.id === 'verdict' ? pt - REVEAL : -9;
  const saved = ph.id === 'verdict' ? round.results[ph.npc] : null;
  for (const p of players.values()){
    const c = p.actor; if (!c) continue;
    placeActor(p);
    let spot = spotOf(p);
    if (p.where === 'beach'){
      // slide to the new place when pirates join or leave, and grow / shrink with the size of the crew
      const b = beach.get(p), want = b ? b.scale : 2;
      if (!p.beachPos) p.beachPos = spot.clone();
      p.beachPos.lerp(spot, 1 - Math.exp(-dt*3)); spot = p.beachPos;
      p.size += (want - p.size) * (1 - Math.exp(-dt*3)); c.g.scale.setScalar(p.size);
      const pl = c.g.userData.plate; if (pl){ const w = Math.min(4.4, 1.25*want + 1.5); pl.scale.set(w/p.size, w/p.size/5, 1); pl.position.y = 1.6*CHAR_S + 0.1 + 0.5/p.size; }
    }
    if (p.dropT < 1){ p.dropT = Math.min(1, p.dropT + dt*1.4); const k = p.dropT; c.g.position.set(spot.x, spot.y + 8*(1-k)*(1-k), spot.z); if (k >= 1){ burst(new THREE.Vector3(spot.x, spot.y + 0.3, spot.z), 26, [0xf0b43a,0xffffff,0x3a86ff], {confetti:true, spread:1.6*(p.size || 1), up:3, g:6, life:1.4}); } }
    else c.g.position.copy(spot);
    let anim = 'Idle';
    if (p.where === 'beach') anim = p.dropT < 1 ? 'Jump' : (Math.floor(T/4 + p.spot*0.7) % 5 === 0) ? 'Wave' : 'Idle';
    const greeting = p.ahoyT != null && T - p.ahoyT < 1.9;
    if (greeting) anim = 'Wave';
    if (c.g.userData.bubble) c.g.userData.bubble.visible = greeting;
    if (ph.id === 'vote' && p.vote != null) anim = 'Yes';
    if (ph.id === 'verdict' && vt > 0){ if (saved) anim = p.spot % 2 ? 'Yes' : 'Wave'; else anim = 'No'; }
    play(c, anim);
    const look = p.where === 'beach' ? 0.12 + Math.sin(p.joinN*1.7)*0.12 : (ph.id === 'captain' || ph.id === 'approach') ? 1.35 : 0.5;
    c.g.rotation.y += (look - c.g.rotation.y) * 0.08;
    c.g.traverse(o => { if (o.isSprite) o.material.opacity = p.connected ? 1 : 0.4; });
  }
  if (captain){
    const talking = ph.id === 'captain';
    let anim = 'Idle';
    if (talking) anim = pt < 2.2 ? 'Wave' : (Math.floor(pt/2.6) % 2 ? 'Sword' : 'Yes');
    if (ph.id === 'verdict' && vt > 0) anim = saved ? 'Yes' : (vt > 0.6 ? 'Sword' : 'Idle');
    play(captain, anim);
    const ry = talking ? 0.1 : ['sentences','vote','verdict','walk'].includes(ph.id) ? -0.85 : ph.id === 'lobby' ? 0.6 : -1.3;
    captain.g.rotation.y += (ry - captain.g.rotation.y) * 0.06;
    if (captain.g.userData.plate) captain.g.userData.plate.visible = !talking;
  }
}
function updateSharks(dt){
  sharks.forEach((u, i) => {
    if (u.mode === 'leap'){
      u.s += dt/1.4; const s = Math.min(1, u.s);
      const z0 = 15.8, z1 = 6.6, h = 4.2;
      u.pos.set(PLANK_X, -1.6 + h*4*s*(1-s), z0 + (z1 - z0)*s); u.g.position.copy(u.pos);
      u.yaw = Math.PI; u.g.rotation.set(0, Math.PI, 0);
      u.pitch.rotation.set(-Math.atan(h*4*(1-2*s)/(z0 - z1)), 0, 0);
      if (s > 0.3 && u.actor.cur !== 'Swim_Bite'){ play(u.actor, 'Swim_Bite'); sfx.bite(); chomp(); }
      if (!u.sp1 && s > 0.06){ u.sp1 = true; burst(new THREE.Vector3(PLANK_X, 0.2, z0 - 0.4), 30, [0xffffff,0xbff6f8], {spread:2, up:5, g:14, life:1.2}); }
      if (s >= 1){ u.mode = 'circle'; u.a = -Math.PI/2 - 0.6; u.sp1 = false; play(u.actor, 'Swim'); sfx.splash();
        burst(new THREE.Vector3(PLANK_X, 0.2, z1 + 0.3), 34, [0xffffff,0xbff6f8,0xd01020], {spread:2.2, up:5, g:14, life:1.3}); }
      return;
    }
    if (u.mode === 'frenzy'){
      // thrash around the splash: fins, bites and blood
      u.s += dt;
      const k = u.s*2.2 + i;
      u.target.set(SPLASH.x + Math.cos(k)*1.6, 0, SPLASH.z + 1.2 + Math.sin(k*1.3)*1.4);
      u.target.y = seaLevel(u.target.x, u.target.z, T) - 0.25 + Math.sin(u.s*9)*0.25;
      if (u.s > 3.2){ u.mode = 'circle'; play(u.actor, 'Swim'); }
    } else {
      u.a += dt*u.w;
      const x = SHARK_C.x + Math.cos(u.a)*u.r, z = SHARK_C.z + 0.8*i + Math.sin(u.a)*u.r*0.85;
      u.target.set(x, seaLevel(x, z, T) - 0.35, z);
    }
    const before = u.pos.clone();
    if (u.pos.lengthSq() === 0) u.pos.copy(u.target);
    u.pos.lerp(u.target, 1 - Math.exp(-dt*(u.mode === 'frenzy' ? 4 : 2.2)));
    const dx = u.pos.x - before.x, dz = u.pos.z - before.z;
    if (dx*dx + dz*dz > 1e-6){ const want = Math.atan2(dx, dz); let d = want - u.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); u.yaw += d*Math.min(1, dt*6); }
    u.g.position.copy(u.pos); u.g.rotation.set(0, u.yaw + (u.mode === 'frenzy' ? Math.sin(T*16 + i)*0.35 : 0), 0);
    u.pitch.rotation.set(0, 0, u.mode === 'frenzy' ? Math.sin(T*11 + i)*0.35 : -0.2*Math.sign(u.w));
  });
}
// The bite: blood fountain, a red stain on the sea, bubbles, and the other two sharks rush in
function chomp(){
  const at = new THREE.Vector3(PLANK_X, 0.6, SPLASH.z - 0.6);
  burst(at, 70, [0xb3000c, 0x7a0008, 0xe0182a, 0xff3b3b], {spread:2.8, up:7.5, g:13, life:1.7, ring:0xb3000c});
  setTimeout(() => burst(new THREE.Vector3(PLANK_X + 0.6, 0.4, SPLASH.z + 0.6), 40, [0xb3000c, 0x8e0010, 0xd8202c], {spread:2, up:5, g:12, life:1.4, ring:0x8e0010}), 450);
  bloodPool(SPLASH.x, SPLASH.z + 0.4, 3.6, 2.5);
  setTimeout(sfx.gurgle, 700);
  sharks.forEach((s, i) => { if (i && s.mode === 'circle'){ s.mode = 'frenzy'; s.s = 0; play(s.actor, i === 1 ? 'Swim_Bite' : 'Swim_Fast'); } });
}

/* ---------- Blood on the water (follows the waves) ---------- */
const pools = [];
let poolTex = null;
function poolTexture(){
  if (poolTex) return poolTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  for (let i=0;i<14;i++){
    const a = Math.random()*Math.PI*2, r = i ? 18 + Math.random()*30 : 0, cx = 64 + Math.cos(a)*r, cy = 64 + Math.sin(a)*r, rad = i ? 14 + Math.random()*20 : 46;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, 'rgba(150,0,10,0.95)'); g.addColorStop(0.6, 'rgba(120,0,8,0.6)'); g.addColorStop(1, 'rgba(110,0,8,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI*2); x.fill();
  }
  poolTex = new THREE.CanvasTexture(c); poolTex.encoding = THREE.sRGBEncoding; return poolTex;
}
function bloodPool(x, z, size, grow=2, follow=null){
  const geo = new THREE.PlaneGeometry(2, 2, 8, 8).rotateX(-Math.PI/2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({map:poolTexture(), transparent:true, depthWrite:false, opacity:0.9, fog:true}));
  m.renderOrder = 2; m.frustumCulled = false; scene.add(m);
  const p = {m, geo, base:Float32Array.from(geo.attributes.position.array), x, z, size, grow, t:0, follow, rot:Math.random()*6};
  pools.push(p);
  while (pools.length > 18){ const o = pools.shift(); scene.remove(o.m); o.geo.dispose(); o.m.material.dispose(); }
  return p;
}
function updatePools(dt){
  for (const p of pools){
    p.t += dt;
    if (p.follow){ p.x = p.follow.pos.x; p.z = p.follow.pos.z; }
    const s = p.size * Math.min(1, 0.25 + p.t/p.grow) * (p.follow ? 1 : 1 + Math.min(0.5, p.t*0.01));
    p.m.material.opacity = p.follow ? 0.75 : Math.max(0.42, 0.9 - p.t*0.02);
    const a = p.geo.attributes.position.array, c = Math.cos(p.rot), sn = Math.sin(p.rot);
    for (let i=0;i<a.length;i+=3){
      const bx = p.base[i]*s, bz = p.base[i+2]*s, wx = p.x + bx*c - bz*sn, wz = p.z + bx*sn + bz*c;
      a[i] = wx; a[i+2] = wz; a[i+1] = seaLevel(wx, wz, T) + 0.08;
    }
    p.geo.attributes.position.needsUpdate = true;
  }
}

/* ---------- Floating bodies: they stay in the water, round after round ---------- */
const corpses = [];
const CORPSE_SLOTS = [[0.6,12.4],[4.6,13.6],[-2.4,14.2],[7.4,11.8],[2.4,16.2],[-5.2,12.6],[9.4,15.2],[-0.8,17.6],[6.2,18.0],[-7.2,15.6],[11.2,12.4],[-3.6,19.0],[3.6,20.2],[11.6,18.2]];
let corpseN = 0;
function makeCorpse(n, who, instant){
  if (n.corpsed) return;
  n.corpsed = true; n.mode = 'gone';
  const a = n.a, g = a.g, slot = CORPSE_SLOTS[corpseN++ % CORPSE_SLOTS.length];
  ship.remove(g); scene.add(g); g.visible = true; g.rotation.set(0, 0, 0); g.scale.setScalar(1);
  if (g.userData.plate){ g.remove(g.userData.plate); g.userData.plate.material.map.dispose(); g.userData.plate.material.dispose(); }
  const pl = nameplate('☠ ' + who.name, '#ff9b8c'); pl.scale.set(1.7, 0.34, 1); pl.position.y = 1.15; g.add(pl); g.userData.plate = pl;
  a.mixer.stopAllAction(); a.cur = null; play(a, 'Death', 0); if (instant) a.mixer.update(5);
  const c = {a, pos:instant ? new THREE.Vector3(slot[0], 0, slot[1]) : new THREE.Vector3(SPLASH.x, 0, SPLASH.z + 0.6), to:new THREE.Vector3(slot[0], 0, slot[1]),
    sink:0.12, yaw:Math.random()*Math.PI*2, spin:(Math.random() - 0.5)*0.12, rise:instant ? 1 : 0, ph:Math.random()*6, name:who.name};
  corpses.push(c);
  c.pool = bloodPool(c.pos.x, c.pos.z, 1.5, 1.5, c);
  while (corpses.length > CORPSE_SLOTS.length){ const o = corpses.shift(); disposeActor(o.a); }
}
function updateCorpses(dt){
  const ph = playing ? seq[si] : {id:'lobby'};
  const hidePlates = ['captain','sentences','vote'].includes(ph.id) || (ph.id === 'verdict' && pt < REVEAL);
  for (const c of corpses){
    c.rise = Math.min(1, c.rise + dt*0.7);
    c.pos.lerp(c.to, 1 - Math.exp(-dt*0.35));
    c.yaw += c.spin*dt;
    const h = seaLevel(c.pos.x, c.pos.z, T);
    const g = c.a.g;
    g.position.set(c.pos.x, h - c.sink - (1 - c.rise)*1.6, c.pos.z);
    g.rotation.set(Math.sin(T*1.3 + c.ph)*0.08, c.yaw, Math.sin(T*1.1 + c.ph)*0.1);
    if (g.userData.plate) g.userData.plate.visible = !hidePlates && c.rise > 0.9;
  }
}
// drops of sweat flying off a scared prisoner's head
const _v = new THREE.Vector3();
function sweat(g, n=1){
  for (let i=0;i<n;i++){
    const side = Math.random() < 0.5 ? -1 : 1;
    g.localToWorld(_v.set(side*(0.22 + Math.random()*0.12), 1.75 + Math.random()*0.25, 0.12 + Math.random()*0.1));
    const o = g.localToWorld(new THREE.Vector3(0, 1.8, 0)), dir = _v.clone().sub(o).setY(0).normalize();
    burst(_v, 1, [0xd6f6ff, 0x9fe3ff], {drop:true, dir, spread:0, up:1.3, g:9, life:0.8});
  }
}

/* ---------- Vote meter + countdown ---------- */
let lastTick = -1;
const RING = 213.6;
function updateVote(){
  if (!playing) return;
  const ph = seq[si];
  if (ph.id === 'sentences' && !cfg.read) [...$('cards').children].forEach((c, j) => c.classList.toggle('in', pt > 0.4 + j*2.2));
  if (ph.id === 'sentences' && cfg.read) [...$('cards').children].forEach((c, j) => { if (pt > 1.5 + j*(ph.dur/3.2)) c.classList.add('in'); });
  if (ph.id === 'vote'){
    const vs = voters();
    vs.forEach(p => { if (p.bot && p.vote == null && pt >= p.botAt){ const it = round.items[ph.npc]; p.vote = Math.random() < LEVEL_MEAN[it.lvl] + gauss()*0.08 ? it.correct : [0,1,2].filter(x => x !== it.correct)[Math.floor(Math.random()*2)]; p.voteT = pt; } });
    const cast = vs.filter(p => p.vote != null).length;
    // everyone voted: close quickly
    if (vs.length && cast === vs.length && ph.dur - pt > 3) { ph.dur = pt + 3; pushState(); }
    const left = Math.max(0, ph.dur - pt), secs = Math.ceil(left);
    $('secs').textContent = secs;
    $('ring').setAttribute('stroke-dashoffset', (RING * (1 - left/cfg.t)).toFixed(1));
    $('clock').classList.toggle('hurry', left <= 5);
    if (left <= 5 && secs !== lastTick && secs > 0){ lastTick = secs; sfx.tick(secs === 1); countdown(secs); }
    $('fill').style.width = (vs.length ? cast/vs.length*100 : 0).toFixed(1) + '%';
    $('votes').textContent = `${cast} of ${vs.length} votes`;
  }
  if (ph.id === 'verdict'){
    const it = round.items[ph.npc], k = ease(pt/(REVEAL*0.85));
    const v = it.final*k + (k < 1 ? Math.sin(T*13)*0.03*(1-k) : 0);
    $('fill').style.width = (Math.max(0, v)*100).toFixed(1) + '%';
    $('fill').classList.toggle('pass', v*100 >= cfg.pass);
    $('pct').textContent = Math.round(Math.max(0, v)*100) + '%';
    // the skull rattles while the bar is in the red, and grins when the crew fails
    $('meter').classList.toggle('doomed', k >= 1 && it.final*100 < cfg.pass);
    $('meter').classList.toggle('spared', k >= 1 && it.final*100 >= cfg.pass);
    if (pt >= REVEAL && $('banner').hidden && !it.bannerShown){
      it.bannerShown = true; $('banner').hidden = false; $('meter').hidden = true;
      const cards = [...$('cards').children];
      cards.forEach((c, j) => { c.classList.add(j === it.correct ? 'right' : 'wrong'); c.querySelector('.share').textContent = `${it.counts[j]} vote${it.counts[j] === 1 ? '' : 's'}`; });
      sfx.parrot();
    }
  }
}

/* ---------- Loop ---------- */
let last = performance.now(), awayCheck = 0;
function update(dt){
  T += dt; pt += dt;
  if (playing && pt >= seq[si].dur) next();
  seaMat.uniforms.uTime.value = T;
  // ship rides the waves
  // the ship rocks with the swell; the water right at the hull is calm, so it only bobs a little
  const hb = waveHeight(-8, 0, T), hs = waveHeight(9, 0, T), hl = waveHeight(0, -3, T), hr = waveHeight(0, 3, T);
  ship.position.y = (hb + hs + hl + hr) * 0.25 * 0.3 - 0.05;
  ship.rotation.z = Math.atan2(hb - hs, 17) * 0.55;
  ship.rotation.x = Math.atan2(hr - hl, 6) * 0.3;
  if (navy){ navy.position.x = -200 + ((T*1.4) % 400); navy.position.y = -1.2 + waveHeight(navy.position.x, navy.position.z, T)*0.6; }
  updateFlag(T);
  mixers.forEach(m => m.update(dt));
  updateNPCs(dt); updateCrew(dt); updateSharks(dt); updateCorpses(dt); updatePools(dt); updateParts(dt); updateVote();
  const k = camTarget();
  camPos.lerp(tPos, 1 - Math.exp(-dt*k)); camLook.lerp(tLook, 1 - Math.exp(-dt*k*1.2));
  camera.position.copy(camPos); camera.lookAt(camLook);
  // drop phones that left the lobby long ago
  if ((awayCheck += dt) > 5){ awayCheck = 0; const now = performance.now();
    for (const p of [...players.values()]) if (!p.bot && !p.connected && !playing && now - p.awayT > 90000) removePlayer(p); }
}
function frame(now){
  update(Math.min(0.05, (now - last)/1000)); last = now;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
updateJoinInfo(); renderHud();
requestAnimationFrame(frame);
loadAll().then(() => {
  try { buildWorld(); } catch(e){ console.error(e); }
  ready = true; $('start').disabled = false; $('start').textContent = 'Set sail!';
  buildRound(); syncDemoCrew();
  for (const p of players.values()) if (!p.actor) spawnActor(p, false);
  window.__ready = true;
});
window.__debug = { go(id, n){ const i = seq.findIndex(s => s.id === id && (n == null || s.npc === n)); if (i >= 0){ si = i; enter(); } }, round:() => round, players:() => players,
  cam(a){ LOBBY_CAM.splice(0, 6, ...a); camPos.set(a[0], a[1], a[2]); camLook.set(a[3], a[4], a[5]); }, tick(sec){ for (let t=0; t<sec; t+=0.05) update(0.05); renderer.render(scene, camera); }, phase:() => seq[si] && seq[si].id, view(a){ camOverride = a; }, corpses:() => corpses.length, dur:() => seq[si] && seq[si].dur };
})();
