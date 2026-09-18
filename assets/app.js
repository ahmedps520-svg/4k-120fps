/* TikTok Upload Prep — runs entirely in the browser. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                 (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /* ════════════ QUESTION FLOW ════════════ */
  const QUESTIONS = [
    { id:'source', q:'What are you starting from?',
      why:'Sets the resolution to aim for and how much bitrate is worth spending.',
      opts:[
        {v:'4k120',   t:'4K at 120fps',    d:'High frame rate video mode'},
        {v:'4k60',    t:'4K at 60fps',     d:'The usual high quality setting'},
        {v:'1080120', t:'1080p at 120fps', d:'Slow-motion mode on most phones'},
        {v:'other',   t:'Something else',  d:'Screen recording, drone, older camera, downloaded clip'}
      ]},
    { id:'upload', q:'How will you upload?',
      why:'The app compresses your file before sending it. The web uploader does not.',
      opts:[
        {v:'ios-web',  t:'iPhone, using the desktop site in Safari', d:'Request Desktop Website on tiktok.com/upload'},
        {v:'ios-app',  t:'The TikTok app',                           d:'Convenient, but it re-compresses locally first'},
        {v:'computer', t:'An actual computer',                       d:'Same as the desktop site, with more tools available'}
      ]},
    { id:'motion', q:'Playback tops out at 60fps. What should your extra frames become?',
      why:'The most consequential choice for high frame rate footage. Deciding yourself beats letting the transcoder drop frames.',
      opts:[
        {v:'smooth60', t:'Normal speed, 60fps',   d:'Half the frames discarded evenly. No judder, audio unchanged.'},
        {v:'slow2x',   t:'Half speed slow motion', d:'Every frame used, spread over twice the time. Audio removed.'},
        {v:'slow4x',   t:'Quarter speed slow motion', d:'Every frame used at 30fps. Audio removed.'},
        {v:'cine30',   t:'Normal speed, 30fps',   d:'Film-like cadence, smallest file, most bitrate per frame.'}
      ]},
    { id:'length', q:'How long is the clip?',
      why:'Length times bitrate is file size, and an upload that fails on size helps nobody.',
      opts:[
        {v:'short', t:'Under a minute', d:'Spend bitrate freely'},
        {v:'mid',   t:'One to three minutes', d:'Slightly leaner'},
        {v:'long',  t:'Over three minutes', d:'Noticeably leaner so the upload completes'}
      ]},
    { id:'priority', q:'If something has to give, what matters more?',
      why:'Sets the quality against file size trade-off.',
      opts:[
        {v:'quality', t:'Detail',  d:'Larger file, slower upload, sharpest result'},
        {v:'balance', t:'A balance', d:'The sensible default'},
        {v:'speed',   t:'Getting it posted', d:'Smaller file, quicker upload'}
      ]}
  ];

  const answers = { upload: IS_IOS ? 'ios-web' : undefined };
  let step = 0;

  function renderStep() {
    if (step >= QUESTIONS.length) return renderDone();
    const Q = QUESTIONS[step];
    $('flowCount').textContent = `Question ${step + 1} of ${QUESTIONS.length}`;
    $('flowStep').innerHTML =
      `<p class="flow-q">${Q.q}</p><p class="flow-why">${Q.why}</p><div class="opts">` +
      Q.opts.map(o => `<button class="opt${answers[Q.id] === o.v ? ' is-picked' : ''}" data-v="${o.v}" type="button">
          <b>${o.t}</b><small>${o.d}</small></button>`).join('') + `</div>`;
    $('flowStep').querySelectorAll('.opt').forEach(b =>
      b.addEventListener('click', () => { answers[Q.id] = b.dataset.v; step++; renderStep(); refresh(); }));
    $('flowBack').disabled = step === 0;
    $('flowResult').hidden = step < QUESTIONS.length;
  }

  function renderDone() {
    $('flowCount').textContent = 'All five answered';
    const picked = QUESTIONS.map(Q => {
      const o = Q.opts.find(o => o.v === answers[Q.id]);
      return `<dt>${Q.id === 'source' ? 'Source' : Q.id === 'upload' ? 'Upload via' :
                    Q.id === 'motion' ? 'Motion' : Q.id === 'length' ? 'Length' : 'Priority'}</dt><dd>${o ? o.t : '—'}</dd>`;
    }).join('');
    $('flowStep').innerHTML = `<div class="answers"><dl>${picked}</dl></div>`;
    $('flowBack').disabled = false;
    $('flowResult').hidden = false;
  }

  $('flowBack').addEventListener('click', () => { if (step > 0) { step--; renderStep(); } });
  $('flowRestart').addEventListener('click', () => {
    Object.keys(answers).forEach(k => delete answers[k]);
    if (IS_IOS) answers.upload = 'ios-web';
    step = 0; renderStep(); refresh();
  });

  /* ════════════ SPEC ENGINE ════════════ */
  function spec() {
    const a = Object.assign({ source:'4k120', upload: IS_IOS ? 'ios-web' : 'computer',
                              motion:'smooth60', length:'short', priority:'balance' }, answers);
    const src4k = a.source === '4k120' || a.source === '4k60';
    const fourK = src4k && a.upload !== 'ios-app';
    const w = fourK ? 2160 : 1080, h = fourK ? 3840 : 1920;

    let fps, ptsMul = 1, dropAudio = false, motionText, changesRate;
    switch (a.motion) {
      case 'slow2x': fps = 60; ptsMul = 2; dropAudio = true; motionText = 'half speed at 60fps'; break;
      case 'slow4x': fps = 30; ptsMul = 4; dropAudio = true; motionText = 'quarter speed at 30fps'; break;
      case 'cine30': fps = 30; motionText = 'normal speed at 30fps'; break;
      default:       fps = 60; motionText = 'normal speed at 60fps';
    }
    const srcFps = (a.source === '4k120' || a.source === '1080120') ? 120 : (a.source === '4k60' ? 60 : null);
    changesRate = srcFps !== null && ptsMul === 1 && srcFps !== fps;

    let mbps = (fourK ? 45 : 18) * (fps >= 60 ? 1 : 0.75);
    if (a.priority === 'quality') mbps *= 1.35;
    if (a.priority === 'speed')   mbps *= 0.7;
    if (a.length === 'mid')  mbps *= 0.85;
    if (a.length === 'long') mbps *= 0.65;
    mbps = Math.round(mbps);

    const crf = a.priority === 'quality' ? 16 : a.priority === 'speed' ? 20 : 18;
    const preset = a.priority === 'quality' ? 'slow' : a.priority === 'speed' ? 'fast' : 'medium';

    return { a, w, h, fps, ptsMul, dropAudio, mbps, crf, preset, keyint: fps * 2,
             fourK, motionText, srcFps, changesRate };
  }

  function planLines(s) {
    const out = [];
    out.push(`<b>${s.w} &times; ${s.h}</b> — ${s.fourK
      ? 'full 4K vertical. Viewers get 1080p, but the encoder has more to work from, so the result holds detail better.'
      : s.a.upload === 'ios-app'
        ? 'the app downscales a 4K file locally before sending it anyway, and does it worse than a clean 1080p export would.'
        : '1080p vertical, matching the delivery canvas exactly.'}`);
    out.push(`<b>${s.motionText}</b> — ${s.ptsMul > 1
      ? `all of your frames are used, spread over ${s.ptsMul} times the duration. Audio is removed, because slowing it makes it unusable.`
      : s.a.motion === 'cine30'
        ? 'frames reduced evenly, which leaves the most bitrate for each one that remains.'
        : 'frames reduced evenly by half. No judder, and audio stays in sync.'}`);
    out.push(`<b>H.264, about ${s.mbps} Mbps</b> — high enough that TikTok's encoder is the only thing softening the picture, low enough that the upload finishes.`);
    out.push(`<b>Keyframe every two seconds, index at the front, Rec.709 colour</b> — unremarkable settings that prevent washed-out colour and slow starts.`);
    if (s.a.upload === 'ios-app') {
      out.push(`<b>Worth reconsidering:</b> uploading through the app compresses your file on the phone before it is sent, and TikTok compresses it again afterwards. Using the desktop site in Safari removes one of those two steps at no cost. Step 4 explains how.`);
    }
    if (s.changesRate) {
      out.push(`<b>Frame rate has to change</b> from ${s.srcFps} to ${s.fps}. The Shortcuts method cannot do this in most iOS builds — use method B, or accept that TikTok will do the conversion itself.`);
    }
    return out;
  }

  /* ════════════ SHORTCUTS INSTRUCTIONS ════════════ */
  function shortcutSteps(s) {
    const sizeLabel = s.fourK ? '3840 × 2160 (4K)' : '1920 × 1080 (1080p)';
    const speed = s.ptsMul > 1 ? `${(1 / s.ptsMul).toFixed(2).replace(/0$/, '')}× (slower)` : 'Normal';
    const li = [];
    li.push(`Open <b>Shortcuts</b>, tap <span class="kv">+</span> to create a new shortcut.`);
    li.push(`Add the action <span class="kv">Select Photos</span>. Open its options and turn on <span class="kv">Include Videos</span>. (<span class="kv">Select File</span> works too if your clip is in Files.)`);
    li.push(`Add <span class="kv">Encode Media</span> below it, then tap the arrow to expand its settings.`);
    li.push(`Set <span class="kv">Format</span> to <b>H.264</b>. Not HEVC — it is a better codec, but it is the one most likely to cause a colour shift or a rejected upload, and any advantage disappears when TikTok re-encodes anyway.`);
    li.push(`Set <span class="kv">Size</span> to <b>${sizeLabel}</b>, or the nearest option your build offers at or below that.`);
    if (s.ptsMul > 1) {
      li.push(`Set <span class="kv">Speed</span> to <b>${speed}</b>. This is what turns your extra frames into slow motion.`);
      li.push(`Audio will be slowed with the video and will sound wrong. Either mute the clip before encoding, or plan to add a sound on TikTok.`);
    } else {
      li.push(`Leave <span class="kv">Speed</span> at <b>Normal</b>.`);
    }
    if (s.changesRate) {
      li.push(`<b>Frame rate:</b> if your build shows a frame rate option, set it to <b>${s.fps}fps</b>. Most builds do not. If yours does not, this method will leave the clip at ${s.srcFps}fps — which still uploads fine, it just means TikTok chooses how to drop the frames rather than you. Method B does it precisely.`);
    }
    li.push(`Add <span class="kv">Save File</span> last, and turn on <span class="kv">Ask Where To Save</span> so you can find it again.`);
    li.push(`Name the shortcut and run it. Pick your clip, wait for it to finish, and save it somewhere obvious such as <span class="kv">On My iPhone</span>. Then go to step 4.`);
    return li;
  }

  /* ════════════ FFMPEG COMMANDS ════════════ */
  function buildCmd(kind) {
    const s = spec();
    const vf = [
      s.ptsMul > 1 ? `setpts=${s.ptsMul.toFixed(1)}*PTS` : null,
      `scale=${s.w}:${s.h}:force_original_aspect_ratio=decrease:flags=lanczos`,
      `pad=${s.w}:${s.h}:(ow-iw)/2:(oh-ih)/2:color=black`,
      'format=yuv420p'
    ].filter(Boolean).join(',');
    const audio = s.dropAudio ? '-an' : '-c:a aac -b:a 320k -ar 48000 -ac 2';
    const color = '-color_primaries bt709 -color_trc bt709 -colorspace bt709';

    if (kind === 'mac') return [
      `ffmpeg -i input.mov \\`, `  -vf "${vf}" -r ${s.fps} \\`,
      `  -c:v h264_videotoolbox -profile:v high -b:v ${s.mbps}M -maxrate ${Math.round(s.mbps*1.2)}M -bufsize ${s.mbps*2}M \\`,
      `  -g ${s.keyint} -tag:v avc1 ${color} \\`, `  ${audio} -movflags +faststart \\`, `  tiktok-ready.mp4`].join('\n');
    if (kind === 'nvidia') return [
      `ffmpeg -i input.mov \\`, `  -vf "${vf}" -r ${s.fps} \\`,
      `  -c:v h264_nvenc -preset p7 -tune hq -profile:v high -rc vbr -cq ${s.crf} \\`,
      `  -b:v ${s.mbps}M -maxrate ${Math.round(s.mbps*1.3)}M -bufsize ${s.mbps*2}M \\`,
      `  -g ${s.keyint} -bf 3 ${color} \\`, `  ${audio} -movflags +faststart \\`, `  tiktok-ready.mp4`].join('\n');
    if (kind === 'editor') return [
      `Format .............. H.264 / MP4  (not HEVC, not ProRes)`,
      `Resolution .......... ${s.w} x ${s.h}  (vertical)`,
      `Frame rate .......... ${s.fps} fps, constant - not variable, not "match source"`,
      `Profile / Level ..... High / 5.2`,
      `Bitrate ............. VBR 2-pass, target ${s.mbps} Mbps, max ${Math.round(s.mbps*1.3)} Mbps`,
      `Keyframe every ...... ${s.keyint} frames (two seconds)`,
      `Colour space ........ Rec. 709`,
      `Audio ............... ${s.dropAudio ? 'none (slow motion)' : 'AAC 320 kbps, 48 kHz, stereo'}`,
      `Also enable ......... fast start / web optimised`,
      `Avoid ............... any "upload to social" preset; they downscale and cap bitrate`].join('\n');
    return [
      `ffmpeg -i input.mov \\`, `  -vf "${vf}" -r ${s.fps} \\`,
      `  -c:v libx264 -profile:v high -level 5.2 -preset ${s.preset} -crf ${s.crf} \\`,
      `  -maxrate ${s.mbps}M -bufsize ${s.mbps*2}M \\`,
      `  -x264-params "keyint=${s.keyint}:min-keyint=${s.fps}:scenecut=0:bframes=3:ref=4" \\`,
      `  ${color} \\`, `  ${audio} -movflags +faststart \\`, `  tiktok-ready.mp4`].join('\n');
  }
  const NOTES = {
    cpu:'Best quality per megabyte, slowest. Install with <code>brew install ffmpeg</code>, <code>winget install ffmpeg</code> or <code>sudo apt install ffmpeg</code>.',
    mac:'Uses the hardware encoder on Apple silicon. Much faster, very slightly softer at the same bitrate.',
    nvidia:'Uses NVENC on your GPU. <code>p7</code> is its highest quality preset; drop to <code>p5</code> if it is too slow.',
    editor:'Set these fields by hand in the export dialog. Constant frame rate and the keyframe interval are the two most often left wrong.'
  };
  let currentTab = 'cpu';
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('is-active'));
    t.classList.add('is-active'); currentTab = t.dataset.tab; refresh();
  }));
  $('copyBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('cmd').textContent); $('copyBtn').textContent = 'Copied'; }
    catch { $('copyBtn').textContent = 'Select manually'; }
    setTimeout(() => { $('copyBtn').textContent = 'Copy'; }, 1600);
  });

  /* ════════════ REFRESH EVERYTHING ════════════ */
  function refresh() {
    const s = spec();
    $('plan').innerHTML = planLines(s).map(p => `<li>${p}</li>`).join('');
    $('specTable').innerHTML = [
      ['Resolution', `${s.w} × ${s.h}`], ['Frame rate', `${s.fps} fps, constant`],
      ['Timing', s.motionText], ['Video codec', 'H.264 High profile'],
      ['Bitrate', `about ${s.mbps} Mbps`], ['Audio', s.dropAudio ? 'removed' : 'AAC 320 kbps'],
      ['Keyframes', `every ${s.keyint} frames`]
    ].map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
    $('shortcutSteps').innerHTML = shortcutSteps(s).map(t => `<li>${t}</li>`).join('');
    $('cmd').textContent = buildCmd(currentTab);
    $('cmdNote').innerHTML = NOTES[currentTab];
  }

  /* ════════════ ANALYZER ════════════ */
  const drop = $('drop'), fileInput = $('fileInput'), probe = $('probe');
  let chosen = null;

  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleFile(f); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

  const fmtBytes = b => b >= 1e9 ? (b/1e9).toFixed(2)+' GB' : b >= 1e6 ? (b/1e6).toFixed(1)+' MB' : (b/1e3).toFixed(0)+' KB';
  const fmtTime = s => !isFinite(s) ? '—' : (Math.floor(s/60) ? `${Math.floor(s/60)}m ${(s%60).toFixed(1)}s` : `${s.toFixed(1)}s`);

  async function handleFile(file) {
    chosen = file;
    $('analysis').hidden = false;
    $('fileTable').innerHTML = `<tr><th>Status</th><td>reading…</td></tr>`;
    $('checks').innerHTML = '';
    const url = URL.createObjectURL(file);
    probe.src = url;

    const meta = await new Promise(res => {
      probe.onloadedmetadata = () => res({ w: probe.videoWidth, h: probe.videoHeight, dur: probe.duration });
      probe.onerror = () => res(null);
      setTimeout(() => res(probe.videoWidth ? { w: probe.videoWidth, h: probe.videoHeight, dur: probe.duration } : null), 8000);
    });

    if (!meta || !meta.w) {
      $('fileTable').innerHTML = `<tr><th>Status</th><td>could not be read here</td></tr>
        <tr><th>File size</th><td>${fmtBytes(file.size)}</td></tr>`;
      $('checks').innerHTML = `<li class="warn"><span class="lbl">note</span><b>This browser cannot decode the file</b>
        <span class="txt">Usually ProRes, or HEVC in a MOV wrapper. It does not mean the file is bad, only that
        the preview cannot open it. The Shortcuts method will still handle it.</span></li>`;
      URL.revokeObjectURL(url);
      updateConvertButton();
      return;
    }

    const fps = await measureFps();
    const mbps = meta.dur ? (file.size * 8) / meta.dur / 1e6 : 0;
    const d = { file, ...meta, fps, mbps };

    $('fileTable').innerHTML = [
      ['Resolution', `${meta.w} × ${meta.h}`], ['Frame rate', fps ? `${fps} fps` : 'not measurable here'],
      ['Duration', fmtTime(meta.dur)], ['File size', fmtBytes(file.size)],
      ['Average bitrate', mbps ? mbps.toFixed(1) + ' Mbps' : '—'],
      ['Aspect ratio', (meta.w/meta.h).toFixed(3)]
    ].map(([k,v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');

    renderChecks(d);
    URL.revokeObjectURL(url);
    updateConvertButton();
  }

  function measureFps() {
    return new Promise(res => {
      if (!probe.requestVideoFrameCallback) return res(null);
      const times = []; let done = false;
      const stop = v => { if (!done) { done = true; probe.pause(); res(v); } };
      const onFrame = (_n, m) => {
        times.push(m.mediaTime);
        if (times.length >= 40) {
          const deltas = [];
          for (let i = 1; i < times.length; i++) { const dd = times[i] - times[i-1]; if (dd > 0.0005) deltas.push(dd); }
          if (!deltas.length) return stop(null);
          deltas.sort((a,b) => a-b);
          const raw = 1 / deltas[Math.floor(deltas.length/2)];
          const std = [23.976,24,25,29.97,30,48,50,59.94,60,100,119.88,120,240];
          const near = std.find(x => Math.abs(x-raw)/x < 0.06);
          return stop(near ? Math.round(near*100)/100 : Math.round(raw*10)/10);
        }
        probe.requestVideoFrameCallback(onFrame);
      };
      probe.muted = true;
      probe.requestVideoFrameCallback(onFrame);
      probe.play().catch(() => stop(null));
      setTimeout(() => stop(null), 6000);
    });
  }

  function renderChecks(d) {
    const out = [];
    const add = (lvl, title, text) => out.push(
      `<li class="${lvl}"><span class="lbl">${lvl === 'ok' ? 'good' : lvl === 'warn' ? 'check' : 'problem'}</span><b>${title}</b><span class="txt">${text}</span></li>`);
    const ar = d.w / d.h;

    if (Math.abs(ar - 9/16) < 0.02) add('ok','Vertical 9:16','Fills the screen with no bars and nothing cropped.');
    else if (ar > 1) add('bad','This is a landscape video',
      `At ${d.w} × ${d.h} it will be shown in a thin band or cropped at the sides. Reframe it vertically if you can. The settings here pad rather than crop, so nothing is lost, but a real reframe looks better.`);
    else add('warn','Vertical, but not 9:16',
      `${d.w} × ${d.h} works, it just will not fill the frame. Exporting at 1080 × 1920 or 2160 × 3840 fits exactly.`);

    if (d.h >= 3840 || d.w >= 2160) add('ok','4K source','Viewers receive 1080p, but the extra source detail makes that 1080p noticeably sharper.');
    else if (d.h >= 1920) add('ok','1080p source','Matches the delivery canvas exactly. Nothing wrong with this.');
    else add('bad','Below 1080p',`${d.w} × ${d.h} is under the delivery resolution, so it will be upscaled and look soft whatever settings you use.`);

    if (d.fps === null) add('warn','Frame rate not measurable here','This browser does not expose per-frame timing. Set the frame rate explicitly rather than using "match source".');
    else if (d.fps > 65) add('warn',`${d.fps} fps, above what playback shows`,'Converting this deliberately gives a better and more predictable result than letting the transcoder decide. Question 3 picks how.');
    else if (d.fps >= 29) add('ok',`${d.fps} fps`,'Within range; timing passes through unchanged.');
    else add('warn',`${d.fps} fps is low`,'Motion will look choppy next to 30 and 60fps clips in the feed.');

    const px = d.w * d.h, expect = px >= 2160*3840 ? 35 : px >= 1080*1920 ? 12 : 5;
    if (d.mbps >= expect) add('ok',`${d.mbps.toFixed(1)} Mbps source bitrate`,'Healthy for this resolution. Plenty for the encoder to work from.');
    else if (d.mbps >= expect*0.5) add('warn',`${d.mbps.toFixed(1)} Mbps is lowish`,
      `Around ${expect} Mbps is where bitrate stops being the limiting factor at this resolution. This file has most likely been compressed once already.`);
    else add('bad',`${d.mbps.toFixed(1)} Mbps, already heavily compressed`,
      'Detail has already been discarded and re-encoding cannot bring it back. Go back to the original camera file if it still exists. Everything here still helps, but only with what is left.');

    if (d.file.size > 2e9) add('warn','Large file','Some uploads fail on size. Lower the bitrate before lowering the resolution — it is the cheaper thing to give up.');
    $('checks').innerHTML = out.join('');
  }

  /* ════════════ CONVERTER ════════════ */
  const convertBtn = $('convertBtn'), convStatus = $('convStatus'),
        convBar = $('convBar'), convDownload = $('convDownload'), convBadge = $('convBadge'), capLine = $('capLine');
  let caps = null, lastUrl = null;

  const setStatus = (m, isErr) => { convStatus.textContent = m; convStatus.classList.toggle('err', !!isErr); };
  const setProgress = p => { convBar.hidden = false; convBar.firstElementChild.style.width = (p*100).toFixed(1) + '%'; };

  async function checkCaps() {
    const s = spec();
    try { caps = await window.NoSquishTranscode.probe(s.w, s.h); }
    catch { caps = { webcodecs:false, encode:false, decodeH264:false, decodeHEVC:false }; }
    const yes = t => `<span class="yes">${t}</span>`, no = t => `<span class="no">${t}</span>`;
    if (!caps.webcodecs) {
      convBadge.textContent = 'Not available here';
      capLine.innerHTML = no('This browser has no video encoding API.') + ' Use method A.';
    } else if (!caps.encode) {
      convBadge.textContent = 'No encoder';
      capLine.innerHTML = no('Video encoding API present, but no H.264 encoder.') + ' Use method A.';
    } else {
      convBadge.textContent = 'Available';
      capLine.innerHTML = yes('Encoder ready') + ` · H.264 decode ${caps.decodeH264 ? yes('yes') : no('no')}` +
                          ` · HEVC decode ${caps.decodeHEVC ? yes('yes') : no('no')}`;
    }
    updateConvertButton();
  }

  function updateConvertButton() {
    if (!caps || !caps.encode) { convertBtn.disabled = true; convertBtn.textContent = 'Not supported in this browser'; return; }
    if (!chosen) { convertBtn.disabled = true; convertBtn.textContent = 'Choose a file in step 2 first'; return; }
    convertBtn.disabled = false; convertBtn.textContent = 'Convert';
  }

  convertBtn.addEventListener('click', async () => {
    if (!chosen) return;
    const s = spec();
    convertBtn.disabled = true; convertBtn.textContent = 'Working…';
    convDownload.hidden = true; setProgress(0);
    if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }

    if (chosen.size > 1.5e9) setStatus('This is a large file. If the tab reloads, it ran out of memory — trim the clip in Photos first, or use method A.');

    try {
      const res = await window.NoSquishTranscode.transcode(chosen, {
        width: s.w, height: s.h, fps: s.fps, ptsMul: s.ptsMul,
        bitrate: s.mbps * 1e6, dropAudio: s.dropAudio
      }, { onProgress: setProgress, onLog: m => setStatus(m) });

      lastUrl = URL.createObjectURL(res.blob);
      convDownload.href = lastUrl;
      convDownload.download = `tiktok-${s.w}x${s.h}-${s.fps}fps.mp4`;
      convDownload.hidden = false;
      setStatus(`Done — ${res.frames} frames, ${fmtBytes(res.blob.size)}.` +
        (res.droppedAudio ? ' Audio could not be copied and was left out.' : '') +
        ' Tap Save the file, then pick a location you can find again in step 4.');
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      setStatus('Did not finish: ' + msg + ' — method A above uses the system encoder and does not have this limitation.', true);
      convBar.hidden = true;
    } finally {
      convertBtn.disabled = false; convertBtn.textContent = 'Convert';
      updateConvertButton();
    }
  });

  /* ════════════ BOOT ════════════ */
  renderStep();
  refresh();
  checkCaps();
})();
