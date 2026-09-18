/* WebCodecs transcoder: demux (MP4Box) -> decode -> scale/retime -> encode -> mux (mp4-muxer).
   Uses the device's hardware video encoder where the browser exposes one. */
(() => {
  'use strict';

  /* Served from this repo, not a CDN: no third-party requests, works offline. */
  const LIB = {
    mp4box: 'assets/vendor/mp4box.all.min.js',
    muxer:  'assets/vendor/mp4-muxer.js'
  };

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  /* Pick the best H.264 level our encoder will accept at this size. */
  const AVC_CANDIDATES = [
    'avc1.640034', 'avc1.640033', 'avc1.640032', 'avc1.64002A',
    'avc1.640028', 'avc1.4D0034', 'avc1.4D002A', 'avc1.42E02A'
  ];

  /* mp4-muxer wants a family name, not the full codec string. */
  function muxerCodecFor(codec) {
    if (codec.startsWith('avc1') || codec.startsWith('avc3')) return 'avc';
    if (codec.startsWith('hvc1') || codec.startsWith('hev1')) return 'hevc';
    if (codec.startsWith('vp09') || codec === 'vp9') return 'vp9';
    if (codec.startsWith('av01')) return 'av1';
    return 'avc';
  }

  async function pickEncoderConfig(width, height, bitrate, fps, preferred) {
    if (typeof VideoEncoder === 'undefined') return null;
    const candidates = preferred ? [preferred].concat(AVC_CANDIDATES) : AVC_CANDIDATES;
    for (const codec of candidates) {
      const cfg = {
        codec, width, height, bitrate,
        framerate: fps,
        avc: { format: 'avc' },
        bitrateMode: 'variable',
        latencyMode: 'quality',
        hardwareAcceleration: 'prefer-hardware'
      };
      try {
        const s = await VideoEncoder.isConfigSupported(cfg);
        if (s && s.supported) return s.config || cfg;
      } catch (_) { /* try the next candidate */ }
      // Some builds reject the hardware hint but accept the codec.
      try {
        const soft = Object.assign({}, cfg); delete soft.hardwareAcceleration;
        const s2 = await VideoEncoder.isConfigSupported(soft);
        if (s2 && s2.supported) return s2.config || soft;
      } catch (_) { /* keep going */ }
    }
    return null;
  }

  /* Capability probe used by the UI before offering the button. */
  async function probe(width, height) {
    const out = { webcodecs: typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined',
                  encode: false, decodeH264: false, decodeHEVC: false, config: null };
    if (!out.webcodecs) return out;
    out.config = await pickEncoderConfig(width || 1080, height || 1920, 20e6, 60);
    out.encode = !!out.config;
    const tryDec = async (codec) => {
      try {
        const s = await VideoDecoder.isConfigSupported({ codec, codedWidth: width || 1080, codedHeight: height || 1920 });
        return !!(s && s.supported);
      } catch (_) { return false; }
    };
    out.decodeH264 = await tryDec('avc1.640028');
    out.decodeHEVC = await tryDec('hvc1.1.6.L120.B0');
    return out;
  }

  /* Pull the codec-private data (avcC / hvcC) out of an MP4Box track. */
  function descriptionFor(mp4file, trackId) {
    if (!window.DataStream) return null;
    const trak = mp4file.getTrackById(trackId);
    const entries = trak.mdia.minf.stbl.stsd.entries;
    for (const entry of entries) {
      const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
      if (box) {
        const DS = window.DataStream;   // mp4box exposes DataStream as its own global
        const stream = new DS(undefined, 0, DS.BIG_ENDIAN);
        box.write(stream);
        return new Uint8Array(stream.buffer, 8); // strip the box header
      }
    }
    return null;
  }

  /* AudioSpecificConfig from the esds box, for passing AAC through untouched. */
  function audioDescriptionFor(mp4file, trackId) {
    try {
      const trak = mp4file.getTrackById(trackId);
      const entry = trak.mdia.minf.stbl.stsd.entries[0];
      const esd = entry && entry.esds && entry.esds.esd;
      if (!esd || !esd.descs) return null;
      for (const d of esd.descs) {
        if (d.descs) for (const dd of d.descs) if (dd.data) return new Uint8Array(dd.data);
      }
    } catch (_) { /* fall through */ }
    return null;
  }

  /**
   * opts: { width, height, fps, ptsMul, bitrate, dropAudio }
   * cb:   { onProgress(0..1), onLog(string) }
   */
  async function transcode(file, opts, cb) {
    const log = (m) => cb && cb.onLog && cb.onLog(m);
    const prog = (p) => cb && cb.onProgress && cb.onProgress(Math.max(0, Math.min(1, p)));

    log('Loading the demuxer and muxer…');
    await Promise.all([loadScript(LIB.mp4box), loadScript(LIB.muxer)]);
    const Muxer = window.Mp4Muxer;
    if (!window.MP4Box || !Muxer) throw new Error('The demuxer or muxer did not load.');

    const W = opts.width, H = opts.height, FPS = opts.fps, PTS = opts.ptsMul || 1;

    const encCfg = await pickEncoderConfig(W, H, opts.bitrate, FPS, opts.codec);
    if (!encCfg) throw new Error('This browser has no H.264 encoder available, so it cannot build an MP4 here. Use the Shortcuts method instead.');

    /* ---- demux ---------------------------------------------------- */
    log('Reading the file\u2026');
    const mp4 = MP4Box.createFile();
    let info = null, parseError = null;
    const ready = new Promise((res, rej) => {
      mp4.onReady = (i) => { info = i; res(i); };
      mp4.onError = (e) => { parseError = e; rej(new Error('Could not parse this file: ' + e)); };
    });

    const CHUNK = 8 * 1024 * 1024;
    let offset = 0;

    /* Feed until the header has been parsed. Files recorded on a phone often carry
       their index at the end, so this may have to read most of the file. */
    while (offset < file.size && !info && !parseError) {
      const end = Math.min(offset + CHUNK, file.size);
      const buf = await file.slice(offset, end).arrayBuffer();
      buf.fileStart = offset;
      mp4.appendBuffer(buf);
      offset = end;
      await new Promise(r => setTimeout(r, 0));   // let onReady run
      if (offset > 96 * 1024 * 1024 && !info) log('Still reading the index\u2026 large recordings keep it at the end of the file.');
    }
    if (!info) await ready;   // surfaces the parse error, or resolves if it just landed

    const vTrack = info.videoTracks && info.videoTracks[0];
    if (!vTrack) throw new Error('No video track found in this file.');
    const aTrack = opts.dropAudio ? null : (info.audioTracks && info.audioTracks[0]);

    const srcW = vTrack.track_width || (vTrack.video && vTrack.video.width);
    const srcH = vTrack.track_height || (vTrack.video && vTrack.video.height);
    if (!srcW || !srcH) throw new Error('Could not read the video dimensions.');
    const totalSamples = vTrack.nb_samples;
    const needsDesc = /^(avc|hvc|hev)/.test(vTrack.codec);
    const vDesc = needsDesc ? descriptionFor(mp4, vTrack.id) : null;
    if (needsDesc && !vDesc) throw new Error('Could not read this video\u0027s codec header.');

    /* ---- audio decision, before the muxer is configured -------------- */
    // AAC is copied through untouched, which needs its AudioSpecificConfig.
    // Without it we must not declare an audio track at all, or the output
    // would carry an empty one.
    const aDesc = aTrack ? audioDescriptionFor(mp4, aTrack.id) : null;
    const keepAudio = !!(aTrack && aDesc);

    /* ---- muxer ----------------------------------------------------- */
    const muxer = new Muxer.Muxer({
      target: new Muxer.ArrayBufferTarget(),
      video: { codec: muxerCodecFor(encCfg.codec), width: W, height: H },
      audio: keepAudio ? { codec: 'aac', sampleRate: aTrack.audio.sample_rate, numberOfChannels: aTrack.audio.channel_count } : undefined,
      fastStart: 'in-memory'   // index at the front, the same as -movflags +faststart
    });

    /* ---- encoder --------------------------------------------------- */
    let encodeErr = null, encoded = 0;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => { muxer.addVideoChunk(chunk, meta); encoded++; },
      error: (e) => { encodeErr = e; }
    });
    encoder.configure(encCfg);

    /* ---- scaling surface ------------------------------------------- */
    const useOffscreen = typeof OffscreenCanvas !== 'undefined';
    const canvas = useOffscreen ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    const scale = Math.min(W / srcW, H / srcH);
    const dw = Math.max(2, Math.round(srcW * scale / 2) * 2);
    const dh = Math.max(2, Math.round(srcH * scale / 2) * 2);
    const dx = Math.floor((W - dw) / 2), dy = Math.floor((H - dh) / 2);
    const needsLetterbox = dw !== W || dh !== H;

    /* ---- decoder + frame retiming ---------------------------------- */
    const SLOT = 1 / FPS;                 // seconds between output frames
    let lastSlot = -1, emitted = 0, decodeErr = null, processed = 0;

    const decoder = new VideoDecoder({
      output: (frame) => {
        try {
          const outT = (frame.timestamp / 1e6) * PTS;       // seconds on the output timeline
          const slot = Math.round(outT / SLOT);
          if (slot <= lastSlot) { frame.close(); return; }  // this slot is already filled
          lastSlot = slot;

          if (needsLetterbox) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
          ctx.drawImage(frame, dx, dy, dw, dh);
          frame.close();

          const ts = Math.round(slot * SLOT * 1e6);
          const vf = new VideoFrame(canvas, { timestamp: ts, duration: Math.round(SLOT * 1e6) });
          encoder.encode(vf, { keyFrame: emitted % (FPS * 2) === 0 });
          vf.close();
          emitted++;
        } catch (e) {
          decodeErr = e;
          try { frame.close(); } catch (_) {}
        }
      },
      error: (e) => { decodeErr = e; }
    });
    /* Try hardware first, then let the browser choose, then software. A device
       without a hardware decoder for this codec can still do it in software. */
    const baseDec = { codec: vTrack.codec, codedWidth: srcW, codedHeight: srcH };
    if (needsDesc && vDesc) baseDec.description = vDesc;
    let decCfg = null;
    for (const hint of ['prefer-hardware', null, 'prefer-software']) {
      const cfg = Object.assign({}, baseDec);
      if (hint) cfg.hardwareAcceleration = hint;
      try {
        const sup = await VideoDecoder.isConfigSupported(cfg);
        if (sup && sup.supported) { decCfg = sup.config || cfg; break; }
      } catch (_) { /* try the next one */ }
    }
    if (!decCfg) throw new Error('This browser cannot decode ' + vTrack.codec + ' video. The Shortcuts method does not have this limitation.');
    decoder.configure(decCfg);

    /* ---- sample pump ------------------------------------------------ */
    const audioChunks = [];
    let audioMeta = keepAudio ? { decoderConfig: { codec: 'mp4a.40.2', sampleRate: aTrack.audio.sample_rate,
                                                   numberOfChannels: aTrack.audio.channel_count, description: aDesc } } : undefined;

    mp4.onSamples = (id, _user, samples) => {
      for (const s of samples) {
        const ts = Math.round(s.cts / s.timescale * 1e6);
        const dur = Math.round(s.duration / s.timescale * 1e6);
        if (id === vTrack.id) {
          decoder.decode(new EncodedVideoChunk({
            type: s.is_sync ? 'key' : 'delta',
            timestamp: ts, duration: dur, data: s.data
          }));
          processed++;
        } else if (keepAudio && id === aTrack.id) {
          audioChunks.push({ ts: Math.round(ts * PTS), dur: Math.round(dur * PTS), data: s.data.slice(0) });
        }
      }
      mp4.releaseUsedSamples(id, samples[samples.length - 1].number + 1);
      if (totalSamples) prog(0.05 + 0.8 * (processed / totalSamples));
    };

    mp4.setExtractionOptions(vTrack.id, null, { nbSamples: 50 });
    if (keepAudio) mp4.setExtractionOptions(aTrack.id, null, { nbSamples: 200 });
    mp4.start();

    log('Transcoding…');
    // Continue from where header parsing stopped. Data already appended is
    // emitted by start() above, so nothing is fed to the demuxer twice.
    while (offset < file.size) {
      if (decodeErr) throw decodeErr;
      if (encodeErr) throw encodeErr;
      const end = Math.min(offset + CHUNK, file.size);
      const buf = await file.slice(offset, end).arrayBuffer();
      buf.fileStart = offset;
      mp4.appendBuffer(buf);
      offset = end;
      // Let the decoder and encoder drain so memory stays bounded.
      let guard = 0;
      while ((decoder.decodeQueueSize > 12 || encoder.encodeQueueSize > 12) && guard++ < 2000) {
        await new Promise(r => setTimeout(r, 15));
        if (decodeErr) throw decodeErr;
        if (encodeErr) throw encodeErr;
      }
    }
    mp4.flush();

    log('Finishing the last frames…');
    await decoder.flush();
    await encoder.flush();
    if (decodeErr) throw decodeErr;
    if (encodeErr) throw encodeErr;
    if (emitted === 0) throw new Error('No frames could be decoded from this file.');

    // Losing the audio must not lose the whole conversion.
    let audioAdded = 0;
    if (keepAudio && audioChunks.length) {
      log('Copying the audio track…');
      try {
        for (const c of audioChunks) {
          muxer.addAudioChunk(new EncodedAudioChunk({ type: 'key', timestamp: c.ts, duration: c.dur, data: c.data }), audioMeta);
          audioMeta = undefined;   // the config only goes on the first chunk
          audioAdded++;
        }
      } catch (e) {
        if (audioAdded) throw e;   // a partial audio track is worse than none
        log('The audio track could not be copied; continuing without it.');
      }
    }

    prog(0.97);
    decoder.close(); encoder.close();
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    prog(1);
    return { blob, frames: emitted, droppedAudio: !!(aTrack && !audioAdded) };
  }

  window.NoSquishTranscode = { transcode, probe, pickEncoderConfig, muxerCodecFor };
})();
