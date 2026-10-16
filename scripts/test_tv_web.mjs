// Product regression only: TV web preview + synthetic protocol, never device/camera evidence.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startDevServer } from './dev_server.mjs';

if (process.env.CONDA_DEFAULT_ENV !== 'amazon-tv') throw new Error('Activate amazon-tv before running TV web smoke');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.env.CONDA_PREFIX, 'playwright-browsers');
const { chromium } = await import('playwright');

let url = process.env.JABTEMPO_TV_WEB_URL;
const output = path.resolve(process.env.JABTEMPO_TV_WEB_OUTPUT || 'results/tv-web');
const report = { startedUtc: new Date().toISOString(), setup: 'TV web preview / synthetic protocol phone',
  viewport: { width: 1920, height: 1080 }, url, nativeVerified: false, sensorAccuracyVerified: false,
  latencyGatePass: false, status: 'FAIL', screens: [], keyboardActions: [], errors: [] };
let browser;
let page;
let server;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const screen = name => page.getByTestId(`screen-${name}`);

async function key(value) {
  report.keyboardActions.push(value);
  await page.keyboard.press(value);
  await page.waitForTimeout(70);
}

async function focused() {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element.getAttribute('role') !== 'button') return null;
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    let clipped=false;
    for(let parent=element.parentElement;parent;parent=parent.parentElement){
      const style=getComputedStyle(parent),clip=parent.getBoundingClientRect();
      if(/hidden|auto|scroll/.test(style.overflowY)&&(bounds.top<clip.top-3||bounds.bottom>clip.bottom+3))clipped=true;
      if(/hidden|auto|scroll/.test(style.overflowX)&&(bounds.left<clip.left-3||bounds.right>clip.right+3))clipped=true;
    }
    return { label: element.getAttribute('aria-label') || element.textContent?.trim(),
      clipped,
      border: style.borderColor, borderWidth: parseFloat(style.borderTopWidth),
      outlineWidth: parseFloat(style.outlineWidth), background: style.backgroundColor,
      left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom,
      width: bounds.width, height: bounds.height };
  });
}

async function focusCheck() {
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'button', null, { timeout: 5000 });
  const current = await focused();
  assert(current.width > 0 && current.height > 0, 'Focused button has no visible bounds');
  assert(!current.clipped,`Focused button clipped by its container: ${current.label}`);
  assert(current.left >= 0 && current.top >= 0 && current.right <= 1921 && current.bottom <= 1081,
    `Focused button off screen: ${current.label}`);
  // The shared product uses a high-contrast white border and cyan fill for focus.
  const distinctiveBorder = current.borderWidth >= 3 && /255, 255, 255|243, 246, 252/.test(current.border);
  assert(distinctiveBorder || current.outlineWidth >= 3, `Focus indicator missing: ${current.label}`);
  return current;
}

async function select(label) {
  const buttons = await page.getByRole('button').evaluateAll(items => items.map(item => {
    const box = item.getBoundingClientRect();
    return { label: item.getAttribute('aria-label') || item.textContent?.trim(),
      x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }));
  const target = buttons.find(button => button.label === label);
  assert(target, `Missing button: ${label}`);
  // Geometry-driven navigation uses only real key events; no click/focus or state mutation.
  const visited = new Set();
  for (let attempt = 0; attempt < buttons.length * 8 + 8; attempt++) {
    const active = await focusCheck();
    if (active.label === label) { await key('Enter'); return; }
    const x = (active.left + active.right) / 2;
    const y = (active.top + active.bottom) / 2;
    const primary = Math.abs(target.y - y) > 24 ? (target.y > y ? 'ArrowDown' : 'ArrowUp')
      : (target.x > x ? 'ArrowRight' : 'ArrowLeft');
    const edge = `${active.label}:${primary}`;
    if (visited.has(edge)) await key(['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'][attempt % 4]);
    else { visited.add(edge); await key(primary); }
  }
  throw new Error(`Keyboard dead end reaching ${label}`);
}

async function capture(name) {
  await screen(name).waitFor({ state: 'visible', timeout: 10000 });
  const focus = await focusCheck();
  const screenshot = path.join(output, `${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: false });
  const clipped = await screen(name).evaluate(root => {
    const problems = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (!text || node.parentElement.closest('[data-testid^="note-"]')) continue; // Moving notes are intentionally stage-clipped.
      const range = document.createRange(); range.selectNodeContents(node);
      const bounds = range.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      // DOM ranges include unused font ascent/descent. Check painted glyph bounds so
      // clipping empty font space (e.g. Barlow's ascent) does not become a false failure.
      const font = getComputedStyle(node.parentElement);
      const context = document.createElement('canvas').getContext('2d');
      context.font = `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
      const metrics = context.measureText(text);
      const inkTop = bounds.top + Math.max(0, metrics.fontBoundingBoxAscent - metrics.actualBoundingBoxAscent);
      const inkBottom = bounds.bottom - Math.max(0, metrics.fontBoundingBoxDescent - metrics.actualBoundingBoxDescent);
      let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
      for (let parent = node.parentElement; parent && parent !== root.parentElement; parent = parent.parentElement) {
        const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
        if (/(hidden|auto|scroll)/.test(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right, box.right); }
        if (/(hidden|auto|scroll)/.test(style.overflowY)) { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
      }
      if (bounds.left < left - 3 || bounds.right > right + 3 || inkTop < top - 3 || inkBottom > bottom + 3)
        problems.push({ text: text.slice(0, 90), bounds: { left: bounds.left, top: inkTop, right: bounds.right, bottom: inkBottom },
          clip: { left, top, right, bottom } });
    }
    return problems;
  });
  report.screens.push({ screen: name, label: 'TV web preview', screenshot, focus, clippedText: clipped });
  assert(clipped.length === 0, `Clipped text on ${name}: ${JSON.stringify(clipped)}`);
}

async function homeByBack() {
  await key('Backspace');
  await screen('Home').waitFor({ state: 'visible', timeout: 5000 });
  await focusCheck();
}

async function connectSyntheticPhone() {
  const code = (await page.getByTestId('pair-code').innerText()).trim();
  assert(/^\d{4}$/.test(code), 'Relay pairing code unavailable');
  await page.evaluate(async pairCode => {
    const endpoint = new URL('/bridge', location.href); endpoint.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(endpoint);
    const state = { ws, paired: false, sent: new Set(), sequence: 0, timer: null, guards: [], error: null,
      frames: 0, events: 0 };
    // This test-only phone emits protocol data. It never changes TV application state directly.
    window.__jabtempoSyntheticPhone = state;
    const send = message => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ v: 1, ...message }));
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.action === 'paired') state.paired = true;
      if (message.action === 'error' || message.action === 'reject') state.error = message.action;
      if (message.type === 'ping') {
        const t1 = performance.now(); send({ type: 'pong', t0: message.t0, t1, t2: performance.now() });
      }
    };
    await new Promise((resolve, reject) => {
      ws.onopen = () => { send({ type: 'hello', deviceId: 'synthetic-tv-web-regression', pairCode,
        model: 'synthetic protocol / no camera', players: 1 }); resolve(); };
      ws.onerror = () => reject(new Error('Synthetic phone WebSocket failed'));
      setTimeout(() => reject(new Error('Synthetic phone connection timed out')), 5000);
    });
    state.timer = setInterval(() => {
      const clock = window.__jabtempoReadOnly?.();
      if (!clock || !Number.isFinite(clock.songTime) || !Number.isFinite(clock.audioClockReceipt)) return;
      const now = performance.now();
      // Synthetic quantized COCO17 packet supplies a real protocol watermark, not sensor evidence.
      send({ type: 'frame', t: now, players: [{ id: 1, kp: Array.from({ length: 51 }, (_, i) => i % 3 === 2 ? 10000 : 5000) }] });
      send({ type: 'quality', t: now, framing: state.trackingLost ? 0 : 1, light: 1, issues: [] });
      state.frames++;
      // A misdated packet must not consume every future note as a miss.
      if(clock.screen==='Round'&&clock.songTime>12000&&!state.futureFrameSent){
        state.futureFrameSent=true;
        send({ type: 'quality', t: now+60000, framing: 1, light: 1, issues: [] });
      }
      if (clock.paused) return;
      const step = 60000 / clock.bpm;
      const index = Math.floor(clock.songTime / step);
      if (!['Calibrate', 'Round'].includes(clock.screen)) return;
      // Deliberately skip alternate calibration beats: eight consecutive hits must not be required.
      const due = clock.screen === 'Calibrate'
        ? (index >= 4 && index <= 18 && index % 2 === 0 ? [{ id: `calibration-${index}`, timeMs: index * step, type: index < 12 ? 'jab' : 'cross', hand: index < 12 ? 'left' : 'right' }] : [])
        : (clock.notes || []).filter(note => note.timeMs <= clock.songTime && clock.songTime - note.timeMs < 150);
      for (const note of due) {
        if (clock.screen === 'Round' && note.timeMs >= 20000 && note.timeMs < 26000) continue; // Deliberate misses while the chart and audio continue.
        const id = `${clock.screen}:${note.id}`;
        if (state.sent.has(id)) continue;
        const peak = clock.audioClockReceipt + (note.timeMs - clock.songTime)/(clock.rate||1);
        if (peak < 0) continue;
        state.sent.add(id);
        const wrong=clock.screen==='Round'&&!state.wrongHandSent;if(wrong)state.wrongHandSent=true;
        const physical=note.hand || (note.type==='cross'?'right':'left');
        send({ type: 'event', t_peak: peak, player: 1, kind: note.type,
          hand: wrong?(physical==='left'?'right':'left'):physical, extension: 0.85, conf: 1 });
        state.events++;
        state.guards.push(setTimeout(() => send({ type: 'guard', t: performance.now(), player: 1, state: 'up', conf: 1 }), 100));
      }
    }, 67);
  }, code);
  await page.waitForFunction(() => window.__jabtempoSyntheticPhone?.paired === true, null, { timeout: 5000 });
  // Let actual TV ping/pong synchronization establish an offset before calibration.
  await page.waitForTimeout(2300);
}

try {
  if (!url) {
    assert(!process.env.JABTEMPO_TLS_PFX, 'Isolated TV smoke requires no LAN TLS configuration');
    server = await startDevServer({ root: path.resolve('.'), host: '127.0.0.1', port: 0 });
    url = `${server.baseUrl}/tv-web/`;
  }
  report.url = url;
  const target = new URL(url);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Smoke target must be a local dev server');
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: 'chromium', headless: true, chromiumSandbox: true });
  page = await browser.newPage({ viewport: report.viewport });
  await page.route('**/*', route => {
    const request = new URL(route.request().url());
    if (request.origin === target.origin) return route.continue();
    report.errors.push(`Unexpected external request: ${request.origin}`);
    return route.abort();
  });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(300);
  if(await screen('HowToPlay').isVisible())await homeByBack();
  await capture('Home');
  for (const [label, name] of [['Settings', 'Settings'], ['How to play', 'HowToPlay'], ['Daily challenge', 'Daily']]) {
    await select(label); await capture(name);
    if(name==='Settings'){
      for(const [before,after] of [['Beginner','workout'],['Workout','pro'],['Pro','kids'],['Kids','beginner']]){
        await select(`Preset: ${before}`);
        assert((await page.evaluate(()=>window.__jabtempoReadOnly().preset))===after,`Preset picker did not select ${after}`);
      }
      for(const [before,after] of [[1,3],[3,5],[5,1]]){
        await select(`Session: ${before} min`);
        assert((await page.evaluate(()=>window.__jabtempoReadOnly().sessionMinutes))===after,`Session picker did not select ${after} minutes`);
      }
      report.sessionSetup={allFourPresetsSelectable:true,oneThreeFiveMinutesSelectable:true,defaultRoundMinutes:1};
    }
    await homeByBack();
  }
  await select('Family Challenge'); await capture('Family'); await homeByBack();
  await select('Play'); await capture('Pair');
  await connectSyntheticPhone();
  await select('Practice both hands');
  await screen('HowToPlay').waitFor({state:'visible'});
  const practice=async hand=>page.evaluate(hand=>window.__jabtempoSyntheticPhone.ws.send(JSON.stringify({v:1,type:'event',t_peak:performance.now(),player:1,kind:hand==='left'?'jab':'cross',hand,extension:.85,conf:1})),hand);
  await practice('right');await page.waitForTimeout(100);
  assert((await page.evaluate(()=>window.__jabtempoReadOnly().tutorialHand))==='left','Wrong hand incorrectly completed left practice');
  await page.screenshot({path:path.join(output,'Tutorial-wrong-hand.png')});
  await practice('left');await page.waitForFunction(()=>window.__jabtempoReadOnly().tutorialHand==='right');
  await practice('right');await page.waitForFunction(()=>window.__jabtempoReadOnly().tutorialDone);
  await page.screenshot({path:path.join(output,'Tutorial-ready.png')});
  await select('Calibrate both hands'); await capture('Calibrate');
  await select('Start calibration');
  await page.screenshot({path:path.join(output,'Calibrate-count-in.png')});
  await page.waitForFunction(()=>window.__jabtempoReadOnly?.().calibrationCount>=1,null,{timeout:10000});
  await page.screenshot({path:path.join(output,'Calibrate-live.png')});
  await page.waitForFunction(() => {
    const clock = window.__jabtempoReadOnly?.();
    return clock && clock.calibrationCount === 8 && Number.isFinite(clock.offset);
  }, null, { timeout: 20000 });
  await select('Start round'); await capture('Round');
  await page.waitForFunction(()=>window.__jabtempoReadOnly().wrongHand,null,{timeout:10000});
  await page.screenshot({path:path.join(output,'Wrong-hand.png')});
  await page.waitForTimeout(4500);
  await key('Backspace');
  assert(await screen('Round').isVisible(), 'Back ended the round instead of pausing');
  await page.waitForFunction(() => window.__jabtempoReadOnly?.().paused === true);
  const pausedTime = await page.evaluate(() => window.__jabtempoReadOnly().songTime);
  await page.waitForTimeout(350);
  const laterTime = await page.evaluate(() => window.__jabtempoReadOnly().songTime);
  assert(Math.abs(laterTime - pausedTime) < 100, 'Audio clock progressed while paused');
  await select('Resume');
  await page.waitForFunction(()=>window.__jabtempoReadOnly().resumeCount>0);
  const countdownStart=await page.evaluate(()=>window.__jabtempoReadOnly());
  await page.waitForTimeout(700);
  const countdownLater=await page.evaluate(()=>window.__jabtempoReadOnly());
  assert(countdownLater.paused&&Math.abs(countdownLater.songTime-countdownStart.songTime)<100&&countdownLater.score===countdownStart.score,'Countdown advanced audio or score');
  assert(countdownLater.activeMs===countdownStart.activeMs,'Countdown incorrectly counted as active minutes');
  await page.waitForFunction(()=>!window.__jabtempoReadOnly().paused,null,{timeout:6000});
  await page.evaluate(()=>window.__jabtempoSyntheticPhone.trackingLost=true);
  await page.waitForFunction(()=>window.__jabtempoReadOnly().paused,null,{timeout:5000});
  const lost=await page.evaluate(()=>window.__jabtempoReadOnly());
  await page.screenshot({path:path.join(output,'Tracking-recovery.png')});
  await page.waitForTimeout(350);
  const frozen=await page.evaluate(()=>window.__jabtempoReadOnly());
  assert(lost.score===frozen.score&&Math.abs(lost.songTime-frozen.songTime)<100,'Tracking-loss pause advanced score/audio');
  await page.evaluate(()=>window.__jabtempoSyntheticPhone.trackingLost=false);
  await page.waitForFunction(()=>window.__jabtempoReadOnly().trackingReady);
  await select('Resume');
  await page.waitForFunction(()=>!window.__jabtempoReadOnly().paused,null,{timeout:6000});
  report.recovery={backPauses:true,trackingLossPauses:true,countdownSeconds:3,scoreAndClockFrozen:true};
  const beforeTempo=await page.evaluate(()=>window.__jabtempoReadOnly());
  await select('Harder');
  await page.waitForFunction(()=>window.__jabtempoReadOnly().bpm===130);
  await page.waitForTimeout(500);
  const afterTempo=await page.evaluate(()=>window.__jabtempoReadOnly());
  assert(afterTempo.songTime>beforeTempo.songTime&&afterTempo.songTime-beforeTempo.songTime<3000,'Tempo change reset or jumped track position');
  assert(afterTempo.score>=beforeTempo.score,'Tempo change reset score');
  report.liveTempo={before:beforeTempo.bpm,after:afterTempo.bpm,rate:afterTempo.rate,positionPreserved:true};
  await select('Easier');await page.waitForFunction(()=>window.__jabtempoReadOnly().bpm===110);
  await page.waitForFunction(() => {
    const clock = window.__jabtempoReadOnly?.();
    return clock && clock.score > 0 && clock.judgmentsCount > 0;
  }, null, { timeout: 10000 });
  await page.screenshot({ path: path.join(output, 'Round-live.png'), fullPage: false });
  const visibleNote = async (atMs,label) => {
    await page.waitForFunction(target => window.__jabtempoReadOnly?.().songTime >= target, atMs, {timeout:60000});
    await page.waitForFunction(() => {
      const stage=document.querySelector('[data-testid="round-stage"]');
      const notes=[...document.querySelectorAll('[data-testid^="note-"]')];
      if(!stage||!notes.length)return false;
      const box=stage.getBoundingClientRect();
      return notes.some(note=>{const noteBox=note.getBoundingClientRect();return noteBox.top>=box.top-2&&noteBox.bottom<=box.bottom+2&&noteBox.left>=box.left-2&&noteBox.right<=box.right+2;});
    },null,{timeout:4000});
    await page.screenshot({path:path.join(output,`Round-${label}.png`),fullPage:false});
    return await page.evaluate(()=>{
      const stage=document.querySelector('[data-testid="round-stage"]').getBoundingClientRect();
      const divider=document.querySelector('[data-testid="hand-divider"]').getBoundingClientRect();
      const line=document.querySelector('[data-testid="hit-line"]').getBoundingClientRect();
      const notes=[...document.querySelectorAll('[data-testid^="note-"]')];
      return {time:window.__jabtempoReadOnly().songTime,judgments:window.__jabtempoReadOnly().judgmentsCount,
        noteCount:notes.length,split:Math.abs(divider.left-(stage.left+stage.width/2))<5,
        horizontalHitLine:line.width>stage.width*.85&&line.height<10,
        correctSides:notes.every(note=>{const box=note.getBoundingClientRect();return note.dataset.testid==='note-left'?box.right<divider.left:box.left>divider.right;})};
    });
  };
  const beforeMiss=await visibleNote(21000,'miss-segment');
  const afterMiss=await visibleNote(29000,'after-miss');
  const lateRound=await visibleNote(51000,'late-round');
  assert(afterMiss.judgments>beforeMiss.judgments,'Missed notes were not judged while audio continued');
  assert([beforeMiss,afterMiss,lateRound].every(sample=>sample.split&&sample.horizontalHitLine&&sample.correctSides),'Vertical split or glove side regressed');
  assert(beforeMiss.judgments<(await page.evaluate(()=>window.__jabtempoReadOnly().notes.length))/2,'A future-dated camera packet consumed the chart');
  report.noteContinuity={beforeMiss,afterMiss,lateRound,fullyVisible:true,futureFrameInjected:await page.evaluate(()=>window.__jabtempoSyntheticPhone.futureFrameSent)};
  // Let the audio progress callback end the complete 60-second round naturally.
  await screen('Summary').waitFor({ state: 'visible', timeout: 75000 });
  await capture('Summary');
  report.syntheticPhone = await page.evaluate(() => ({ frames: window.__jabtempoSyntheticPhone.frames,
    events: window.__jabtempoSyntheticPhone.events }));
  report.round = await page.evaluate(() => {
    const { songTime, score, combo, judgmentsCount, calibrationCount, offset,activeMs,detectedPunches,roundDurationMs } = window.__jabtempoReadOnly();
    return { songTime, score, combo, judgmentsCount, calibrationCount, offset,activeMs,detectedPunches,roundDurationMs };
  });
  assert(report.round.songTime >= 60000, 'Round ended before the full 60-second audio timeline');
  assert(report.round.detectedPunches>0&&report.round.detectedPunches<=report.syntheticPhone.events,'Detected punch count does not match delivered synthetic events');
  assert(report.round.activeMs>50000&&report.round.activeMs<61000,'Active minutes counted pause or detector drain time');
  await select('Home'); await screen('Home').waitFor({ state: 'visible' }); await focusCheck();
  await select('Settings');await select('Session: 1 min');await homeByBack();
  await select('Family Challenge');
  const pickerNames=await page.evaluate(()=>window.__jabtempoReadOnly().familyNames);
  await select(`Player 1: ${pickerNames[0]}`);
  const named=await page.evaluate(()=>window.__jabtempoReadOnly().familyNames);
  assert(named[0]!==named[1]&&named[0]!==pickerNames[0],'D-pad name picker did not choose distinct names');
  await select('Start family challenge');await select('Continue to calibration');
  await page.evaluate(()=>window.__jabtempoSyntheticPhone.sent.clear());
  await select('Start round');
  assert((await page.evaluate(()=>window.__jabtempoReadOnly().roundDurationMs))===180000,'Family round did not apply the chosen three-minute duration');
  const familyChart=await page.evaluate(()=>JSON.stringify(window.__jabtempoReadOnly().notes));
  await page.waitForFunction(()=>window.__jabtempoReadOnly().score>0,null,{timeout:10000});await select('Finish round');await focusCheck();
  await page.evaluate(()=>window.__jabtempoSyntheticPhone.sent.clear());
  await select('Next player');
  assert((await page.evaluate(()=>JSON.stringify(window.__jabtempoReadOnly().notes)))===familyChart,'Family players did not receive the same chart');
  await page.waitForFunction(()=>window.__jabtempoReadOnly().score>0,null,{timeout:10000});await select('Finish round');await focusCheck();
  const results=await page.evaluate(()=>window.__jabtempoReadOnly().familyResults);
  assert(results.length===2&&results[0].name===named[0]&&results[1].name===named[1],'Family results lost player names or turn order');
  assert(results.every(result=>result.score>0),'Family scoring did not receive real synthetic protocol hits in each turn');
  await page.screenshot({path:path.join(output,'Family-summary.png')});
  report.family={names:named,turns:2,sameChart:true,roundMinutes:3,earlyEndedRegression:true};
  await select('Home');
  assert(report.screens.length === 9, 'Not all nine screens visited');
  assert(report.errors.length === 0, `Browser errors: ${report.errors.join('; ')}`);
  report.status = 'PASS';
} catch (error) {
  report.errors.push(error.message);
  console.error(`TV web smoke FAIL: ${error.message}`);
  process.exitCode = 1;
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
} finally {
  if (page) await page.evaluate(() => {
    const phone = window.__jabtempoSyntheticPhone;
    if (phone) { clearInterval(phone.timer); phone.guards.forEach(clearTimeout); phone.ws.close(); delete window.__jabtempoSyntheticPhone; }
  }).catch(() => {});
  await browser?.close();
  await server?.close();
  report.finishedUtc = new Date().toISOString();
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.status}: ${report.setup}; ${report.screens.length}/9 screens. ${path.join(output, 'report.json')}`);
}
