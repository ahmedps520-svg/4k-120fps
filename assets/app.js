/* NoSquish — TikTok upload prep. All client-side, no backend. */
(() => {
  'use strict';

  /* ══════════════════════════════════════════════════════
     QUESTION FLOW
     ══════════════════════════════════════════════════════ */
  const QUESTIONS = [
    {
      id: 'source',
      q: 'What are you starting from?',
      why: 'Decides the resolution we target and how much bitrate headroom is worth spending.',
      opts: [
        { v: '4k120',   t: '4K at 120fps',        d: 'iPhone Pro / Android flagship / mirrorless high-frame-rate mode' },
        { v: '4k60',    t: '4K at 60fps',         d: 'The most common high-quality phone setting' },
        { v: '1080120', t: '1080p at 120fps',     d: 'Slow-motion mode on most phones' },
        { v: 'other',   t: 'Something else',      d: 'Screen recording, drone, game capture, older camera' }
      ]
    },
    {
      id: 'upload',
      q: 'Where will you upload from?',
      why: 'The web uploader accepts far bigger, higher-bitrate files. The phone app re-compresses before it even sends.',
      opts: [
        { v: 'desktop', t: 'Desktop browser',   d: 'tiktok.com/upload — strongly recommended' },
        { v: 'iphone',  t: 'iPhone app',        d: 'Convenient, but the app squeezes the file first' },
        { v: 'android', t: 'Android app',       d: 'Same problem, usually worse' }
      ]
    },
    {
      id: 'motion',
      q: 'TikTok plays back at 60fps maximum. What should your extra frames become?',
      why: 'This is the single most important choice for 120fps footage. Make it yourself instead of letting the transcoder throw frames away.',
      opts: [
        { v: 'smooth60', t: 'Real-time, silky smooth',  d: 'Conform to 60fps — clean 2:1 frame drop, no judder, audio untouched' },
        { v: 'slow2x',   t: 'Half speed slow motion',   d: '120fps stretched to 60fps — every frame used, 2× slower, audio removed' },
        { v: 'slow4x',   t: 'Quarter speed slow motion', d: '120fps stretched to 30fps — dreamy 4× slow, audio removed' },
        { v: 'cine30',   t: 'Cinematic 30fps',          d: 'Film-like cadence, smallest file, most bitrate per frame' }
      ]
    },
    {
      id: 'edit',
      q: 'Will you add anything inside the TikTok app?',
      why: 'Every in-app edit forces a second generation of encoding on top of the unavoidable one.',
      opts: [
        { v: 'none',  t: 'Nothing — the file is final',  d: 'Best possible quality. Caption in the post text only.' },
        { v: 'sound', t: 'Just a trending sound',        d: 'Costs some quality. Often worth it for reach.' },
        { v: 'full',  t: 'Text, stickers, filters, trims', d: 'Expensive. We will tell you how to avoid it.' }
      ]
    },
    {
      id: 'length',
      q: 'How long is the clip?',
      why: 'Length times bitrate equals file size, and an upload rejected for size helps nobody.',
      opts: [
        { v: 'short', t: 'Under 60 seconds',  d: 'Spend bitrate freely' },
        { v: 'mid',   t: '1 to 3 minutes',    d: 'Slightly leaner cap' },
        { v: 'long',  t: 'Over 3 minutes',    d: 'Noticeably leaner cap so the upload completes' }
      ]
    },
    {
      id: 'priority',
      q: 'If something has to give, what matters most?',
      why: 'Sets the quality/size trade-off in the encoder.',
      opts: [
        { v: 'quality', t: 'Maximum detail',  d: 'Bigger file, slower upload, sharpest result' },
        { v: 'balance', t: 'A sensible balance', d: 'The default most people should pick' },
        { v: 'speed',   t: 'Upload it fast',  d: 'Smaller file, quicker post, still far better than a raw phone upload' }
      ]
    }
  ];

  const answers = {};
  let step = 0;

  const el = (id) => document.getElementById(id);
  const wizStep = el('wizStep'), wizBar = el('wizBar'), wizCount = el('wizCount');

  function renderStep() {
    if (step >= QUESTIONS.length) { renderSummary(); return; }
    const Q = QUESTIONS[step];
    wizStep.innerHTML =
      `<p class="wiz-q">${Q.q}</p><p class="wiz-why">${Q.why}</p><div class="opts">` +
      Q.opts.map(o =>
        `<button class="opt${answers[Q.id] === o.v ? ' is-picked' : ''}" data-v="${o.v}" type="button">
           <b>${o.t}</b><small>${o.d}</small>
         </button>`).join('') +
      `</div>`;
    wizStep.querySelectorAll('.opt').forEach(b => {
      b.addEventListener('click', () => {
        answers[Q.id] = b.dataset.v;
        step++;
        renderStep();
        updateRecipe();
      });
    });
    wizBar.style.width = (step / QUESTIONS.length * 100) + '%';
    wizCount.textContent = `Question ${step + 1} of ${QUESTIONS.length}`;
    el('wizBack').disabled = step === 0;
    el('wizSummary').hidden = true;
  }

  function renderSummary() {
    wizBar.style.width = '100%';
    wizCount.textContent = 'Done';
    el('wizBack').disabled = false;
    const s = spec();
    wizStep.innerHTML =
      `<p class="wiz-q">That's everything.</p>
       <p class="wiz-why">Your recipe below has been rebuilt from these answers. Scroll to step 3 for the command.</p>`;
    const sum = el('wizSummary');
    sum.hidden = false;
    sum.innerHTML =
      `<h3>What we're going to do</h3><ul>` +
      s.plan.map(p => `<li>${p}</li>`).join('') +
      `</ul>`;
  }

  el('wizBack').addEventListener('click', () => { if (step > 0) { step--; renderStep(); } });
  el('wizRestart').addEventListener('click', () => {
    Object.keys(answers).forEach(k => delete answers[k]);
    step = 0; renderStep(); updateRecipe();
  });

  /* ══════════════════════════════════════════════════════
     SPEC ENGINE — answers (+ analysis) -> concrete numbers
     ══════════════════════════════════════════════════════ */
  let probeData = null;   // set by the analyzer

  function spec() {
    const a = Object.assign({
      source: '4k120', upload: 'desktop', motion: 'smooth60',
      edit: 'none', length: 'short', priority: 'balance'
    }, answers);

    // Resolution: 4K only makes sense through the web uploader.
    const src4k = a.source === '4k120' || a.source === '4k60';
    const fourK = src4k && a.upload === 'desktop';
    const w = fourK ? 2160 : 1080;
    const h = fourK ? 3840 : 1920;

    // Frame rate + time remapping
    let fps, ptsMul = 1, dropAudio = false, motionText;
    switch (a.motion) {
      case 'slow2x': fps = 60; ptsMul = 2; dropAudio = true; motionText = '2× slow motion at 60fps'; break;
      case 'slow4x': fps = 30; ptsMul = 4; dropAudio = true; motionText = '4× slow motion at 30fps'; break;
      case 'cine30': fps = 30; motionText = '30fps cinematic'; break;
      default:       fps = 60; motionText = '60fps real time';
    }

    // Bitrate budget (Mbps). More pixels and more frames need more bits.
    let mbps = (fourK ? 45 : 18) * (fps >= 60 ? 1 : 0.75);
    if (a.priority === 'quality') mbps *= 1.35;
    if (a.priority === 'speed')   mbps *= 0.7;
    if (a.length === 'mid')  mbps *= 0.85;
    if (a.length === 'long') mbps *= 0.65;
    mbps = Math.round(mbps);

    // CRF: the real quality knob. maxrate just caps the peaks.
    const crf = a.priority === 'quality' ? 16 : a.priority === 'speed' ? 20 : 18;
    const preset = a.priority === 'quality' ? 'slow' : a.priority === 'speed' ? 'fast' : 'medium';
    const keyint = fps * 2;

    // Human-readable plan
    const plan = [];
    plan.push(`<b>Export at ${w}×${h}</b> — ${fourK
      ? 'full 4K vertical. Viewers get 1080p, but the encoder has more to work with, so it looks sharper.'
      : 'clean 1080p vertical. The app would downscale a 4K file itself, and worse than we can.'}`);
    plan.push(`<b>${motionText}</b> — ${ptsMul > 1
      ? `every one of your 120 frames is used, stretched over ${ptsMul}× the time. Audio is removed because slowing it would sound wrong.`
      : a.motion === 'cine30'
        ? 'a deliberate 4:1 frame reduction, which leaves the most bits per remaining frame.'
        : 'a clean 2:1 frame reduction — no judder, and audio stays in sync and untouched.'}`);
    plan.push(`<b>H.264 High profile, CRF ${crf}, peaks capped at ${mbps} Mbps</b> — high enough that TikTok's encoder is the only thing softening your picture, low enough that the upload actually finishes.`);
    plan.push(`<b>Keyframe every 2 seconds, faststart, BT.709 colour</b> — the boring metadata that stops washed-out colour and slow first-frame loads.`);
    if (a.upload !== 'desktop') {
      plan.push(`<b>Warning:</b> uploading from the ${a.upload === 'iphone' ? 'iPhone' : 'Android'} app means the app compresses your file before it sends it, and TikTok compresses it again after. Switch to <a href="https://www.tiktok.com/upload" target="_blank" rel="noopener noreferrer">tiktok.com/upload</a> on a computer and you skip an entire generation of loss for free.`);
    }
    if (a.edit === 'full') {
      plan.push(`<b>Warning:</b> text, stickers and filters added inside TikTok re-encode the whole video a second time. Burn them into the file in your editor instead — it costs you nothing and looks visibly better.`);
    } else if (a.edit === 'sound') {
      plan.push(`<b>Note:</b> adding a sound in-app does trigger a re-encode. It's usually worth it for reach — just add the sound and nothing else, and don't trim after adding it.`);
    }
    if (a.source === 'other') {
      plan.push(`<b>Note:</b> since your source isn't a standard phone capture, run it through the analyzer in step 2 — the checks there will catch odd frame rates, wrong aspect ratios and low source bitrates that no preset can fix.`);
    }

    return { a, w, h, fps, ptsMul, dropAudio, mbps, crf, preset, keyint, fourK, plan, motionText };
  }

  /* ══════════════════════════════════════════════════════
     COMMAND BUILDERS
     ══════════════════════════════════════════════════════ */
  function buildCmd(kind) {
    const s = spec();
    const IN = 'input.mov', OUT = 'tiktok-ready.mp4';
    const vf = [
      s.ptsMul > 1 ? `setpts=${s.ptsMul.toFixed(1)}*PTS` : null,
      `scale=${s.w}:${s.h}:force_original_aspect_ratio=decrease:flags=lanczos`,
      `pad=${s.w}:${s.h}:(ow-iw)/2:(oh-ih)/2:color=black`,
      'format=yuv420p'
    ].filter(Boolean).join(',');

    const audio = s.dropAudio ? '-an' : '-c:a aac -b:a 320k -ar 48000 -ac 2';
    const color = '-color_primaries bt709 -color_trc bt709 -colorspace bt709';

    if (kind === 'mac') {
      return [
        `ffmpeg -i ${IN} \\`,
        `  -vf "${vf}" -r ${s.fps} \\`,
        `  -c:v h264_videotoolbox -profile:v high -b:v ${s.mbps}M -maxrate ${Math.round(s.mbps * 1.2)}M -bufsize ${s.mbps * 2}M \\`,
        `  -g ${s.keyint} -tag:v avc1 ${color} \\`,
        `  ${audio} -movflags +faststart \\`,
        `  ${OUT}`
      ].join('\n');
    }
    if (kind === 'nvidia') {
      return [
        `ffmpeg -i ${IN} \\`,
        `  -vf "${vf}" -r ${s.fps} \\`,
        `  -c:v h264_nvenc -preset p7 -tune hq -profile:v high -rc vbr -cq ${s.crf} \\`,
        `  -b:v ${s.mbps}M -maxrate ${Math.round(s.mbps * 1.3)}M -bufsize ${s.mbps * 2}M \\`,
        `  -g ${s.keyint} -bf 3 ${color} \\`,
        `  ${audio} -movflags +faststart \\`,
        `  ${OUT}`
      ].join('\n');
    }
    if (kind === 'editor') {
      return [
        `Format ................ H.264 / MP4  (not HEVC, not ProRes)`,
        `Resolution ............ ${s.w} × ${s.h}   (vertical 9:16)`,
        `Frame rate ............ ${s.fps} fps, constant — not variable, not "match source"`,
        `Profile / Level ....... High / 5.2`,
        `Bitrate encoding ...... VBR, 2 pass`,
        `Target bitrate ........ ${s.mbps} Mbps`,
        `Maximum bitrate ....... ${Math.round(s.mbps * 1.3)} Mbps`,
        `Keyframe distance ..... ${s.keyint} frames  (every 2 seconds)`,
        `Colour space .......... Rec. 709`,
        `Audio ................. ${s.dropAudio ? 'None — slow motion, audio removed' : 'AAC, 320 kbps, 48 kHz, stereo'}`,
        `Also tick ............. "Fast start" / "Start video quickly" / web-optimised`,
        `Do NOT tick ........... "Use maximum render quality" is fine; any "upload to social"`,
        `                        preset is not — they all downscale and cap bitrate.`,
        ``,
        `Premiere:      Export > Format: H.264 > preset "Match Source - High bitrate", then`,
        `               override the fields above by hand.`,
        `Resolve:       Deliver > Custom Export > MP4 / H.264 > Restrict to ${s.mbps}000 Kb/s.`,
        `Final Cut:     Share > Export File > Computer > Format: Video and Audio >`,
        `               Codec: H.264 Better Quality.`
      ].join('\n');
    }
    // default: portable CPU encode
    return [
      `ffmpeg -i ${IN} \\`,
      `  -vf "${vf}" -r ${s.fps} \\`,
      `  -c:v libx264 -profile:v high -level 5.2 -preset ${s.preset} -crf ${s.crf} \\`,
      `  -maxrate ${s.mbps}M -bufsize ${s.mbps * 2}M \\`,
      `  -x264-params "keyint=${s.keyint}:min-keyint=${s.fps}:scenecut=0:bframes=3:ref=4" \\`,
      `  ${color} \\`,
      `  ${audio} -movflags +faststart \\`,
      `  ${OUT}`
    ].join('\n');
  }

  const NOTES = {
    cpu: 'Works anywhere FFmpeg runs, and gives the best quality per megabyte — it is just slower. Install with <code>brew install ffmpeg</code> (Mac), <code>winget install ffmpeg</code> (Windows) or <code>sudo apt install ffmpeg</code> (Linux). Replace <code>input.mov</code> with your file name, or drag the file onto the terminal window to paste its path.',
    mac: 'Uses the hardware encoder in Apple silicon — many times faster, a hair softer than the CPU version at the same bitrate. Excellent for long 4K clips.',
    nvidia: 'Uses your GPU\'s NVENC encoder. <code>-preset p7</code> is the slowest and highest quality NVENC setting; drop to <code>p5</code> if it is not fast enough.',
    editor: 'If you would rather not touch a terminal, set these fields in your editor\'s export dialog. Every one of them matters — the keyframe distance and constant frame rate are the two people most often skip.'
  };

  let currentTab = 'cpu';

  function updateRecipe() {
    const s = spec();
    el('specCard').innerHTML = [
      ['Resolution',  `${s.w}×${s.h}`],
      ['Frame rate',  `${s.fps} fps CFR`],
      ['Motion',      s.motionText],
      ['Codec',       'H.264 High'],
      ['Bitrate cap', `${s.mbps} Mbps`],
      ['Audio',       s.dropAudio ? 'removed' : 'AAC 320k']
    ].map(([k, v]) => `<div class="spec"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

    el('cmd').textContent = buildCmd(currentTab);
    el('cmdNote').innerHTML = NOTES[currentTab];
  }

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('is-active'));
      t.classList.add('is-active');
      currentTab = t.dataset.tab;
      updateRecipe();
    });
  });

  el('copyBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(el('cmd').textContent);
      el('copyBtn').textContent = 'Copied';
    } catch {
      el('copyBtn').textContent = 'Select it manually';
    }
    setTimeout(() => { el('copyBtn').textContent = 'Copy'; }, 1800);
  });

  /* ══════════════════════════════════════════════════════
     ANALYZER — metadata + measured frame rate, in-browser
     ══════════════════════════════════════════════════════ */
  const drop = el('drop'), fileInput = el('fileInput'), probe = el('probe');

  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(ev =>
    drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', e => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  const fmtBytes = b => b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB'
                      : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB'
                      : (b / 1e3).toFixed(0) + ' KB';
  const fmtTime = s => {
    if (!isFinite(s)) return '—';
    const m = Math.floor(s / 60), sec = (s % 60).toFixed(1);
    return m ? `${m}m ${sec}s` : `${sec}s`;
  };

  async function handleFile(file) {
    el('analysis').hidden = false;
    el('statGrid').innerHTML = `<div class="stat"><div class="k">Status</div><div class="v">reading…</div></div>`;
    el('checks').innerHTML = '';

    const url = URL.createObjectURL(file);
    probe.src = url;

    const meta = await new Promise((resolve) => {
      const done = () => resolve({
        w: probe.videoWidth, h: probe.videoHeight, dur: probe.duration
      });
      probe.onloadedmetadata = done;
      probe.onerror = () => resolve(null);
      setTimeout(() => resolve({ w: probe.videoWidth, h: probe.videoHeight, dur: probe.duration }), 6000);
    });

    if (!meta || !meta.w) {
      el('statGrid').innerHTML =
        `<div class="stat"><div class="k">Status</div><div class="v">unreadable</div></div>`;
      el('checks').innerHTML =
        `<li class="bad"><span class="dot"></span><div><b>This browser can't decode the file</b>
         <span class="txt">Usually means ProRes, HEVC in a MOV wrapper, or a raw camera format.
         That's not a problem for your upload — it just means the browser can't preview it.
         Use the FFmpeg command in step 3 and it will handle the file fine.</span></div></li>`;
      URL.revokeObjectURL(url);
      return;
    }

    const fps = await measureFps();
    const bitrateMbps = meta.dur ? (file.size * 8) / meta.dur / 1e6 : 0;
    probeData = { file, ...meta, fps, bitrateMbps };

    el('statGrid').innerHTML = [
      ['Resolution', `${meta.w}×${meta.h}`],
      ['Frame rate', fps ? `${fps} fps` : 'unmeasured'],
      ['Duration', fmtTime(meta.dur)],
      ['File size', fmtBytes(file.size)],
      ['Avg bitrate', bitrateMbps ? bitrateMbps.toFixed(1) + ' Mbps' : '—'],
      ['Aspect', (meta.w / meta.h).toFixed(3).replace(/0+$/, '')]
    ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

    renderChecks(probeData);
    el('convertBtn').disabled = false;
    el('convertBtn').textContent = 'Convert in browser';
    URL.revokeObjectURL(url);
  }

  // Measure real frame rate by sampling presentation timestamps.
  function measureFps() {
    return new Promise((resolve) => {
      if (!probe.requestVideoFrameCallback) { resolve(null); return; }
      const times = [];
      let stopped = false;
      const stop = (val) => { if (!stopped) { stopped = true; probe.pause(); resolve(val); } };

      const onFrame = (_now, m) => {
        times.push(m.mediaTime);
        if (times.length >= 40) {
          const deltas = [];
          for (let i = 1; i < times.length; i++) {
            const d = times[i] - times[i - 1];
            if (d > 0.0005) deltas.push(d);
          }
          if (!deltas.length) return stop(null);
          deltas.sort((a, b) => a - b);
          const median = deltas[Math.floor(deltas.length / 2)];
          const raw = 1 / median;
          // Snap to the nearest standard rate when we're close.
          const standard = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 100, 119.88, 120, 240];
          const near = standard.find(s => Math.abs(s - raw) / s < 0.06);
          return stop(near ? Math.round(near * 100) / 100 : Math.round(raw * 10) / 10);
        }
        probe.requestVideoFrameCallback(onFrame);
      };

      probe.muted = true;
      probe.requestVideoFrameCallback(onFrame);
      probe.play().catch(() => stop(null));
      setTimeout(() => stop(times.length > 4 ? null : null), 5000);
    });
  }

  function renderChecks(d) {
    const out = [];
    const add = (lvl, title, text) => out.push(
      `<li class="${lvl}"><span class="dot"></span><div><b>${title}</b><span class="txt">${text}</span></div></li>`);

    // Aspect ratio
    const ar = d.w / d.h;
    if (Math.abs(ar - 9 / 16) < 0.02) {
      add('ok', 'Vertical 9:16 — perfect', 'Fills the whole screen with no bars and no cropping.');
    } else if (ar > 1) {
      add('bad', 'This is a landscape video',
        `At ${d.w}×${d.h} TikTok will either letterbox it into thin bars or crop the sides off. Reframe it to 9:16 in your editor — the recipe below pads rather than crops so nothing is lost, but a real reframe always looks better.`);
    } else {
      add('warn', 'Vertical, but not exactly 9:16',
        `${d.w}×${d.h} works, it just won't fill the frame edge to edge. Export at 1080×1920 or 2160×3840 for a clean fit.`);
    }

    // Resolution
    if (d.h >= 3840 || d.w >= 2160) {
      add('ok', '4K source — good', 'Viewers receive 1080p, but a 4K source gives the encoder more to work with, so the result is noticeably sharper on detail.');
    } else if (d.h >= 1920) {
      add('ok', '1080p source', 'Matches TikTok\'s delivery canvas exactly. Perfectly good. 4K would buy you a little extra sharpness if you have it.');
    } else {
      add('bad', 'Below 1080p',
        `${d.w}×${d.h} is under TikTok's delivery resolution, so it gets upscaled and will look soft no matter what settings you use. Re-shoot or re-export at 1080p or higher if you possibly can.`);
    }

    // Frame rate
    if (d.fps === null) {
      add('warn', 'Frame rate could not be measured',
        'Your browser doesn\'t expose per-frame timing. Not a problem — just set the frame rate explicitly in the recipe below rather than using "match source".');
    } else if (d.fps > 65) {
      add('warn', `${d.fps} fps — above what TikTok plays back`,
        'Feed playback tops out at 60fps. Converting this yourself, deliberately, gives a much better result than letting TikTok\'s transcoder decimate frames. Question 3 in the flow above picks how.');
    } else if (d.fps >= 29) {
      add('ok', `${d.fps} fps — inside TikTok's range`, 'This passes through without the platform needing to change your timing.');
    } else {
      add('warn', `${d.fps} fps is low`, 'Motion will look choppy in a feed full of 30 and 60fps clips.');
    }

    // Bitrate
    const px = d.w * d.h, expect = px >= 2160 * 3840 ? 35 : px >= 1080 * 1920 ? 12 : 5;
    if (d.bitrateMbps >= expect) {
      add('ok', `${d.bitrateMbps.toFixed(1)} Mbps source bitrate — healthy`,
        'Plenty of data for TikTok\'s encoder to work from.');
    } else if (d.bitrateMbps >= expect * 0.5) {
      add('warn', `${d.bitrateMbps.toFixed(1)} Mbps is on the low side`,
        `For this resolution, around ${expect} Mbps or more is where quality stops being the bottleneck. This file has probably already been compressed once — likely exported from a phone app or downloaded from another platform.`);
    } else {
      add('bad', `${d.bitrateMbps.toFixed(1)} Mbps — already heavily compressed`,
        'This file has been squeezed before you got here. Re-exporting it can\'t bring back detail that is already gone — go back to the original camera file if you still have it. Everything below will still help, but it can only preserve what\'s left.');
    }

    // Duration / size practicality
    if (d.dur > 180) {
      add('warn', 'Long clip', 'Over 3 minutes at a high bitrate makes a big file. The recipe lowers the cap automatically when you pick the matching answer in question 5.');
    }
    if (d.file.size > 4e9) {
      add('warn', 'Very large file', 'Some uploaders reject files this size. If yours does, lower the bitrate cap before you lower the resolution — bitrate is the cheaper thing to give up.');
    }

    el('checks').innerHTML = out.join('');
  }

  /* ══════════════════════════════════════════════════════
     OPTIONAL IN-BROWSER CONVERTER (ffmpeg.wasm)
     ══════════════════════════════════════════════════════ */
  const convBtn = el('convertBtn'), convLog = el('convLog'),
        convBar = el('convBar'), convProgress = el('convProgress'),
        convDownload = el('convDownload');

  const log = (m) => { convLog.textContent = m; };
  let ffmpeg = null;

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  convBtn.addEventListener('click', async () => {
    if (!probeData) return;
    convBtn.disabled = true;
    convDownload.hidden = true;
    convProgress.hidden = false;
    convBar.style.width = '0%';

    try {
      if (!ffmpeg) {
        log('Downloading the FFmpeg WebAssembly build (~32 MB, once per visit)…');
        await loadScript('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js');
        await loadScript('https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/util.js');
        const { FFmpeg } = window.FFmpegWASM;
        const { toBlobURL } = window.FFmpegUtil;
        const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
        ffmpeg = new FFmpeg();
        ffmpeg.on('progress', ({ progress }) => {
          const p = Math.max(0, Math.min(100, progress * 100));
          convBar.style.width = p + '%';
          log(`Encoding… ${p.toFixed(0)}%  (a browser is far slower than the desktop command — this is normal)`);
        });
        log('Starting the WebAssembly engine…');
        await ffmpeg.load({
          coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm')
        });
      }

      const s = spec();
      log('Loading your file into the engine…');
      const buf = new Uint8Array(await probeData.file.arrayBuffer());
      await ffmpeg.writeFile('in.mp4', buf);

      const vf = [
        s.ptsMul > 1 ? `setpts=${s.ptsMul.toFixed(1)}*PTS` : null,
        `scale=${s.w}:${s.h}:force_original_aspect_ratio=decrease:flags=bicubic`,
        `pad=${s.w}:${s.h}:(ow-iw)/2:(oh-ih)/2:color=black`,
        'format=yuv420p'
      ].filter(Boolean).join(',');

      const args = [
        '-i', 'in.mp4',
        '-vf', vf,
        '-r', String(s.fps),
        '-c:v', 'libx264', '-profile:v', 'high',
        // A browser cannot afford the slow presets the desktop command uses.
        '-preset', 'veryfast', '-crf', String(s.crf),
        '-maxrate', `${s.mbps}M`, '-bufsize', `${s.mbps * 2}M`,
        '-g', String(s.keyint),
        '-movflags', '+faststart'
      ];
      if (s.dropAudio) args.push('-an');
      else args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
      args.push('out.mp4');

      log('Encoding… this can take several minutes. Keep this tab in the foreground.');
      await ffmpeg.exec(args);

      const data = await ffmpeg.readFile('out.mp4');
      const blob = new Blob([data.buffer], { type: 'video/mp4' });
      convDownload.href = URL.createObjectURL(blob);
      convDownload.download = 'tiktok-ready.mp4';
      convDownload.hidden = false;
      convBar.style.width = '100%';
      log(`Done — ${fmtBytes(blob.size)}. Note this used a fast encoder preset to finish in a browser; the desktop command in step 3 produces a visibly better file from the same source.`);
    } catch (err) {
      convProgress.hidden = true;
      log('In-browser conversion failed: ' + (err && err.message ? err.message : err) +
          '\n\nThis is common with large 4K files — WebAssembly runs out of addressable memory long before your computer does. Use the FFmpeg command in step 3 instead; it has no such limit and is much faster.');
    } finally {
      convBtn.disabled = false;
      convBtn.textContent = 'Convert in browser';
    }
  });

  /* ── boot ── */
  renderStep();
  updateRecipe();
})();
