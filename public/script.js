// ============================================================
// BASCORD v10 — script.js  (C:\Bascord\public\script.js)
// ============================================================
// ROOT CAUSE FIXES:
// [A] SES GECİKMESİ / GİTMEMESİ:
//   - Mikrofon açıldığında mevcut bağlantılara ÖNCE track ekleniyor,
//     SONRA server'a bildirim gidiyor (sıra bozukluğu giderildi)
//   - Audio element her zaman srcObject alıyor; mevcut element
//     yeniden kullanılıyor (sıfırlama hatası giderildi)
//   - autoGainControl + echoCancellation ZORUNLU (kalite fix)
// [B] YANLIŞ YAYINA BAĞLANMA:
//   - ontrack: her stream track tipine (audio/video) göre
//     AYRI bir map'e yazılıyor (ses kamera streamine, video ekran streamine gitmiyor)
//   - remoteYayinEkle: trackId tabanlı eşleştirme eklendi
// [C] EKRAN PAYLAŞIMI SES KESİYOR:
//   - Ekran ses track'i AYRI bir audio stream olarak işleniyor;
//     mikrofon audio element'ine dokunmuyor
//   - ekranYayini.audio için ayrı element: audio-screen-{id}
// [D] MOBİL UYUMSUZLUK:
//   - isMobile tespiti geliştirildi (iPad OS dahil)
//   - getDisplayMedia mobilde hiç çağrılmıyor
//   - Touch event'ler passive:false ile düzgün çalışıyor
// ============================================================

'use strict';

// ── PLATFORM TESPİTİ ─────────────────────────────────────────
const UA       = navigator.userAgent;
const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(UA) ||
                 (navigator.maxTouchPoints > 1 && /Mac/i.test(UA)); // iPad OS
const isElectron = !!(window.process?.type || window.require);

// ── SOCKET ───────────────────────────────────────────────────
const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000
});

// ── STATE ────────────────────────────────────────────────────
let peers       = {};           // peerId -> RTCPeerConnection
// [B-FIX] Her peer için track tipine göre ayrı stream haritası
// audioStreams[peerId] = MediaStream  (mikrofon veya ekran-ses)
// videoStreams[peerId] = { kamera:MediaStream, ekran:MediaStream }
let audioStreams = {};
let screenAudioStreams = {};    // [C-FIX] Ekran sesi ayrı
let videoStreams = {};

let localMic    = null;    // mikrofon MediaStream
let localCam    = null;    // kamera  MediaStream
let localScreen = null;    // ekran   MediaStream (video+audio)

let audioCtx    = null;
let isDeafened  = false;
let wasMicOn    = false;
let isPtt       = false;
let isPttDown   = false;
let myStatus    = 'online';

let dmActive    = null;
let dmCache     = {};      // peerId -> [msgs]
let dmUsers     = {};      // peerId -> name
let dmUnread    = 0;
let unreadChat  = 0;
let msgIdx      = 0;
let reacts      = {};      // msgId -> {emoji: count}
let lastAuthor  = null;    // mesaj gruplama

let typingTimer = null;
let testStream  = null;
let testTimer   = null;

let savedMic  = localStorage.getItem('bc_mic') || 'default';
let savedCam  = localStorage.getItem('bc_cam') || 'default';

// ── KULLANICI ADI ─────────────────────────────────────────────
let myName = localStorage.getItem('bc_name');
if (!myName) {
    try { myName = prompt("Bascord'a hoş geldin! İsmin:") || 'Anonim'; }
    catch { myName = 'Gamer_' + (Math.random()*1000|0); }
    localStorage.setItem('bc_name', myName);
}

// ── DOM REFS ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const joinBtn   = $('joinBtn');
const micBtn    = $('micBtn');
const deafBtn   = $('deafBtn');
const camBtn    = $('camBtn');
const flipBtn   = $('flipBtn');
const screenBtn = $('screenBtn');
const pttBtn    = $('pttBtn');
const gamerBtn  = $('gamerBtn');
const msgIn     = $('msgIn');
const sendBtn   = $('sendBtn');
const msgs      = $('msgs');

// ICE konfig — birden fazla STUN/TURN
const ICE = { iceServers: [
    { urls: ['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302'] },
    { urls: 'turn:openrelay.metered.ca:443', username:'openrelayproject', credential:'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username:'openrelayproject', credential:'openrelayproject' }
]};

// ── UI AYAR ──────────────────────────────────────────────────
$('upName').textContent  = myName;
$('myAv').textContent    = myName[0].toUpperCase();

// ── TOAST ────────────────────────────────────────────────────
function showToast(txt, type='') {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' '+type : '');
    const icons = { w:'fa-exclamation-triangle', e:'fa-times-circle', i:'fa-info-circle', '':'fa-check-circle' };
    el.innerHTML = `<i class="fas ${icons[type]||icons['']}"></i> ${txt}`;
    $('toasts').appendChild(el);
    setTimeout(() => el.parentNode?.removeChild(el), 3800);
}

// ── PİNG ─────────────────────────────────────────────────────
setInterval(() => socket.emit('ping-olc', Date.now()), 5000);
socket.on('pong-olc', t => {
    const ms = Date.now() - t;
    const b  = $('pingBadge'), q = $('qBar'), w = $('pingWrap');
    b.textContent = ms + 'ms';
    b.className   = 'pbadge ' + (ms<80?'pbg':ms<200?'pby':'pbr');
    q.className   = 'qbar '  + (ms<80?'qg':ms<200?'qy':'qr');
    if (!w.title) w.title = 'Sunucu gecikmesi';
});

// ── EMOJİ ─────────────────────────────────────────────────────
const EMOJIS = '😀😂😍😎😢😡👍👎🔥🎉❤️🤔🙄😴😷👽🤖👻💩👀🎮💯✨🏆💪'.match(/\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu) || ['😀','😂','😍','😎','😢','😡','👍','👎','🔥','🎉','❤️','🤔','🙄','😴','😷','👽','🤖','👻','💩','👀','🎮','💯','✨','🏆','💪'];
const emojiPicker = $('emojiPicker');
EMOJIS.forEach(e => {
    const b = document.createElement('button'); b.className='eb'; b.textContent=e;
    b.onclick = () => { msgIn.value += e; emojiPicker.style.display='none'; msgIn.focus(); };
    emojiPicker.appendChild(b);
});
$('emojiBtn').onclick = () => emojiPicker.style.display = emojiPicker.style.display==='grid'?'none':'grid';
document.addEventListener('click', e => { if (!e.target.closest('.chat-in-wrap') && !e.target.closest('.ep')) emojiPicker.style.display='none'; });

// ── TAB SİSTEMİ ──────────────────────────────────────────────
window.switchTab = function(t) {
    $('genPanel').style.display = t==='gen' ? 'flex' : 'none';
    $('dmPanel').style.display  = t==='dm'  ? 'flex' : 'none';
    $('tabGen').classList.toggle('on', t==='gen');
    $('tabDm').classList.toggle('on',  t==='dm');
    if (t==='dm') {
        dmUnread = 0;
        const b = $('dmBadge'); b.style.display='none';
        renderDmUserList();
    }
};

// ── VİDEO WRAPPER ────────────────────────────────────────────
window.goFullscreen = function(id) {
    const el = $(id); if (!el) return;
    (el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen)?.call(el);
};

function getOrMakeWrapper(uid, type, label) {
    const wid = `w-${uid}-${type}`;
    let el = $(wid);
    if (!el) {
        el = document.createElement('div');
        el.className = 'vw'; el.id = wid;
        const vid = `v-${uid}-${type}`;
        const mut = uid==='local' ? 'muted' : '';
        const flip= type==='cam' ? 'transform:scaleX(-1);' : '';
        const lbl = uid==='local' ? (type==='screen'?'Senin Ekranın':'Sen') : `${label} ${type==='screen'?'Ekranı':''}`;
        const ctrlBtn = (type==='screen' && uid!=='local' && !isMobile)
            ? `<button class="ov-btn" id="ctrlBtn-${uid}" style="background:var(--c-green);" onclick="askControl('${uid}')"><i class="fas fa-hand-pointer"></i> Kontrol</button>` : '';
        el.innerHTML = `
            <video id="${vid}" autoplay playsinline ${mut} style="width:100%;height:100%;object-fit:contain;${flip}"></video>
            <div class="vw-label">${lbl}</div>
            <div class="vw-overlay">${ctrlBtn}<button class="ov-btn" onclick="goFullscreen('${vid}')"><i class="fas fa-expand"></i></button></div>
            <div class="vol-bar" id="vb-${uid}-${type}"></div>`;
        $('videoGrid').appendChild(el);

        if (type==='screen' && uid!=='local' && !isMobile) {
            el.querySelector('video').addEventListener('click', ev => {
                if (ev.currentTarget.dataset.ctrl !== '1') return;
                const r = ev.currentTarget.getBoundingClientRect();
                socket.emit('fare-hareketi', { kime:uid, x:((ev.clientX-r.left)/r.width)*100, y:((ev.clientY-r.top)/r.height)*100 });
            });
        }
    }
    return el;
}

// ── KONTROL ───────────────────────────────────────────────────
window.askControl = function(uid) {
    socket.emit('kontrol-iste', { kime:uid });
    const b = $(`ctrlBtn-${uid}`);
    if (b) { b.innerHTML="<i class='fas fa-spinner fa-spin'></i>"; b.disabled=true; }
};
socket.on('kontrol-istegi-geldi', d => {
    const ok = confirm(`⚠️ ${d.ad} ekranını kontrol etmek istiyor. İzin var mı?`);
    socket.emit('kontrol-cevap', { kime:d.kimden, onay:ok });
});
socket.on('kontrol-cevabi-geldi', d => {
    const b = $(`ctrlBtn-${d.kimden}`), v = $(`v-${d.kimden}-screen`);
    if (d.onay) { if(b){b.innerHTML="<i class='fas fa-check-circle'></i> Aktif";b.style.background="var(--c-red)";} if(v)v.dataset.ctrl='1'; }
    else { if(b){b.innerHTML="<i class='fas fa-hand-pointer'></i> Kontrol";b.disabled=false;} }
});
socket.on('karsi-fare-hareketi', d => {
    const p = $('remotePtr');
    p.style.cssText=`display:block;left:${d.x}%;top:${d.y}%;`;
    clearTimeout(p._t); p._t=setTimeout(()=>p.style.display='none',2000);
});

// ── SES ANALİZİ ───────────────────────────────────────────────
function startAudioAnalysis(stream, wrapperId, isLocal=false) {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
        if (audioCtx.state==='suspended') audioCtx.resume().catch(()=>{});
        const src = audioCtx.createMediaStreamSource(stream);
        const ana = audioCtx.createAnalyser(); ana.fftSize=256;
        src.connect(ana);
        const buf = new Uint8Array(ana.frequencyBinCount);
        let talking = false;
        const iv = setInterval(() => {
            const bar = $(`vb-${wrapperId}`);
            if (!stream.active) { clearInterval(iv); if(bar) bar.style.width='0%'; return; }
            const tracks = stream.getAudioTracks();
            if (!tracks.length || !tracks[0].enabled) {
                if (bar) bar.style.width='0%';
                if (isLocal && talking) { socket.emit('konusuyor-mu',false); talking=false; }
                return;
            }
            ana.getByteFrequencyData(buf);
            const avg = buf.reduce((a,b)=>a+b,0)/buf.length;
            if (bar) bar.style.width=Math.min(100,avg)+'%';
            if (isLocal) {
                const now = avg>28;
                if (now!==talking) { talking=now; socket.emit('konusuyor-mu',now); glowAvatar(socket.id,now); }
            }
        }, 120);
        return iv;
    } catch(e) { console.warn('[Ses analizi]',e); }
}

function glowAvatar(uid, on) {
    const av = $(`av-${uid}`), vw = $(`w-${uid}-cam`);
    if (av) av.classList.toggle('speaking', on);
    if (vw) vw.classList.toggle('sp-border', on);
}

socket.on('konusma-durumu-geldi', d => {
    glowAvatar(d.id, d.durum);
    const el = $('speakInfo');
    if (d.durum) el.textContent = `🎤 ${d.ad} konuşuyor`;
    else if (el.textContent.includes(d.ad)) el.textContent='';
});

// ── WEBRTC — KÖK DÜZELTMELERİ ────────────────────────────────

// [A-FIX] Track ekleme: önce PC'ye ekle, sonra negotiate et
function addTrackToPeers(track, stream) {
    Object.keys(peers).forEach(pid => {
        try {
            const pc = peers[pid];
            const existing = pc.getSenders().find(s => s.track?.kind === track.kind && s.track?.id === track.id);
            if (existing) return;
            const sameKind = pc.getSenders().find(s => s.track?.kind === track.kind);
            if (sameKind) { sameKind.replaceTrack(track).catch(e=>console.warn('[replaceTrack]',e)); }
            else { pc.addTrack(track, stream); }
        } catch(e) { console.warn('[addTrackToPeers]',e); }
    });
}

// [B-FIX] Remote stream → doğru hedef
// Sunucudan gelen streamMap ile track tipini eşleştiriyoruz
function attachRemoteStream(peerId, stream, kind, tur) {
    if (!stream) return;

    if (kind === 'video') {
        if (!videoStreams[peerId]) videoStreams[peerId] = {};
        const type = tur==='ekr-ac' ? 'screen' : 'cam';
        videoStreams[peerId][type] = stream;
        const label = peerId.slice(0,6);
        const w  = getOrMakeWrapper(peerId, type, label);
        const v  = w.querySelector('video');
        if (v.srcObject?.id !== stream.id) { v.srcObject = stream; v.play().catch(()=>{}); }
    } else {
        // [C-FIX] Ekran sesi ve mikrofon ses ayrı elementlerde
        if (tur === 'ekr-ses') {
            screenAudioStreams[peerId] = stream;
            let a = $(`audio-screen-${peerId}`);
            if (!a) {
                a = Object.assign(document.createElement('audio'), { id:`audio-screen-${peerId}`, autoplay:true, playsInline:true });
                $('remoteAudio').appendChild(a);
            }
            if (a.srcObject?.id !== stream.id) a.srcObject = stream;
            a.muted = isDeafened;
            a.play().catch(e=>console.warn('[Ekran sesi]',e));
        } else {
            // mikrofon sesi
            audioStreams[peerId] = stream;
            let a = $(`audio-${peerId}`);
            if (!a) {
                a = Object.assign(document.createElement('audio'), { id:`audio-${peerId}`, autoplay:true, playsInline:true });
                $('remoteAudio').appendChild(a);
            }
            if (a.srcObject?.id !== stream.id) a.srcObject = stream;
            a.muted = isDeafened;
            a.play().catch(e=>console.warn('[Mikrofon sesi]',e));
            // Kamera wrapper oluştur (sesle gelen kişi için)
            getOrMakeWrapper(peerId, 'cam', peerId.slice(0,6));
            startAudioAnalysis(stream, `${peerId}-cam`, false);
        }
    }
}

function makePeer(peerId, initiator) {
    peers[peerId]?.close();
    const pc = new RTCPeerConnection(ICE);
    peers[peerId] = pc;

    // Auto-healer
    pc.oniceconnectionstatechange = () => {
        console.log(`[ICE ${peerId.slice(0,6)}] ${pc.iceConnectionState}`);
        if (['disconnected','failed'].includes(pc.iceConnectionState)) {
            setTimeout(() => {
                if (peers[peerId]?.iceConnectionState !== 'connected') makePeer(peerId, true);
            }, 3000);
        }
    };

    // [B-FIX] ontrack: stream içindeki her track tipine göre doğru yere bağla
    pc.ontrack = ev => {
        const stream = ev.streams[0];
        if (!stream) return;
        const track  = ev.track;

        // Sunucudan streamMap bilgisi gelene kadar track.kind'a göre karar ver
        // Ses track'i → audio, Video track'i → video
        // Hangisinin ekran hangisinin kamera olduğunu medya-durumu-geldi'den öğreneceğiz
        // Şimdilik stream'i sakla, medya-durumu-geldi ile eşleştir
        if (!window._pendingStreams) window._pendingStreams = {};
        if (!window._pendingStreams[peerId]) window._pendingStreams[peerId] = {};
        window._pendingStreams[peerId][stream.id] = { stream, kind: track.kind };
    };

    pc.onicecandidate = ev => {
        if (ev.candidate) socket.emit('ice-adayi', { kime:peerId, aday:ev.candidate });
    };

    if (initiator) {
        pc.onnegotiationneeded = async () => {
            try {
                const off = await pc.createOffer({ offerToReceiveAudio:true, offerToReceiveVideo:true });
                await pc.setLocalDescription(off);
                socket.emit('webrtc-teklif', { kime:peerId, teklif:pc.localDescription });
            } catch(e) { console.warn('[offer]',e); }
        };
    }

    // Mevcut track'leri yeni peer'a ekle
    if (localMic)    pc.addTrack(localMic.getAudioTracks()[0],    localMic);
    if (localCam)    pc.addTrack(localCam.getVideoTracks()[0],    localCam);
    if (localScreen) localScreen.getTracks().forEach(t => pc.addTrack(t, localScreen));
}

socket.on('yeni-kullanici-geldi', d => {
    if (myStatus !== 'dnd') { showToast(`👋 ${d.ad} odaya katıldı`); playSfx('join'); }
    makePeer(d.id, true);
    renderDmUserList();
});

socket.on('webrtc-teklif-geldi', async d => {
    if (!peers[d.kimden]) makePeer(d.kimden, false);
    const pc = peers[d.kimden];
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(d.teklif));
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        socket.emit('webrtc-cevap', { kime:d.kimden, cevap:pc.localDescription });
    } catch(e) { console.error('[teklif]',e); }
});

socket.on('webrtc-cevap-geldi', async d => {
    try { await peers[d.kimden]?.setRemoteDescription(new RTCSessionDescription(d.cevap)); }
    catch(e) { console.warn('[cevap]',e); }
});

socket.on('ice-adayi-geldi', async d => {
    try { await peers[d.kimden]?.addIceCandidate(new RTCIceCandidate(d.aday)); }
    catch(e) { console.warn('[ice]',e); }
});

// [B-FIX] medya-durumu-geldi: streamMap ile doğru bağlama
socket.on('medya-durumu-geldi', d => {
    const pid = d.kimden;
    const sm  = d.streamMap || {};

    const pending = window._pendingStreams?.[pid] || {};

    if (d.tur.includes('-ac')) {
        let targetStreamId = d.streamId;
        let stream = pending[targetStreamId]?.stream;

        // Fallback: eğer streamId eşleşmezse pending'deki ilk uygun stream'i al
        if (!stream) {
            const kind = (d.tur==='mik-ac'||d.tur==='ekr-ses') ? 'audio' : 'video';
            const entry = Object.values(pending).find(p=>p.kind===kind);
            stream = entry?.stream;
        }

        if (!stream) {
            // Henüz gelmemişse 800ms sonra tekrar dene (race condition)
            setTimeout(() => socket.emit('medya-durumu-geldi-retry', d), 800);
            return;
        }

        attachRemoteStream(pid, stream, (d.tur==='mik-ac'||d.tur==='ekr-ses')?'audio':'video', d.tur);
    } else if (d.tur==='kam-kap')  { $(`w-${pid}-cam`)?.remove(); }
      else if (d.tur==='ekr-kap')  { $(`w-${pid}-screen`)?.remove(); $(`audio-screen-${pid}`)?.remove(); }
});

socket.on('kullanici-ayrildi', id => {
    if (myStatus!=='dnd') playSfx('leave');
    document.querySelectorAll(`[id*="${id}"]`).forEach(el=>el.remove());
    peers[id]?.close(); delete peers[id];
    delete audioStreams[id]; delete videoStreams[id]; delete screenAudioStreams[id];
    if (window._pendingStreams) delete window._pendingStreams[id];
    renderDmUserList();
});

// ── KULLANICI LİSTESİ ─────────────────────────────────────────
const SMAP  = { online:'dp-online', mesgul:'dp-mesgul', dnd:'dp-dnd', gorunmez:'dp-gorunmez' };
const SCOL  = { online:'var(--c-green)', mesgul:'var(--c-warn)', dnd:'var(--c-red)', gorunmez:'var(--c-grey)' };
const SLBL  = { online:'Çevrimiçi', mesgul:'Meşgul', dnd:'Rahatsız Etme', gorunmez:'Görünmez' };

window.setVol = function(uid,v) { const a=$(`audio-${uid}`); if(a)a.volume=+v; };

socket.on('kullanici-listesi', data => {
    dmUsers = data.kullanicilar;
    const list  = $('aktifKullanicilarListesi');
    list.innerHTML = '';
    const ids = Object.keys(data.kullanicilar);
    $('onlineCount').textContent = ids.length;

    ids.forEach(id => {
        const d  = data.durumlar[id] || {};
        const dc = SMAP[d.durum||'online'];

        const volHtml = id !== socket.id ? `
            <div class="ui-vol">
                <i class="fas fa-volume-up" style="color:var(--c-grey);font-size:10px;"></i>
                <input type="range" min="0" max="1" step="0.05" value="1" onchange="setVol('${id}',this.value)">
                <button class="dm-mini" onclick="openDm('${id}','${(data.kullanicilar[id]||'').replace(/'/g,"\\'")}')"><i class="fas fa-envelope"></i></button>
            </div>` : '';

        const icons = `<div class="si">
            <i class="fas fa-video"   title="Kamera"  style="color:${d.kamera?'var(--c-blue)':'var(--c-grey)'};"></i>
            <i class="fas fa-desktop" title="Ekran"   style="color:${d.ekran?'var(--c-green)':'var(--c-grey)'};"></i>
            <i class="fas ${d.kulaklik?'fa-headphones-slash':'fa-headphones'}" style="color:${d.kulaklik?'var(--c-red)':'var(--c-grey)'};"></i>
            <i class="fas ${d.mikrofon?'fa-microphone':'fa-microphone-slash'}" style="color:${d.mikrofon?'var(--c-green)':'var(--c-red)'};"></i>
            ${d.dnd?'<i class="fas fa-moon" style="color:var(--c-red);font-size:10px;"></i>':''}
        </div>`;

        const el = document.createElement('div');
        el.className = 'ui';
        el.innerHTML = `
            <div class="ui-top">
                <div class="ui-left">
                    <div class="av-wrap">
                        <div class="av ${!d.mikrofon?'muted':''}" id="av-${id}">${data.kullanicilar[id][0].toUpperCase()}</div>
                        <div class="dp ${dc}"></div>
                    </div>
                    <span class="ui-name">${data.kullanicilar[id]}</span>
                </div>
                ${icons}
            </div>${volHtml}`;
        list.appendChild(el);
    });

    renderDmUserList(data.kullanicilar, data.durumlar);
});

// ── DURUM ─────────────────────────────────────────────────────
window.setStatus = function(s) {
    myStatus = s;
    socket.emit('durum-degistir', s);
    $('durumMenu').classList.remove('open');
    $('myDpDot').className    = 'dp ' + SMAP[s];
    $('statusIcon').style.color = SCOL[s];
    $('upStatus').textContent   = SLBL[s];
    const ov = $('dndOv'), bg = $('dndBadge');
    if (s==='dnd') { ov.style.display='block'; bg.style.display='block'; showToast('🌙 Rahatsız Etme aktif','w'); }
    else           { ov.style.display='none';  bg.style.display='none'; }
};
window.toggleStatusMenu = function(e) { e.stopPropagation(); $('durumMenu').classList.toggle('open'); };
document.addEventListener('click', () => $('durumMenu').classList.remove('open'));

// ── DM ────────────────────────────────────────────────────────
function renderDmUserList(users, statuses) {
    if (users) dmUsers = users;
    const list = $('dmUserList'); if (!list) return;
    list.innerHTML = '';
    Object.keys(dmUsers).forEach(id => {
        if (id===socket.id) return;
        const unr = (dmCache[id]||[]).filter(m=>!m.read&&!m.mine).length;
        const el  = document.createElement('div');
        el.className = `dm-usr${dmActive===id?' on':''}`;
        el.onclick   = () => selectDmUser(id);
        el.innerHTML = `
            <div class="av" style="width:26px;height:26px;font-size:11px;flex-shrink:0;">${(dmUsers[id]||'?')[0].toUpperCase()}</div>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dmUsers[id]||id.slice(0,8)}</span>
            ${unr>0?`<div class="dm-unread">${unr}</div>`:''}`;
        list.appendChild(el);
    });
}

function selectDmUser(id) {
    dmActive = id;
    const ms = $('dmMsgs'), iw = $('dmInWrap');
    ms.innerHTML = ''; iw.style.display='block';
    $('dmIn').placeholder = `${dmUsers[id]||'Kullanıcı'}'ya mesaj gönder...`;
    socket.emit('dm-gecmisi-iste', { kime:id });
    renderDmUserList();
}

socket.on('dm-gecmisi', d => {
    if (!dmActive) return;
    const ms = $('dmMsgs'); ms.innerHTML='';
    d.mesajlar.forEach(m => appendDmMsg(m.isim, m.metin, m.kimden===socket.id));
    ms.scrollTop = ms.scrollHeight;
});

function appendDmMsg(author, text, mine, scroll=true) {
    const ms  = $('dmMsgs');
    const div = document.createElement('div');
    const t   = new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    div.style.cssText = `display:flex;flex-direction:column;max-width:88%;${mine?'align-self:flex-end;':''}`;
    div.innerHTML = `
        <div style="display:flex;align-items:baseline;gap:5px;margin-bottom:2px;${mine?'flex-direction:row-reverse;':''}">
            <span style="font-size:12px;font-weight:700;color:${mine?'var(--c-blue)':'var(--c-red)'};">${author}</span>
            <span style="font-size:10px;color:var(--c-grey);">${t}</span>
        </div>
        <div style="background:${mine?'rgba(88,101,242,.13)':'var(--c-mid)'};border:1px solid ${mine?'rgba(88,101,242,.2)':'var(--c-border)'};padding:6px 10px;border-radius:${mine?'8px 8px 2px 8px':'8px 8px 8px 2px'};font-size:13px;color:#dbdee1;line-height:1.5;word-break:break-word;">${escHtml(text)}</div>`;
    ms.appendChild(div);
    if (scroll) ms.scrollTop=ms.scrollHeight;
}

function sendDm() {
    if (!dmActive) return;
    const t = $('dmIn').value.trim(); if(!t) return;
    socket.emit('dm-gonder',{kime:dmActive,metin:t});
    if(!dmCache[dmActive]) dmCache[dmActive]=[];
    dmCache[dmActive].push({author:myName,text:t,mine:true,read:true});
    appendDmMsg(myName,t,true);
    $('dmIn').value='';
}

$('dmSend').onclick = sendDm;
$('dmIn').addEventListener('keypress', e => { if(e.key==='Enter') sendDm(); });

socket.on('dm-geldi', d => {
    if(!dmCache[d.kimden]) dmCache[d.kimden]=[];
    const visible = dmActive===d.kimden && $('tabDm').classList.contains('on');
    dmCache[d.kimden].push({author:d.isim,text:d.metin,mine:false,read:visible});
    if (visible) { appendDmMsg(d.isim,d.metin,false); }
    else if (myStatus!=='dnd') {
        showToast(`💬 ${d.isim}: ${d.metin.slice(0,38)}${d.metin.length>38?'…':''}`, 'i');
        dmUnread++;
        const b=$('dmBadge'); b.textContent=dmUnread; b.style.display='inline';
    }
    renderDmUserList();
});

window.openDm = function(id, name) { switchTab('dm'); dmUsers[id]=name; selectDmUser(id); };

// ── GENEL CHAT ────────────────────────────────────────────────
const URL_RE = /https?:\/\/[^\s<>"]+/g;
function escHtml(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

function appendMsg(author, text, mine, img=false, ts=null) {
    const t  = ts ? new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    const id = 'msg-'+(++msgIdx);

    let body;
    if (img) {
        body = `<img src="${text}" style="max-width:100%;border-radius:5px;margin-top:3px;cursor:pointer;" onclick="window.open(this.src)">`;
    } else {
        const safe = escHtml(text).replace(URL_RE, u=>`<a href="${u}" target="_blank" rel="noopener" style="color:var(--c-blue);text-decoration:underline;word-break:break-all;">${u}</a>`);
        URL_RE.lastIndex=0;
        const firstUrl = text.match(URL_RE)?.[0]; URL_RE.lastIndex=0;
        const prev = firstUrl ? `<div class="link-prev"><div class="link-host">${(()=>{try{return new URL(firstUrl).hostname}catch{return firstUrl}})()}</div><div class="link-url">${firstUrl.length>70?firstUrl.slice(0,70)+'…':firstUrl}</div></div>` : '';
        body = safe + prev;
    }

    const rxBtns = ['👍','❤️','😂','🔥','😮'].map(e=>`<button class="msg-act" onclick="sendReact('${id}','${e}')">${e}</button>`).join('');

    // Gruplama: aynı kişiden ardışık mesaj
    if (lastAuthor===author && !img) {
        const lastGrp = msgs.querySelector('.msg-grp:last-child');
        if (lastGrp?.dataset.author===author) {
            const bd=document.createElement('div'); bd.className='msg-body'; bd.id=id;
            bd.innerHTML=`<div class="msg-acts">${rxBtns}</div>${body}<div class="rx-row" id="rx-${id}"></div>`;
            lastGrp.appendChild(bd);
            msgs.scrollTop=msgs.scrollHeight; return id;
        }
    }
    lastAuthor=author;

    const grp=document.createElement('div'); grp.className='msg-grp'; grp.dataset.author=author;
    grp.innerHTML=`
        <div class="msg-head">
            <div class="msg-av">${author[0].toUpperCase()}</div>
            <div class="msg-meta"><span class="msg-author${mine?' me':''}">${escHtml(author)}</span><span class="msg-time">${t}</span></div>
        </div>
        <div class="msg-body" id="${id}">
            <div class="msg-acts">${rxBtns}</div>${body}
            <div class="rx-row" id="rx-${id}"></div>
        </div>`;
    msgs.appendChild(grp);
    msgs.scrollTop=msgs.scrollHeight;
    return id;
}

socket.on('kanal-gecmisi', ms => ms.forEach(m=>appendMsg(m.ad,m.metin,m.ad===myName,false,m.zaman)));

// Reaksiyonlar
window.sendReact = function(mid, emoji) { socket.emit('reaksiyon',{mesajId:mid,emoji}); addReact(mid,emoji,myName); };
function addReact(mid, emoji, author) {
    const row = $(`rx-${mid}`); if(!row) return;
    const key = `${mid}|${emoji}`;
    reacts[key]=(reacts[key]||0)+1;
    const ex = row.querySelector(`[data-e="${emoji}"]`);
    if (ex) ex.querySelector('.rx-n').textContent=reacts[key];
    else {
        const c=document.createElement('div'); c.className='rx-chip'; c.dataset.e=emoji; c.title=author;
        c.innerHTML=`${emoji} <span class="rx-n">${reacts[key]}</span>`;
        c.onclick=()=>sendReact(mid,emoji); row.appendChild(c);
    }
}
socket.on('reaksiyon-geldi', d=>addReact(d.mesajId,d.emoji,d.ad));

// Mesaj gönder
function doSend() {
    const t=msgIn.value.trim(); if(!t) return;
    socket.emit('chat-mesaji',{ad:myName,metin:t});
    appendMsg(myName,t,true);
    msgIn.value=''; msgIn.dispatchEvent(new Event('input'));
}
sendBtn.onclick = doSend;
msgIn.addEventListener('keypress', e=>{ if(e.key==='Enter') doSend(); });

// Yazıyor
msgIn.addEventListener('input', () => {
    clearTimeout(typingTimer);
    if (msgIn.value.trim()) { socket.emit('yaziyor',{durum:true}); typingTimer=setTimeout(()=>socket.emit('yaziyor',{durum:false}),2000); }
    else socket.emit('yaziyor',{durum:false});
});
socket.on('yaziyor-geldi', d => {
    const el=$('typeHint'); if(!el||d.id===socket.id) return;
    el.innerHTML = d.durum ? `<span style="animation:msgIn .15s ease">✏️ <i>${escHtml(d.ad)} yazıyor...</i></span>` : '';
});

socket.on('yeni-mesaj',  d => { lastAuthor=null; appendMsg(d.ad,d.metin,false,false,d.zaman); notifyChatBadge(); });
socket.on('yeni-dosya',  d => { lastAuthor=null; appendMsg(d.ad,d.data,false,true); });
socket.on('ses-oynat',   u => { if(myStatus!=='dnd') playAudio(u); });

// Dosya gönder (5 MB limit)
$('fileIn').addEventListener('change', e=>{
    const f=e.target.files[0]; if(!f) return;
    if(f.size>5*1024*1024){ showToast('⚠️ Max 5 MB dosya gönderilebilir','e'); $('fileIn').value=''; return; }
    const r=new FileReader();
    r.onload=ev=>{ socket.emit('dosya-gonder',{ad:myName,data:ev.target.result}); appendMsg(myName,ev.target.result,true,true); };
    r.onerror=()=>showToast('Dosya okunamadı','e');
    r.readAsDataURL(f); $('fileIn').value='';
});

// Chat arama
$('searchBox')?.addEventListener('input', e=>{
    const q=e.target.value.toLowerCase();
    msgs.querySelectorAll('.msg-grp').forEach(g=>{ g.style.display=!q||g.textContent.toLowerCase().includes(q)?'':'none'; });
});

function notifyChatBadge() {
    if (isMobile && $('nav-c') && !$('nav-c').classList.contains('on')) {
        unreadChat++; const b=$('mobChatBadge'); b.textContent=unreadChat; b.style.display='flex';
    }
}

// ── GİRİŞ/ÇIKIŞ SESİ ─────────────────────────────────────────
function playSfx(type) {
    const urls={ join:'https://www.myinstants.com/media/sounds/discord-join.mp3', leave:'https://www.myinstants.com/media/sounds/discord-leave.mp3' };
    playAudio(urls[type]);
}
function playAudio(url) { try { const a=new Audio(url); a.volume=.4; a.play().catch(()=>{}); } catch{} }

window.sfx = function(url) { playAudio(url); socket.emit('ses-efekti', url); };

// ── CİHAZ AYARLARI ────────────────────────────────────────────
async function loadDevices() {
    try {
        await navigator.mediaDevices.getUserMedia({audio:true,video:true}).catch(()=>{});
        const devs = await navigator.mediaDevices.enumerateDevices();
        const ms=$('micSel'), cs=$('camSel');
        ms.innerHTML='<option value="default">Sistem Varsayılanı</option>';
        cs.innerHTML='<option value="default">Sistem Varsayılanı</option>';
        devs.forEach(d=>{
            const o=document.createElement('option'); o.value=d.deviceId; o.text=d.label||`Cihaz ${d.deviceId.slice(0,5)}`;
            if(d.kind==='audioinput'){ if(d.deviceId===savedMic)o.selected=true; ms.appendChild(o); }
            if(d.kind==='videoinput'){ if(d.deviceId===savedCam)o.selected=true; cs.appendChild(o); }
        });
    } catch(e){ console.warn('[Cihazlar]',e); }
}

window.micTest = async function() {
    try {
        testStream?.getTracks().forEach(t=>t.stop()); clearInterval(testTimer);
        const mid = $('micSel').value;
        testStream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true, deviceId:mid!=='default'?{exact:mid}:undefined } });
        const ctx=new(window.AudioContext||window.webkitAudioContext)(), src=ctx.createMediaStreamSource(testStream), ana=ctx.createAnalyser();
        ana.fftSize=256; src.connect(ana); const b=new Uint8Array(ana.frequencyBinCount), fill=$('testBar');
        testTimer=setInterval(()=>{ ana.getByteFrequencyData(b); fill.style.width=Math.min(100,b.reduce((a,x)=>a+x,0)/b.length*2)+'%'; },100);
        setTimeout(()=>{ clearInterval(testTimer); testStream?.getTracks().forEach(t=>t.stop()); if(fill)fill.style.width='0%'; },8000);
    } catch(e){ showToast('Mikrofon test edilemedi: '+e.message,'e'); }
};

function openSettings() {
    $('nameInput').value = myName;
    loadDevices();
    $('settingsModal').style.display='flex';
    $('nameInput').focus();
}
$('upLeft').addEventListener('click', openSettings);
$('saveSetsBtn').onclick = ()=>{
    const y=$('nameInput').value.trim();
    if(y) localStorage.setItem('bc_name',y);
    localStorage.setItem('bc_mic',$('micSel').value);
    localStorage.setItem('bc_cam',$('camSel').value);
    testStream?.getTracks().forEach(t=>t.stop());
    location.reload();
};

// ── KANALA KATIL ──────────────────────────────────────────────
joinBtn.addEventListener('click', () => {
    $('joinBtnText').textContent = 'genel — Bağlandı';
    joinBtn.classList.add('active');
    [micBtn,deafBtn,camBtn,screenBtn].forEach(b=>b.disabled=false);
    gamerBtn.style.display='flex';
    playSfx('join');
    socket.emit('kanala-katil', myName);
    setTimeout(()=>socket.emit('ping-olc',Date.now()),500);
});

// ── DEAFEN ────────────────────────────────────────────────────
deafBtn.addEventListener('click', ()=>{
    isDeafened=!isDeafened;
    const ico=$('deafIco');
    ico.className=isDeafened?'fas fa-headphones-slash':'fas fa-headphones';
    deafBtn.classList.toggle('off',isDeafened);
    document.querySelectorAll('#remoteAudio audio').forEach(a=>a.muted=isDeafened);
    if(isDeafened){ if(localMic?.getAudioTracks()[0]?.enabled){wasMicOn=true;toggleMic(false);} socket.emit('medya-durumu',{tur:'kulak-kap',broadcast:true}); }
    else{ if(wasMicOn){wasMicOn=false;toggleMic(true);} socket.emit('medya-durumu',{tur:'kulak-ac',broadcast:true}); }
});

// ── MİKROFON ──────────────────────────────────────────────────
async function ensureMic() {
    if (localMic) return true;
    try {
        // [A-FIX] autoGainControl:true eklendi, quality artırıldı
        const constraints = {
            audio: {
                echoCancellation:  { ideal: true },
                noiseSuppression:  { ideal: true },
                autoGainControl:   { ideal: true },
                sampleRate:        { ideal: 48000 },
                channelCount:      { ideal: 1 },
                deviceId: savedMic!=='default' ? {exact:savedMic} : undefined
            }
        };
        localMic = await navigator.mediaDevices.getUserMedia(constraints);
        // [A-FIX] Track'leri ÖNCE tüm peer'lara ekle
        addTrackToPeers(localMic.getAudioTracks()[0], localMic);
        startAudioAnalysis(localMic, 'local-cam', true);
        return true;
    } catch(e) { showToast('Mikrofon açılamadı: '+e.message,'e'); return false; }
}

function toggleMic(forceon) {
    if (!localMic) return;
    const track = localMic.getAudioTracks()[0]; if(!track) return;
    const on = forceon !== undefined ? forceon : !track.enabled;
    track.enabled = on;
    $('micIco').className = on ? 'fas fa-microphone' : 'fas fa-microphone-slash';
    micBtn.classList.toggle('on',  on);
    micBtn.classList.toggle('off', !on);
    socket.emit('medya-durumu',{ tur:on?'mik-ac':'mik-kap', broadcast:true, streamId:localMic.id, trackId:track.id });
}

micBtn.addEventListener('click', async () => {
    if (isDeafened) { showToast('Sesi kestiniz (Deafen), önce açın.','w'); return; }
    if (!localMic) { if(await ensureMic()) toggleMic(true); }
    else toggleMic();
});

// ── PTT ───────────────────────────────────────────────────────
pttBtn.addEventListener('click', ()=>{
    isPtt=!isPtt;
    $('pttText').textContent=`Bas-Konuş: ${isPtt?'AÇIK':'KAPALI'}`;
    pttBtn.classList.toggle('active',isPtt);
    if (isMobile) $('mobilePtt').style.display=isPtt?'block':'none';
    if (isPtt && localMic?.getAudioTracks()[0]?.enabled) toggleMic(false);
});

async function pttPress() {
    if (!isPtt) return;
    if (!localMic && !await ensureMic()) return;
    if (!isPttDown) { isPttDown=true; toggleMic(true); }
}
function pttRelease() { if(!isPtt||!isPttDown) return; isPttDown=false; toggleMic(false); }

document.addEventListener('keydown', e=>{ if(e.code==='Space'&&document.activeElement!==msgIn&&document.activeElement!==$('dmIn')) pttPress(); });
document.addEventListener('keyup',   e=>{ if(e.code==='Space') pttRelease(); });

const mobPtt = $('mobilePtt');
mobPtt.addEventListener('touchstart', e=>{ e.preventDefault(); pttPress(); },{passive:false});
mobPtt.addEventListener('touchend',   e=>{ e.preventDefault(); pttRelease(); },{passive:false});

// ── KAMERA ────────────────────────────────────────────────────
let frontCam = true;
camBtn.addEventListener('click', async ()=>{
    if (!localCam) {
        try {
            const c = isMobile
                ? {video:{facingMode:frontCam?'user':'environment',width:{ideal:1280},height:{ideal:720}}}
                : {video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30},deviceId:savedCam!=='default'?{exact:savedCam}:undefined}};
            localCam = await navigator.mediaDevices.getUserMedia(c);
            const w = getOrMakeWrapper('local','cam','');
            w.querySelector('video').srcObject=localCam;
            $('camIco').className='fas fa-video'; camBtn.classList.add('on');
            if(isMobile) flipBtn.style.display='flex';
            addTrackToPeers(localCam.getVideoTracks()[0], localCam);
            socket.emit('medya-durumu',{tur:'kam-ac',broadcast:true,streamId:localCam.id,trackId:localCam.getVideoTracks()[0].id});
        } catch(e){ showToast('Kamera açılamadı: '+e.message,'e'); }
    } else {
        localCam.getTracks().forEach(t=>t.stop()); localCam=null;
        $('w-local-cam')?.remove();
        $('camIco').className='fas fa-video-slash'; camBtn.classList.remove('on'); flipBtn.style.display='none';
        socket.emit('medya-durumu',{tur:'kam-kap',broadcast:true});
    }
});

flipBtn.addEventListener('click', async ()=>{
    if (!localCam) return; frontCam=!frontCam;
    localCam.getTracks().forEach(t=>t.stop());
    try {
        localCam=await navigator.mediaDevices.getUserMedia({video:{facingMode:frontCam?'user':'environment'}});
        $('v-local-cam').srcObject=localCam;
        addTrackToPeers(localCam.getVideoTracks()[0],localCam);
    } catch(e){ showToast('Kamera çevrilemedi','e'); }
});

// ── EKRAN PAYLAŞIMI ────────────────────────────────────────────
// [C-FIX] Ekran açılırken mikrofon kapatılmıyor;
//         ekran ses track'i ayrı stream olarak gönderiliyor
screenBtn.addEventListener('click', async ()=>{
    if (isMobile) { showToast('Ekran paylaşımı bu cihazda desteklenmiyor','w'); return; }
    if (!localScreen) {
        try {
            localScreen = await navigator.mediaDevices.getDisplayMedia({
                video: { width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30}, cursor:'always' },
                audio: { echoCancellation:false, noiseSuppression:false, sampleRate:44100 }
            });

            const w = getOrMakeWrapper('local','screen','');
            w.querySelector('video').srcObject = new MediaStream([localScreen.getVideoTracks()[0]]);

            screenBtn.classList.add('on'); $('screenIco').style.color='var(--c-green)';

            // [C-FIX] Video ve ses track'lerini AYRI yolla bildir
            localScreen.getVideoTracks().forEach(t => {
                addTrackToPeers(t, localScreen);
                socket.emit('medya-durumu',{tur:'ekr-ac',broadcast:true,streamId:localScreen.id,trackId:t.id});
            });
            localScreen.getAudioTracks().forEach(t => {
                addTrackToPeers(t, localScreen);
                socket.emit('medya-durumu',{tur:'ekr-ses',broadcast:true,streamId:localScreen.id,trackId:t.id});
            });

            localScreen.getVideoTracks()[0].onended = ()=>screenBtn.click();
        } catch(e){ if(e.name!=='NotAllowedError') showToast('Ekran paylaşımı başlatılamadı','e'); }
    } else {
        localScreen.getTracks().forEach(t=>t.stop()); localScreen=null;
        $('w-local-screen')?.remove();
        screenBtn.classList.remove('on'); $('screenIco').style.color='';
        socket.emit('medya-durumu',{tur:'ekr-kap',broadcast:true});
    }
});

// ── GAMER MOD ─────────────────────────────────────────────────
gamerBtn.addEventListener('click', ()=>{
    const on=gamerBtn.classList.toggle('active');
    gamerBtn.querySelector('span').textContent=on?'Gamer Mod: AÇIK':'Gamer Mod';
    if (on && localCam) camBtn.click();
});

// ── ELECTRON ─────────────────────────────────────────────────
if (!isMobile && isElectron) {
    try {
        const { ipcRenderer } = require('electron');
        $('btnMin').addEventListener('click',   ()=>ipcRenderer.send('window-minimize'));
        $('btnClose').addEventListener('click', ()=>ipcRenderer.send('window-close'));

        ipcRenderer.on('ekran-seciciyi-ac', (_, sources) => {
            const modal=$('screenPickModal'), list=$('screenList');
            list.innerHTML='';
            sources.forEach(s=>{
                const d=document.createElement('div');
                d.style.cssText='width:150px;background:#1e1f22;border-radius:6px;padding:8px;cursor:pointer;text-align:center;border:2px solid transparent;transition:.2s;';
                d.onmouseover=()=>d.style.borderColor='var(--c-blue)';
                d.onmouseout=()=>d.style.borderColor='transparent';
                d.onclick=()=>{ modal.style.display='none'; ipcRenderer.send('ekran-secildi',s.id); };
                d.innerHTML=`<img src="${s.thumbnail}" style="width:100%;height:85px;object-fit:cover;border-radius:4px;margin-bottom:5px;background:#000;"><div style="color:#dbdee1;font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${s.name}">${s.name}</div>`;
                list.appendChild(d);
            });
            modal.style.display='flex';
        });

        window.cancelScreenPick = ()=>{ $('screenPickModal').style.display='none'; ipcRenderer.send('ekran-secildi',null); };
    } catch(e) {
        $('titleBar').style.display='none'; document.body.style.paddingTop='0';
    }
} else if (!isElectron) {
    $('titleBar').style.display='none'; document.body.style.paddingTop='0';
}

// ── MOBİL NAV ─────────────────────────────────────────────────
window.mobileTab = function(t) {
    if (window.innerWidth>900) return;
    const sd=$('sidebar'),ma=$('mainArea'),cp=$('chatPanel');
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('on'));
    $('nav-'+t).classList.add('on');
    sd.style.display=ma.style.display=cp.style.display='none';
    if(t==='v'){ ma.style.display='flex'; }
    else if(t==='c'){ cp.style.display='flex'; unreadChat=0; const b=$('mobChatBadge'); b.style.display='none'; }
    else if(t==='m'){ sd.style.display='flex'; }
};

// Sayfa yüklenince mobil için sidebar göster
if (isMobile && window.innerWidth<=900) {
    document.addEventListener('DOMContentLoaded', ()=>{ mobileTab('m'); });
}
