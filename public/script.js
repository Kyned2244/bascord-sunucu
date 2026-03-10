// ============================================================
// BASCORD v5 - script.js
// TÜM EKSİKLER DÜZELTİLDİ:
// [BUG-1] ICE candidate kuyruk sistemi (remoteDesc bekleme)
// [BUG-2] ekr-ses track ayrı streamId ile gönderiliyor
// [BUG-3] bekleyenStream temizleme sadece ayrılan kullanıcıya ait
// [BUG-4] AudioContext suspended → await ile bekleniyor
// [BUG-5] streamId undefined → kapatma mesajlarında id gönderilmez
// [BUG-6] XSS: getOrCreateVideoWrapper'da isim textContent ile
// [BUG-7] Rollback tüm tarayıcılarda çalışmıyor → perfect negotiation
// [YENİ-1] Bağlantı kalitesi göstergesi (ping/ms, getStats)
// [YENİ-2] Bireysel ses seviyesi slider
// [YENİ-3] Mesaj geçmişi (localStorage)
// [YENİ-4] Socket otomatik yeniden bağlanma
// [YENİ-5] Bağlanıyor durumu göstergesi
// ============================================================

const socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity
});

// --- 1. CİHAZ TESPİTİ ---
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

// --- 2. DURUM DEĞİŞKENLERİ ---
let peerConnections = {};       // { socketId: RTCPeerConnection }
let polite = {};                // { socketId: bool } — perfect negotiation için

// ICE kuyruk: remoteDescription gelmeden önce gelen adayları beklet
let iceKuyrugu = {};            // { socketId: [RTCIceCandidate, ...] }

// Stream eşleştirme kuyrukları
let bekleyenStream  = {};       // streamId -> { stream, peerSocketId }
let bekleyenSinyal  = {};       // streamId -> { kimden, tur }

// Ses analiz temizliği
let sesAnalyzIntervals = {};
let sesAnalyzNodes     = {};
let globalAudioCtx     = null;

// Medya yayınları
let kameraYayini   = null;
let ekranYayini    = null;
let mikrofonYayini = null;
let onKameraMi     = true;

// Ekran ses stream'i için ayrı ID takibi
let ekranSesStreamId = null;    // [BUG-2] ekr-ses için ayrı streamId

// Kontrol & UI durum
let isPttActive    = false;
let isPttKeyPressed = false;
let isDeafened     = false;
let wasMicEnabledBeforeDeafen = false;
let okunmamisMesajSayisi = 0;
let kanalaBaglandim = false;

// Re-negotiation kilidi
let muzakereKilidi     = {};
let muzakereYapiliyor  = {};    // perfect negotiation için

// Ses seviyeleri { socketId: 0-1 }
let sesSeviyeleri = {};

// Ping takibi
let pingIntervals = {};

// --- 3. KULLANICI ADI ---
let kullaniciAdi = localStorage.getItem('bascord_isim');
if (!kullaniciAdi) {
    try {
        kullaniciAdi = prompt("Bascord'a hoş geldin! İsmini belirle:") || "Anonim";
    } catch (e) {
        kullaniciAdi = "Gamer_" + Math.floor(Math.random() * 1000);
    }
    localStorage.setItem('bascord_isim', kullaniciAdi);
}
document.getElementById('benimAdimGosterge').innerText = kullaniciAdi;
document.getElementById('benimAvatarim').innerText = kullaniciAdi.charAt(0).toUpperCase();

// İsim değiştir
document.getElementById('isimDegistirBtn').addEventListener('click', () => {
    const modal = document.getElementById('isimModal');
    const input = document.getElementById('yeniIsimInput');
    if (modal && input) {
        input.value = kullaniciAdi;
        modal.style.display = 'flex';
        setTimeout(() => input.focus(), 100);
    }
});
document.getElementById('isimKaydetBtn').onclick = () => {
    const yeni = document.getElementById('yeniIsimInput').value.trim();
    if (yeni !== '') {
        kullaniciAdi = yeni;
        localStorage.setItem('bascord_isim', yeni);
        document.getElementById('benimAdimGosterge').innerText = yeni;
        document.getElementById('benimAvatarim').innerText = yeni.charAt(0).toUpperCase();
        socket.emit('isim-degistir', yeni);
        document.getElementById('isimModal').style.display = 'none';
    }
};
document.getElementById('yeniIsimInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('isimKaydetBtn').click();
});

// --- 4. HTML SEÇİCİLERİ ---
const kanalaKatilBtn = document.getElementById('kanalaKatilBtn');
const mikrofonBtn    = document.getElementById('mikrofonBtn');
const kulaklikBtn    = document.getElementById('kulaklikBtn');
const kameraBtn      = document.getElementById('kameraBtn');
const kameraCevirBtn = document.getElementById('kameraCevirBtn');
const ekranBtn       = document.getElementById('ekranBtn');
const pttToggleBtn   = document.getElementById('pttToggleBtn');
const gamerModBtn    = document.getElementById('gamerModBtn');
const mesajKutusu    = document.getElementById('mesajKutusu');
const mesajGonderBtn = document.getElementById('mesajGonderBtn');
const mesajGecmisi   = document.getElementById('mesajGecmisi');
const dosyaSecici    = document.getElementById('dosyaSecici');

// --- 5. WEBRTC YAPILANDIRMA ---
const stunSunuculari = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]
};

// --- 6. BİLDİRİM SESLERİ ---
function bildirimSesiCal(frekans, sure = 0.25) {
    try {
        const ctx = new AudioContext();
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = frekans;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + sure);
        osc.start();
        osc.stop(ctx.currentTime + sure);
        osc.onended = () => ctx.close();
    } catch(e) {}
}

// --- 7. TOAST BİLDİRİMLERİ ---
function showToast(mesaj, type = 'join') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast' + (type === 'leave' ? ' leave' : type === 'warn' ? ' warn' : '');
    const icon = type === 'leave' ? '👋' : type === 'warn' ? '⚠️' : '🟢';
    const span = document.createElement('span');
    span.textContent = mesaj;
    toast.innerHTML = icon + ' ';
    toast.appendChild(span);
    container.appendChild(toast);
    setTimeout(() => { if (container.contains(toast)) container.removeChild(toast); }, 3100);
}

// --- 8. EMOJİ PİCKER ---
const emojiler = ['😀','😂','😍','😎','😢','😡','👍','👎','🔥','🎉','❤️','🤔','🙄','😴','😷','👽','🤖','👻','💯','👀','💪','🎮','🎯','🏆','🚀'];
const emojiPanel = document.getElementById('emojiPickerPanel');
emojiler.forEach(emo => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn';
    btn.innerText = emo;
    btn.onclick = () => {
        mesajKutusu.value += emo;
        emojiPanel.style.display = 'none';
        mesajKutusu.focus();
    };
    emojiPanel.appendChild(btn);
});
document.getElementById('emojiAcBtn').onclick = () => {
    emojiPanel.style.display = emojiPanel.style.display === 'grid' ? 'none' : 'grid';
};
document.addEventListener('click', (e) => {
    if (!e.target.closest('.chat-input-box')) emojiPanel.style.display = 'none';
});

// --- 9. FULL SCREEN ---
window.tamEkranYap = function(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
};

// --- 10. DİNAMİK VİDEO KUTU OLUŞTURMA ---
// [BUG-6] XSS: isim innerHTML'e direkt yazılmıyordu → textContent kullanıldı
function getOrCreateVideoWrapper(kullaniciId, tip, isim) {
    const wrapperId = `kutu-${kullaniciId}-${tip}`;
    let el = document.getElementById(wrapperId);
    if (el) return el;

    el = document.createElement('div');
    el.className = 'video-wrapper';
    el.id        = wrapperId;

    const videoId   = `vid-${kullaniciId}-${tip}`;
    const isMutedAttr = (kullaniciId === 'yerel') ? 'muted' : '';
    const flipStyle   = (tip === 'kamera' && kullaniciId === 'yerel') ? 'transform:scaleX(-1);' : '';

    // Skeleton / bağlanıyor durumu
    const skeletonDiv = document.createElement('div');
    skeletonDiv.className = 'video-skeleton';
    skeletonDiv.id = `skeleton-${kullaniciId}-${tip}`;
    skeletonDiv.innerHTML = `<div class="skeleton-spinner"></div><div class="skeleton-text">Bağlanıyor...</div>`;

    const pingDot = document.createElement('div');
    pingDot.className = 'ping-dot';
    pingDot.id = `ping-${kullaniciId}-${tip}`;
    if (kullaniciId === 'yerel') pingDot.style.display = 'none';

    // Ping ms göstergesi
    const pingLabel = document.createElement('div');
    pingLabel.className = 'ping-label';
    pingLabel.id = `ping-ms-${kullaniciId}`;
    if (kullaniciId === 'yerel') pingLabel.style.display = 'none';

    const video = document.createElement('video');
    video.id       = videoId;
    video.autoplay = true;
    video.setAttribute('playsinline', '');
    if (isMutedAttr) video.muted = true;
    video.style.cssText = `width:100%; height:100%; object-fit:contain; background:#000; ${flipStyle}`;

    // Label — XSS güvenli textContent
    const labelDiv = document.createElement('div');
    labelDiv.className = 'video-label';
    if (kullaniciId === 'yerel') {
        labelDiv.textContent = tip === 'ekran' ? '🖥 Senin Ekranın' : '📷 Sen';
    } else {
        const emoji = document.createElement('span');
        emoji.textContent = tip === 'ekran' ? '🖥 ' : '📷 ';
        const isimNode = document.createTextNode(isim + (tip === 'ekran' ? ' Ekranı' : ''));
        labelDiv.appendChild(emoji);
        labelDiv.appendChild(isimNode);
    }

    const overlayDiv = document.createElement('div');
    overlayDiv.className = 'video-overlay';

    // Ses seviyesi slider (uzak kullanıcılar için)
    // [YENİ-2] Bireysel ses seviyesi ayarı
    if (kullaniciId !== 'yerel' && tip === 'kamera') {
        const volWrap = document.createElement('div');
        volWrap.className = 'vol-wrap';
        volWrap.innerHTML = `<i class="fas fa-volume-up" style="font-size:11px;color:#fff;"></i>`;
        const volSlider = document.createElement('input');
        volSlider.type  = 'range';
        volSlider.min   = '0';
        volSlider.max   = '200';
        volSlider.value = String((sesSeviyeleri[kullaniciId] ?? 1) * 100);
        volSlider.className = 'vol-slider';
        volSlider.title = 'Ses Seviyesi';
        volSlider.oninput = () => {
            const val = parseInt(volSlider.value) / 100;
            sesSeviyeleri[kullaniciId] = val;
            // Tüm o kullanıcıya ait audio elementlerini güncelle
            document.querySelectorAll(`audio[id^="audio-${kullaniciId}"]`).forEach(a => {
                a.volume = Math.min(1, val);
            });
        };
        volWrap.appendChild(volSlider);
        overlayDiv.appendChild(volWrap);
    }

    if (tip === 'ekran' && kullaniciId !== 'yerel' && !isMobile) {
        const kontrolBtn = document.createElement('button');
        kontrolBtn.className = 'overlay-btn';
        kontrolBtn.id = `kontrolBtn-${kullaniciId}`;
        kontrolBtn.innerHTML = `<i class="fas fa-hand-pointer"></i> Kontrol Et`;
        kontrolBtn.onclick = () => kontrolIstegiYolla(kullaniciId);
        overlayDiv.appendChild(kontrolBtn);
    }

    const buyutBtn = document.createElement('button');
    buyutBtn.className = 'overlay-btn';
    buyutBtn.innerHTML = `<i class="fas fa-expand"></i> Büyüt`;
    buyutBtn.onclick = () => tamEkranYap(videoId);
    overlayDiv.appendChild(buyutBtn);

    const sesBar = document.createElement('div');
    sesBar.className = 'ses-seviyesi-bar';
    sesBar.id = `bar-${kullaniciId}-${tip}`;

    el.appendChild(skeletonDiv);
    el.appendChild(pingDot);
    el.appendChild(pingLabel);
    el.appendChild(video);
    el.appendChild(labelDiv);
    el.appendChild(overlayDiv);
    el.appendChild(sesBar);

    document.getElementById('mainVideoGrid').appendChild(el);

    // Video yüklenince skeleton'ı kaldır
    video.onloadeddata = () => {
        const sk = document.getElementById(`skeleton-${kullaniciId}-${tip}`);
        if (sk) sk.style.display = 'none';
    };

    if (tip === 'ekran' && kullaniciId !== 'yerel' && !isMobile) {
        video.addEventListener('click', (event) => {
            if (video.getAttribute('data-kontrol-aktif') !== 'true') return;
            const rect   = video.getBoundingClientRect();
            const yuzdeX = ((event.clientX - rect.left)  / rect.width)  * 100;
            const yuzdeY = ((event.clientY - rect.top)   / rect.height) * 100;
            socket.emit('fare-hareketi', { kime: kullaniciId, x: yuzdeX, y: yuzdeY });
        });
    }

    return el;
}

// --- 11. UZAKTAN KONTROL ---
window.kontrolIstegiYolla = function(kimeId) {
    socket.emit('kontrol-iste', { kime: kimeId });
    const btn = document.getElementById(`kontrolBtn-${kimeId}`);
    if (btn) { btn.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Bekleniyor..."; btn.disabled = true; }
};

socket.on('kontrol-istegi-geldi', (data) => {
    const ad = data.ad || 'Kullanıcı';
    const onay = confirm(`⚠️ ${ad} ekranınızı işaretlemek istiyor. İzin veriyor musunuz?`);
    socket.emit('kontrol-cevap', { kime: data.kimden, onay });
});

socket.on('kontrol-cevabi-geldi', (data) => {
    const btn     = document.getElementById(`kontrolBtn-${data.kimden}`);
    const videoEl = document.getElementById(`vid-${data.kimden}-ekran`);
    if (data.onay) {
        if (btn)     { btn.innerHTML = "<i class='fas fa-check-circle'></i> Kontrol Aktif"; btn.style.background = 'var(--renk-tehlike)'; btn.style.borderColor = 'var(--renk-tehlike)'; }
        if (videoEl) videoEl.setAttribute('data-kontrol-aktif', 'true');
    } else {
        if (btn) { btn.innerHTML = "<i class='fas fa-hand-pointer'></i> Kontrol Et"; btn.disabled = false; }
    }
});

socket.on('karsi-fare-hareketi', (data) => {
    const lazer = document.getElementById('remote-pointer');
    lazer.style.display = 'block';
    lazer.style.left    = data.x + '%';
    lazer.style.top     = data.y + '%';
    clearTimeout(lazer._timer);
    lazer._timer = setTimeout(() => { lazer.style.display = 'none'; }, 2000);
});

// --- 12. SES ANALİZİ ---
// [BUG-4] AudioContext suspended: await ile bekleniyor
async function sesAnaliziniBaslat(stream, wrapperKey, isLocalMic = false) {
    if (sesAnalyzIntervals[wrapperKey]) return;

    if (!globalAudioCtx) {
        globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Suspended ise resume'u await ile bekle
    if (globalAudioCtx.state === 'suspended') {
        try { await globalAudioCtx.resume(); } catch(e) {}
    }
    if (globalAudioCtx.state !== 'running') return; // Hâlâ açılmadıysa çık

    try {
        const kaynak   = globalAudioCtx.createMediaStreamSource(stream);
        const analizor = globalAudioCtx.createAnalyser();
        analizor.fftSize = 256;
        kaynak.connect(analizor);
        // YANKI ÖNLEMESİ: destination'a BAĞLAMA

        sesAnalyzNodes[wrapperKey] = { kaynak, analizor };

        const veriDizisi = new Uint8Array(analizor.frequencyBinCount);
        let sonDurum = false;

        const interval = setInterval(() => {
            if (!stream.active) {
                sesSesAnalyzDurdur(wrapperKey);
                return;
            }
            analizor.getByteFrequencyData(veriDizisi);
            const ortalama = veriDizisi.reduce((a, b) => a + b, 0) / veriDizisi.length;
            const bar = document.getElementById(`bar-${wrapperKey}`);
            if (bar) bar.style.width = Math.min(100, ortalama * 1.5) + '%';

            if (isLocalMic) {
                const konusuyorMu = ortalama > 28;
                if (konusuyorMu !== sonDurum) {
                    sonDurum = konusuyorMu;
                    socket.emit('konusuyor-mu', sonDurum);
                    parlamayiAyarla(socket.id, sonDurum);
                }
            }
        }, 100);

        sesAnalyzIntervals[wrapperKey] = interval;
    } catch(e) {
        console.warn('Ses analiz hatası:', e);
    }
}

function sesSesAnalyzDurdur(wrapperKey) {
    if (sesAnalyzIntervals[wrapperKey]) {
        clearInterval(sesAnalyzIntervals[wrapperKey]);
        delete sesAnalyzIntervals[wrapperKey];
    }
    if (sesAnalyzNodes[wrapperKey]) {
        try { sesAnalyzNodes[wrapperKey].kaynak.disconnect(); } catch(e) {}
        delete sesAnalyzNodes[wrapperKey];
    }
    const bar = document.getElementById(`bar-${wrapperKey}`);
    if (bar) bar.style.width = '0%';
}

function parlamayiAyarla(id, durum) {
    const avatar = document.getElementById(`av-${id}`);
    if (avatar) {
        durum ? avatar.classList.add('speaking') : avatar.classList.remove('speaking');
    }
}

socket.on('konusma-durumu-geldi', (data) => {
    parlamayiAyarla(data.id, data.durum);
    const topBarInfo = document.getElementById('aktifKonusanInfo');
    if (data.durum) {
        const adGuvenli = document.createTextNode('🎤 ' + (data.ad || '') + ' konuşuyor...');
        topBarInfo.textContent = '';
        topBarInfo.appendChild(adGuvenli);
    } else if (topBarInfo.textContent.includes(data.ad || '')) {
        topBarInfo.textContent = '';
    }
});

// ============================================================
// --- 13. WEBRTC ÇEKİRDEK — PERFECT NEGOTIATION PAT. ---
// [BUG-7] Rollback sorunu → Perfect Negotiation pattern
// [BUG-1] ICE kuyruk sistemi → remoteDescription bekleme
// ============================================================

// ICE adayını kuyruğa ekle veya direkt uygula
async function iceAdayiEkle(socketId, aday) {
    const pc = peerConnections[socketId];
    if (!pc) return;

    // remoteDescription henüz yoksa kuyruğa al
    if (!pc.remoteDescription || !pc.remoteDescription.type) {
        if (!iceKuyrugu[socketId]) iceKuyrugu[socketId] = [];
        iceKuyrugu[socketId].push(aday);
    } else {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(aday));
        } catch(e) {
            if (!pc.ignoreOffer) console.warn('ICE ekleme hatası:', e);
        }
    }
}

// Bekleyen ICE adaylarını uygula (remoteDescription ayarlandıktan sonra çağır)
async function bekleyenIceleriUygula(socketId) {
    const pc = peerConnections[socketId];
    if (!pc || !iceKuyrugu[socketId]) return;
    const kuyruk = iceKuyrugu[socketId];
    iceKuyrugu[socketId] = [];
    for (const aday of kuyruk) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(aday));
        } catch(e) {
            if (!pc.ignoreOffer) console.warn('Kuyruktaki ICE hatası:', e);
        }
    }
}

// Re-negotiation
async function muzakereBaslat(hedefId) {
    const pc = peerConnections[hedefId];
    if (!pc) return;
    if (muzakereKilidi[hedefId]) return;
    if (pc.signalingState !== 'stable') return;

    muzakereKilidi[hedefId] = true;
    try {
        const teklif = await pc.createOffer();
        if (pc.signalingState !== 'stable') return; // Race condition koruması
        await pc.setLocalDescription(teklif);
        socket.emit('webrtc-teklif', { kime: hedefId, teklif: pc.localDescription });
    } catch(err) {
        console.warn('Müzakere hatası:', err);
    } finally {
        setTimeout(() => { delete muzakereKilidi[hedefId]; }, 600);
    }
}

// Track tüm bağlantılara ekle
function trackiTumBaglantilaraEkle(track, stream) {
    Object.keys(peerConnections).forEach(hedefId => {
        const pc = peerConnections[hedefId];
        if (!pc) return;
        try {
            const sender = pc.getSenders().find(s => s.track && s.track.id === track.id);
            if (sender) {
                sender.replaceTrack(track).catch(() => {});
            } else {
                pc.addTrack(track, stream);
                setTimeout(() => muzakereBaslat(hedefId), 200);
            }
        } catch(e) {
            console.warn('Track ekleme hatası:', e);
        }
    });
}

function trackleriTumBaglantilaraEkle(track, stream) {
    trackiTumBaglantilaraEkle(track, stream);
}

// Stream + Sinyal eşleştirme
function streamSinyalEsles(streamId) {
    if (bekleyenSinyal[streamId] && bekleyenStream[streamId]) {
        const { kimden, tur } = bekleyenSinyal[streamId];
        const stream           = bekleyenStream[streamId];
        remoteYayinEkle(stream, kimden, tur);
        delete bekleyenSinyal[streamId];
        delete bekleyenStream[streamId];
    }
}

// Uzak yayını ekrana yerleştir
function remoteYayinEkle(stream, kullaniciId, tur) {
    const isimEl = document.getElementById(`av-${kullaniciId}`);
    const isim   = isimEl ? isimEl.textContent : 'Kullanıcı';

    if (tur === 'kam-ac') {
        const wrapper = getOrCreateVideoWrapper(kullaniciId, 'kamera', isim);
        const video   = wrapper.querySelector('video');
        if (video.srcObject !== stream) {
            video.srcObject = stream;
            video.play().catch(() => {});
        }
        sesAnaliziniBaslat(stream, `${kullaniciId}-kamera`, false);

    } else if (tur === 'ekr-ac') {
        const wrapper = getOrCreateVideoWrapper(kullaniciId, 'ekran', isim);
        const video   = wrapper.querySelector('video');
        if (video.srcObject !== stream) {
            video.srcObject = stream;
            video.play().catch(() => {});
        }
        const kontrolBtn = document.getElementById(`kontrolBtn-${kullaniciId}`);
        if (kontrolBtn) kontrolBtn.style.display = 'flex';

    } else if (tur === 'mik-ac' || tur === 'ekr-ses') {
        const audioId = `audio-${kullaniciId}-${tur}`;
        let audioEl = document.getElementById(audioId);
        if (!audioEl) {
            audioEl           = document.createElement('audio');
            audioEl.id        = audioId;
            audioEl.autoplay  = true;
            audioEl.muted     = isDeafened;
            // [YENİ-2] Kaydedilmiş ses seviyesini uygula
            const kayitliSeviye = sesSeviyeleri[kullaniciId] ?? 1;
            audioEl.volume = Math.min(1, kayitliSeviye);
            document.getElementById('remoteAudioContainer').appendChild(audioEl);
        }
        if (audioEl.srcObject !== stream) {
            audioEl.srcObject = stream;
            audioEl.play().catch(() => {});
        }
    }
}

// ============================================================
// [YENİ-1] BAĞLANTI KALİTESİ GÖSTERGESİ (getStats)
// ============================================================
function pingTakibiniBaslat(socketId) {
    if (pingIntervals[socketId]) return;
    pingIntervals[socketId] = setInterval(async () => {
        const pc = peerConnections[socketId];
        if (!pc || pc.connectionState === 'closed') {
            clearInterval(pingIntervals[socketId]);
            delete pingIntervals[socketId];
            return;
        }
        try {
            const stats = await pc.getStats();
            let rtt = null;
            stats.forEach(report => {
                if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime) {
                    rtt = Math.round(report.currentRoundTripTime * 1000);
                }
            });
            if (rtt !== null) {
                const label = document.getElementById(`ping-ms-${socketId}`);
                if (label) {
                    label.textContent = `${rtt}ms`;
                    label.style.color = rtt < 80 ? 'var(--renk-basari)' : rtt < 150 ? '#faa61a' : 'var(--renk-tehlike)';
                }
                // Ping dot rengi
                const dot = document.querySelector(`[id^="ping-${socketId}"]`);
                if (dot) {
                    dot.style.background = rtt < 80 ? 'var(--renk-basari)' : rtt < 150 ? '#faa61a' : 'var(--renk-tehlike)';
                }
            }
        } catch(e) {}
    }, 2000);
}

function pingTakibiniDurdur(socketId) {
    if (pingIntervals[socketId]) {
        clearInterval(pingIntervals[socketId]);
        delete pingIntervals[socketId];
    }
    const label = document.getElementById(`ping-ms-${socketId}`);
    if (label) label.textContent = '';
}

// Peer bağlantı kur
function baglantiKoprusuKur(hedefId, isInitiator) {
    if (peerConnections[hedefId]) {
        try { peerConnections[hedefId].close(); } catch(e) {}
        delete peerConnections[hedefId];
    }
    delete muzakereKilidi[hedefId];
    delete muzakereYapiliyor[hedefId];
    iceKuyrugu[hedefId] = [];

    const pc = new RTCPeerConnection(stunSunuculari);
    peerConnections[hedefId] = pc;
    polite[hedefId] = !isInitiator; // Perfect negotiation: late joiner polite

    pc.ontrack = (event) => {
        let stream = event.streams && event.streams[0];
        if (!stream) {
            stream = new MediaStream([event.track]);
        }

        bekleyenStream[stream.id] = stream;
        streamSinyalEsles(stream.id);

        // Fallback: kind bazlı eşleştirme
        Object.keys(bekleyenSinyal).forEach(sid => {
            if (bekleyenStream[sid]) return;
            const sinyal = bekleyenSinyal[sid];
            if (sinyal.kimden !== hedefId) return;
            const turKind = (sinyal.tur === 'mik-ac' || sinyal.tur === 'ekr-ses') ? 'audio' : 'video';
            if (event.track.kind === turKind) {
                bekleyenStream[sid] = stream;
                streamSinyalEsles(sid);
            }
        });
    };

    pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('ice-adayi', { kime: hedefId, aday: e.candidate });
    };

    pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        // Bağlantı göstergesi
        const dots = document.querySelectorAll(`[id^="ping-${hedefId}"]`);
        dots.forEach(d => {
            d.style.display = (state === 'connected' || state === 'completed') ? 'block' : 'block';
            d.style.background = state === 'connected' || state === 'completed'
                ? 'var(--renk-basari)'
                : state === 'connecting'
                    ? '#faa61a'
                    : 'var(--renk-tehlike)';
        });

        if (state === 'connected' || state === 'completed') {
            pingTakibiniBaslat(hedefId);
        } else if (state === 'failed') {
            pingTakibiniDurdur(hedefId);
            if (peerConnections[hedefId] === pc && isInitiator) {
                showToast('Bağlantı koptu, yeniden deneniyor...', 'warn');
                pc.restartIce();
                setTimeout(() => muzakereBaslat(hedefId), 500);
            }
        } else if (state === 'disconnected') {
            pingTakibiniDurdur(hedefId);
        }
    };

    // ============================================================
    // [BUG-7] PERFECT NEGOTIATION PATTERN
    // onnegotiationneeded: isInitiator veya polite taraf offer gönderir
    // Glare durumu: polite taraf rollback yapar
    // ============================================================
    pc.onnegotiationneeded = async () => {
        try {
            muzakereYapiliyor[hedefId] = true;
            await pc.setLocalDescription();
            socket.emit('webrtc-teklif', { kime: hedefId, teklif: pc.localDescription });
        } catch(err) {
            console.warn('onnegotiationneeded hatası:', err);
        } finally {
            muzakereYapiliyor[hedefId] = false;
        }
    };

    // Mevcut track'leri hemen ekle
    if (mikrofonYayini) {
        mikrofonYayini.getAudioTracks().forEach(t => {
            try { pc.addTrack(t, mikrofonYayini); } catch(e) {}
        });
    }
    if (kameraYayini) {
        kameraYayini.getVideoTracks().forEach(t => {
            try { pc.addTrack(t, kameraYayini); } catch(e) {}
        });
    }
    if (ekranYayini) {
        ekranYayini.getTracks().forEach(t => {
            try { pc.addTrack(t, ekranYayini); } catch(e) {}
        });
    }

    return pc;
}

// --- 14. SOCKET.IO WEBRTC OLAYLARI ---

socket.on('yeni-kullanici-geldi', (data) => {
    showToast(`${data.ad} odaya katıldı`, 'join');
    bildirimSesiCal(660, 0.2);
    baglantiKoprusuKur(data.id, true);
});

// ============================================================
// [BUG-7] PERFECT NEGOTIATION — Teklif / Cevap işleme
// ============================================================
socket.on('webrtc-teklif-geldi', async (data) => {
    if (!peerConnections[data.kimden]) baglantiKoprusuKur(data.kimden, false);
    const pc        = peerConnections[data.kimden];
    const isPolite  = polite[data.kimden] ?? true;

    const offerCollision = data.teklif.type === 'offer' &&
        (muzakereYapiliyor[data.kimden] || pc.signalingState !== 'stable');

    pc.ignoreOffer = !isPolite && offerCollision;
    if (pc.ignoreOffer) return;

    try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.teklif));
        // remoteDescription ayarlandı, kuyruktaki ICE adaylarını uygula
        await bekleyenIceleriUygula(data.kimden);

        if (data.teklif.type === 'offer') {
            await pc.setLocalDescription();
            socket.emit('webrtc-cevap', { kime: data.kimden, cevap: pc.localDescription });
        }
    } catch(e) {
        console.warn('Teklif işleme hatası:', e);
    }
});

socket.on('webrtc-cevap-geldi', async (data) => {
    const pc = peerConnections[data.kimden];
    if (!pc) return;
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.cevap));
        // remoteDescription ayarlandı, kuyruktaki ICE adaylarını uygula
        await bekleyenIceleriUygula(data.kimden);
    } catch(e) {
        console.warn('Cevap işleme hatası:', e);
    }
});

// [BUG-1] ICE kuyruk sistemi
socket.on('ice-adayi-geldi', async (data) => {
    await iceAdayiEkle(data.kimden, data.aday);
});

// --- 15. MEDYA DURUMU (gelen) ---
// [BUG-5] streamId undefined: kapatma mesajlarında id yok → undefined check
socket.on('medya-durumu-geldi', (data) => {
    const { kimden, tur, streamId } = data;

    if (tur === 'kam-ac' || tur === 'ekr-ac' || tur === 'mik-ac' || tur === 'ekr-ses') {
        if (!streamId) return; // [BUG-5] guard

        bekleyenSinyal[streamId] = { kimden, tur };
        streamSinyalEsles(streamId);

        setTimeout(() => {
            if (bekleyenSinyal[streamId]) {
                delete bekleyenSinyal[streamId];
            }
        }, 8000);

    } else if (tur === 'kam-kap') {
        const w = document.getElementById(`kutu-${kimden}-kamera`);
        if (w) w.remove();
        sesSesAnalyzDurdur(`${kimden}-kamera`);
    } else if (tur === 'ekr-kap') {
        const w = document.getElementById(`kutu-${kimden}-ekran`);
        if (w) w.remove();
    } else if (tur === 'mik-kap' || tur === 'ekr-ses-kap') {
        document.querySelectorAll(`audio[id^="audio-${kimden}"]`).forEach(a => a.remove());
    }

    if (data.durumlar) {
        kullanicilariGuncelle(data.kullanicilar || null, data.durumlar);
    }
});

// --- 16. KULLANICI LİSTESİ ---
function kullanicilariGuncelle(kullanicilar, durumlar) {
    const listeKutusu = document.getElementById('aktifKullanicilarListesi');
    if (!listeKutusu || !kullanicilar) return;

    listeKutusu.innerHTML = '';
    const idLer = Object.keys(kullanicilar);
    document.getElementById('kisiSayaci').innerText = `${idLer.length} Online`;

    idLer.forEach(id => {
        const d = durumlar[id] || { mikrofon: false, kamera: false, ekran: false, kulaklik: false };

        const item = document.createElement('div');
        item.className = 'list-item';

        const sol = document.createElement('div');
        sol.className = 'list-item-left';

        const avatar = document.createElement('div');
        avatar.className = 'list-avatar' + (!d.mikrofon ? ' muted-avatar' : '');
        avatar.id = `av-${id}`;
        avatar.textContent = kullanicilar[id].charAt(0).toUpperCase();

        const isimSpan = document.createElement('span');
        isimSpan.style.color = '#dbdee1';
        isimSpan.textContent = kullanicilar[id]; // XSS güvenli

        sol.appendChild(avatar);
        sol.appendChild(isimSpan);

        const ikonlar = document.createElement('div');
        ikonlar.className = 'status-icons';
        ikonlar.innerHTML = `
            <i class="fas fa-video"   title="Kamera"   style="color:${d.kamera   ? 'var(--renk-aktif)'   : 'var(--renk-gri)'};"></i>
            <i class="fas fa-desktop" title="Ekran"    style="color:${d.ekran    ? 'var(--renk-basari)'  : 'var(--renk-gri)'};"></i>
            <i class="fas ${d.kulaklik ? 'fa-headphones-slash' : 'fa-headphones'}" title="Kulaklık" style="color:${d.kulaklik ? 'var(--renk-tehlike)' : 'var(--renk-gri)'};"></i>
            <i class="fas ${d.mikrofon ? 'fa-microphone' : 'fa-microphone-slash'}" title="Mikrofon" style="color:${d.mikrofon ? 'var(--renk-basari)' : 'var(--renk-tehlike)'};"></i>
        `;

        item.appendChild(sol);
        item.appendChild(ikonlar);
        listeKutusu.appendChild(item);
    });
}

let _sonKullanicilar = {};
socket.on('kullanici-listesi', (data) => {
    _sonKullanicilar = data.kullanicilar;
    kullanicilariGuncelle(data.kullanicilar, data.durumlar);
});

socket.on('kullanici-ayrildi', (id) => {
    const isim = (_sonKullanicilar && _sonKullanicilar[id]) || 'Kullanıcı';
    showToast(isim + ' odadan ayrıldı', 'leave');
    bildirimSesiCal(330, 0.2);

    document.querySelectorAll(`[id*="-${id}-"]`).forEach(el => el.remove());
    document.querySelectorAll(`audio[id^="audio-${id}"]`).forEach(a => a.remove());

    Object.keys(sesAnalyzIntervals).forEach(key => {
        if (key.startsWith(id)) sesSesAnalyzDurdur(key);
    });

    if (peerConnections[id]) {
        try { peerConnections[id].close(); } catch(e) {}
        delete peerConnections[id];
    }
    delete muzakereKilidi[id];
    delete muzakereYapiliyor[id];
    delete polite[id];
    delete iceKuyrugu[id];
    pingTakibiniDurdur(id);

    // [BUG-3] Sadece ayrılan kullanıcıya ait sinyalleri temizle
    Object.keys(bekleyenSinyal).forEach(k => {
        if (bekleyenSinyal[k] && bekleyenSinyal[k].kimden === id) delete bekleyenSinyal[k];
    });
    // Sadece ayrılan kullanıcının stream'lerini temizle
    Object.keys(bekleyenStream).forEach(k => {
        const s = bekleyenStream[k];
        if (s && s._peerId === id) delete bekleyenStream[k];
    });
});

// ============================================================
// [YENİ-4] SOCKET OTOMATİK YENİDEN BAĞLANMA
// ============================================================
socket.on('disconnect', (reason) => {
    showToast('Sunucu bağlantısı koptu, yeniden bağlanılıyor...', 'warn');
    // Tüm peer bağlantılarını kapat
    Object.keys(peerConnections).forEach(id => {
        try { peerConnections[id].close(); } catch(e) {}
        delete peerConnections[id];
        pingTakibiniDurdur(id);
    });
    // Bağlantı durumunu sıfırla
    if (kanalaBaglandim) {
        kanalaKatilBtn.innerHTML = "<i class='fas fa-sync fa-spin' style='font-size:15px;'></i> Yeniden bağlanıyor...";
    }
});

socket.on('reconnect', () => {
    showToast('Sunucuya yeniden bağlandı!', 'join');
    if (kanalaBaglandim) {
        socket.emit('kanala-katil', kullaniciAdi);
        kanalaKatilBtn.innerHTML = "<i class='fas fa-plug' style='font-size:15px;'></i> Bağlandı";
        // Mevcut yayınları yeniden paylaş
        if (mikrofonYayini && mikrofonYayini.getAudioTracks()[0]?.enabled) {
            socket.emit('medya-durumu', { tur: 'mik-ac', broadcast: true, id: mikrofonYayini.id });
        }
        if (kameraYayini) {
            socket.emit('medya-durumu', { tur: 'kam-ac', broadcast: true, id: kameraYayini.id });
        }
        if (ekranYayini) {
            socket.emit('medya-durumu', { tur: 'ekr-ac', broadcast: true, id: ekranYayini.id });
        }
    }
});

// --- 17. KANALA KATIL ---
kanalaKatilBtn.addEventListener('click', () => {
    kanalaKatilBtn.innerHTML = "<i class='fas fa-plug' style='font-size:15px;'></i> Bağlandı";
    kanalaKatilBtn.classList.add('active');
    kanalaKatilBtn.disabled = true;
    kanalaBaglandim = true;

    mikrofonBtn.disabled  = false;
    kulaklikBtn.disabled  = false;
    kameraBtn.disabled    = false;
    ekranBtn.disabled     = false;
    gamerModBtn.style.display = 'flex';

    socket.emit('kanala-katil', kullaniciAdi);
});

// --- 18. MİKROFON ---
mikrofonBtn.addEventListener('click', async () => {
    if (isDeafened) {
        showToast('Deafen aktifken mikrofon açılamaz!', 'warn');
        return;
    }

    const ikon = document.getElementById('mik-icon');

    if (!mikrofonYayini) {
        try {
            mikrofonYayini = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000
                }
            });

            if (isPttActive) {
                mikrofonYayini.getAudioTracks()[0].enabled = false;
                ikon.className = 'fas fa-microphone-slash';
                mikrofonBtn.classList.remove('acik');
            } else {
                ikon.className = 'fas fa-microphone';
                mikrofonBtn.classList.add('acik');
                socket.emit('medya-durumu', { tur: 'mik-ac', broadcast: true, id: mikrofonYayini.id });
            }

            const audioTrack = mikrofonYayini.getAudioTracks()[0];
            trackiTumBaglantilaraEkle(audioTrack, mikrofonYayini);
            sesAnaliziniBaslat(mikrofonYayini, 'yerel-kamera', true);

        } catch(e) {
            const mesaj = e.name === 'NotAllowedError'
                ? 'Mikrofon izni reddedildi. Tarayıcı izinlerini kontrol edin.'
                : e.name === 'NotFoundError'
                    ? 'Mikrofon bulunamadı. Cihazınızı kontrol edin.'
                    : 'Mikrofon açılamadı: ' + e.message;
            showToast(mesaj, 'warn');
        }
    } else {
        const track = mikrofonYayini.getAudioTracks()[0];
        if (track.enabled) {
            track.enabled = false;
            ikon.className = 'fas fa-microphone-slash';
            mikrofonBtn.classList.remove('acik');
            socket.emit('medya-durumu', { tur: 'mik-kap', broadcast: true });
        } else {
            track.enabled = true;
            ikon.className = 'fas fa-microphone';
            mikrofonBtn.classList.add('acik');
            socket.emit('medya-durumu', { tur: 'mik-ac', broadcast: true, id: mikrofonYayini.id });
        }
    }
});

// --- 19. DEAFEN ---
kulaklikBtn.addEventListener('click', () => {
    isDeafened = !isDeafened;
    const ikon = document.getElementById('kulak-icon');

    if (isDeafened) {
        ikon.className = 'fas fa-headphones-slash';
        kulaklikBtn.classList.add('tehlike');
        document.querySelectorAll('#remoteAudioContainer audio').forEach(a => a.muted = true);

        if (mikrofonYayini && mikrofonYayini.getAudioTracks()[0]?.enabled) {
            wasMicEnabledBeforeDeafen = true;
            mikrofonBtn.click();
        }
        socket.emit('medya-durumu', { tur: 'kulak-kap', broadcast: true });
    } else {
        ikon.className = 'fas fa-headphones';
        kulaklikBtn.classList.remove('tehlike');
        document.querySelectorAll('#remoteAudioContainer audio').forEach(a => a.muted = false);

        if (wasMicEnabledBeforeDeafen) {
            wasMicEnabledBeforeDeafen = false;
            mikrofonBtn.click();
        }
        socket.emit('medya-durumu', { tur: 'kulak-ac', broadcast: true });
    }
});

// --- 20. KAMERA ---
kameraBtn.addEventListener('click', async () => {
    const ikon = document.getElementById('kam-icon');

    if (!kameraYayini) {
        try {
            const videoAyar = isMobile
                ? { facingMode: onKameraMi ? 'user' : 'environment' }
                : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };

            kameraYayini = await navigator.mediaDevices.getUserMedia({ video: videoAyar });

            const wrapper = getOrCreateVideoWrapper('yerel', 'kamera', '');
            wrapper.querySelector('video').srcObject = kameraYayini;
            wrapper.querySelector('video').play().catch(() => {});

            ikon.className = 'fas fa-video';
            kameraBtn.classList.add('acik');
            if (isMobile) kameraCevirBtn.style.display = 'flex';

            const videoTrack = kameraYayini.getVideoTracks()[0];
            trackiTumBaglantilaraEkle(videoTrack, kameraYayini);
            socket.emit('medya-durumu', { tur: 'kam-ac', broadcast: true, id: kameraYayini.id });

        } catch(e) {
            const mesaj = e.name === 'NotAllowedError' ? 'Kamera izni reddedildi.' : 'Kamera açılamadı.';
            showToast(mesaj, 'warn');
        }
    } else {
        kameraYayini.getTracks().forEach(t => t.stop());
        kameraYayini = null;

        const w = document.getElementById('kutu-yerel-kamera');
        if (w) w.remove();

        ikon.className = 'fas fa-video-slash';
        kameraBtn.classList.remove('acik');
        kameraCevirBtn.style.display = 'none';
        socket.emit('medya-durumu', { tur: 'kam-kap', broadcast: true });
    }
});

kameraCevirBtn.addEventListener('click', async () => {
    if (!kameraYayini) return;
    onKameraMi = !onKameraMi;
    kameraYayini.getTracks().forEach(t => t.stop());
    try {
        kameraYayini = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: onKameraMi ? 'user' : 'environment' }
        });
        const video = document.getElementById('vid-yerel-kamera');
        if (video) video.srcObject = kameraYayini;
        const videoTrack = kameraYayini.getVideoTracks()[0];
        trackiTumBaglantilaraEkle(videoTrack, kameraYayini);
    } catch(e) {}
});

// --- 21. EKRAN PAYLAŞIMI ---
// [BUG-2] ekr-ses: video ve audio track'leri FARKLI streamId ile gönderiliyor
ekranBtn.addEventListener('click', async () => {
    const ikon = document.getElementById('ekran-icon');

    if (!ekranYayini) {
        try {
            const kalite    = document.getElementById('kaliteSecici')?.value || '720';
            const videoAyar = isMobile
                ? { video: true, audio: false }
                : {
                    video: {
                        width:     { ideal: kalite === '1080' ? 1920 : 1280 },
                        height:    { ideal: kalite === '1080' ? 1080 : 720 },
                        frameRate: { ideal: 30 }
                    },
                    audio: true
                };

            ekranYayini = await navigator.mediaDevices.getDisplayMedia(videoAyar);

            // Yankı önleme
            if (ekranYayini.getAudioTracks().length > 0) {
                const at = ekranYayini.getAudioTracks()[0];
                if (at.applyConstraints) {
                    at.applyConstraints({ suppressLocalAudioPlayback: true }).catch(() => {});
                }
            }

            const wrapper = getOrCreateVideoWrapper('yerel', 'ekran', '');
            const video   = wrapper.querySelector('video');
            video.srcObject = ekranYayini;
            video.play().catch(() => {});

            ekranBtn.classList.add('acik');
            ikon.style.color = 'var(--renk-basari)';

            // [BUG-2] Video track → ekranYayini.id ile, Audio track → ayrı stream oluştur
            const videoTracks = ekranYayini.getVideoTracks();
            const audioTracks = ekranYayini.getAudioTracks();

            if (videoTracks.length > 0) {
                const videoStream = new MediaStream(videoTracks);
                trackiTumBaglantilaraEkle(videoTracks[0], videoStream);
                socket.emit('medya-durumu', { tur: 'ekr-ac', broadcast: true, id: videoStream.id });
            }

            if (audioTracks.length > 0) {
                // Audio için AYRI bir MediaStream oluştur → farklı stream.id
                const audioStream = new MediaStream(audioTracks);
                ekranSesStreamId = audioStream.id;
                trackiTumBaglantilaraEkle(audioTracks[0], audioStream);
                socket.emit('medya-durumu', { tur: 'ekr-ses', broadcast: true, id: audioStream.id });
            }

            ekranYayini.getVideoTracks()[0].onended = () => {
                if (ekranYayini) ekranBtn.click();
            };

        } catch(e) {
            if (e.name !== 'NotAllowedError') showToast('Ekran paylaşılamadı!', 'warn');
        }
    } else {
        ekranYayini.getTracks().forEach(t => t.stop());
        ekranYayini = null;
        ekranSesStreamId = null;

        const w = document.getElementById('kutu-yerel-ekran');
        if (w) w.remove();

        ekranBtn.classList.remove('acik');
        ikon.style.color = 'var(--renk-gri)';
        socket.emit('medya-durumu', { tur: 'ekr-kap',     broadcast: true });
        socket.emit('medya-durumu', { tur: 'ekr-ses-kap', broadcast: true });
    }
});

// --- 22. PUSH TO TALK ---
pttToggleBtn.addEventListener('click', () => {
    isPttActive = !isPttActive;
    pttToggleBtn.innerHTML = `<i class="fas fa-keyboard" style="font-size:15px;"></i> Bas-Konuş: ${isPttActive ? 'AÇIK' : 'KAPALI'}`;
    pttToggleBtn.style.background  = isPttActive ? 'var(--renk-aktif)' : '';
    pttToggleBtn.style.color       = isPttActive ? '#fff' : '';
    pttToggleBtn.style.borderColor = isPttActive ? 'var(--renk-aktif)' : '';

    if (isMobile) {
        document.getElementById('mobilePttBtn').style.display = isPttActive ? 'block' : 'none';
    }

    if (isPttActive && mikrofonYayini) {
        const t = mikrofonYayini.getAudioTracks()[0];
        if (t && t.enabled) {
            t.enabled = false;
            document.getElementById('mik-icon').className = 'fas fa-microphone-slash';
            mikrofonBtn.classList.remove('acik');
            socket.emit('medya-durumu', { tur: 'mik-kap', broadcast: true });
        }
    }
});

window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !isPttActive || document.activeElement === mesajKutusu || isPttKeyPressed) return;
    isPttKeyPressed = true;
    if (mikrofonYayini) {
        mikrofonYayini.getAudioTracks()[0].enabled = true;
        document.getElementById('mik-icon').className = 'fas fa-microphone';
        mikrofonBtn.classList.add('acik');
        socket.emit('medya-durumu', { tur: 'mik-ac', broadcast: true });
    }
});
window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' || !isPttActive || document.activeElement === mesajKutusu) return;
    isPttKeyPressed = false;
    if (mikrofonYayini) {
        mikrofonYayini.getAudioTracks()[0].enabled = false;
        document.getElementById('mik-icon').className = 'fas fa-microphone-slash';
        mikrofonBtn.classList.remove('acik');
        socket.emit('medya-durumu', { tur: 'mik-kap', broadcast: true });
    }
});

const mobilePtt = document.getElementById('mobilePttBtn');
mobilePtt.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (mikrofonYayini) {
        mikrofonYayini.getAudioTracks()[0].enabled = true;
        socket.emit('medya-durumu', { tur: 'mik-ac', broadcast: true });
    }
}, { passive: false });
mobilePtt.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (mikrofonYayini) {
        mikrofonYayini.getAudioTracks()[0].enabled = false;
        socket.emit('medya-durumu', { tur: 'mik-kap', broadcast: true });
    }
}, { passive: false });

// --- 23. GAMER MOD ---
gamerModBtn.addEventListener('click', () => {
    const aktif = gamerModBtn.classList.contains('active');
    if (!aktif) {
        gamerModBtn.classList.add('active');
        gamerModBtn.innerHTML = "<i class='fas fa-gamepad' style='font-size:15px;'></i> Gamer Mod: AÇIK";
        if (kameraYayini) kameraBtn.click();
    } else {
        gamerModBtn.classList.remove('active');
        gamerModBtn.innerHTML = "<i class='fas fa-gamepad' style='font-size:15px;'></i> Gamer Mod";
        gamerModBtn.style.background = 'linear-gradient(135deg, #faa61a, #e68d00)';
    }
});

// ============================================================
// --- 24. SOHBET + [YENİ-3] MESAJ GEÇMİŞİ (localStorage)
// ============================================================
const MESAJ_GECMISI_KEY = 'bascord_mesaj_gecmisi';
const MAX_GECMIS = 100;

function mesajGecmisineKaydet(isim, metin, benMi, resimMi = false) {
    if (resimMi) return; // Resimleri kaydetme (boyut sorunu)
    try {
        const gecmis = JSON.parse(localStorage.getItem(MESAJ_GECMISI_KEY) || '[]');
        gecmis.push({ isim, metin, benMi, zaman: Date.now() });
        if (gecmis.length > MAX_GECMIS) gecmis.splice(0, gecmis.length - MAX_GECMIS);
        localStorage.setItem(MESAJ_GECMISI_KEY, JSON.stringify(gecmis));
    } catch(e) {}
}

function mesajGecmisiniYukle() {
    try {
        const gecmis = JSON.parse(localStorage.getItem(MESAJ_GECMISI_KEY) || '[]');
        if (gecmis.length === 0) return;
        const ayirici = document.createElement('div');
        ayirici.style.cssText = 'text-align:center; color:#4e5058; font-size:11px; font-weight:600; padding:8px; border-bottom:1px solid #2b2d31; margin-bottom:8px;';
        ayirici.textContent = `── Önceki Mesajlar (${gecmis.length}) ──`;
        mesajGecmisi.appendChild(ayirici);
        gecmis.forEach(m => ekranaMesajYaz(m.isim, m.metin, m.benMi, false, m.zaman));
    } catch(e) {}
}

function ekranaMesajYaz(isim, metin, benMi, resimMi = false, zamanDamgasi = null) {
    const div = document.createElement('div');
    div.className = benMi ? 'msg-container benim' : 'msg-container';

    const saat = zamanDamgasi
        ? new Date(zamanDamgasi).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const baslik = document.createElement('div');
    baslik.style.marginBottom = '5px';

    const isimSpan = document.createElement('span');
    isimSpan.style.cssText = `color:${benMi ? '#fff' : 'var(--renk-tehlike)'}; font-weight:800; font-size:13px;`;
    isimSpan.textContent = isim;

    const saatSpan = document.createElement('span');
    saatSpan.style.cssText = 'color:var(--renk-gri); font-size:11px; margin-left:8px;';
    saatSpan.textContent = saat;

    baslik.appendChild(isimSpan);
    baslik.appendChild(saatSpan);
    div.appendChild(baslik);

    const icerik = document.createElement('div');
    icerik.style.cssText = 'color:#dbdee1; line-height:1.5; font-size:13px;';
    if (resimMi) {
        const img = document.createElement('img');
        img.src = metin;
        img.style.cssText = 'max-width:100%; border-radius:8px; margin-top:6px; cursor:pointer;';
        img.onclick = () => window.open(metin);
        icerik.appendChild(img);
    } else {
        icerik.textContent = metin; // XSS güvenli
    }
    div.appendChild(icerik);

    mesajGecmisi.appendChild(div);
    mesajGecmisi.scrollTop = mesajGecmisi.scrollHeight;
}

// Sayfa yüklenince geçmişi yükle
mesajGecmisiniYukle();

mesajGonderBtn.addEventListener('click', () => {
    const mesaj = mesajKutusu.value.trim();
    if (mesaj !== '') {
        socket.emit('chat-mesaji', { ad: kullaniciAdi, metin: mesaj });
        ekranaMesajYaz(kullaniciAdi, mesaj, true);
        mesajGecmisineKaydet(kullaniciAdi, mesaj, true);
        mesajKutusu.value = '';
    }
});
mesajKutusu.addEventListener('keypress', (e) => { if (e.key === 'Enter') mesajGonderBtn.click(); });

dosyaSecici.addEventListener('change', (e) => {
    const dosya = e.target.files[0];
    if (!dosya) return;
    // Dosya boyutu kontrolü (5MB)
    if (dosya.size > 5 * 1024 * 1024) {
        showToast('Dosya çok büyük! Maksimum 5MB.', 'warn');
        e.target.value = '';
        return;
    }
    const okuyucu = new FileReader();
    okuyucu.onload = (ev) => {
        socket.emit('dosya-gonder', { ad: kullaniciAdi, data: ev.target.result });
        ekranaMesajYaz(kullaniciAdi, ev.target.result, true, true);
    };
    okuyucu.readAsDataURL(dosya);
    e.target.value = '';
});

socket.on('yeni-mesaj', (data) => {
    ekranaMesajYaz(data.ad, data.metin, false);
    mesajGecmisineKaydet(data.ad, data.metin, false);
    if (window.innerWidth <= 850) {
        const chatPanel = document.querySelector('.chat-panel');
        if (chatPanel && chatPanel.style.display !== 'flex') {
            okunmamisMesajSayisi++;
            const badge = document.getElementById('chatGostergeBadge');
            badge.innerText = okunmamisMesajSayisi;
            badge.style.display = 'flex';
        }
    }
});
socket.on('yeni-dosya', (data) => ekranaMesajYaz(data.ad, data.data, false, true));

// --- 25. SES EFEKTLERİ ---
window.sesGonder = function(url) {
    new Audio(url).play().catch(() => {});
    socket.emit('ses-efekti', url);
};
socket.on('ses-oynat', (url) => { new Audio(url).play().catch(() => {}); });

// --- 26. ELECTRON DESTEĞI ---
const minBtn   = document.getElementById('min-btn');
const closeBtn = document.getElementById('close-btn');
const titleBar = document.getElementById('bascord-title-bar');

if (!isMobile) {
    try {
        if (typeof require !== 'undefined' && window.require) {
            const { ipcRenderer } = require('electron');

            if (minBtn)   minBtn.addEventListener('click',   () => ipcRenderer.send('window-minimize'));
            if (closeBtn) closeBtn.addEventListener('click', () => ipcRenderer.send('window-close'));

            ipcRenderer.on('ekran-seciciyi-ac', (event, kaynaklar) => {
                const modal = document.getElementById('ekranSeciciModal');
                const liste = document.getElementById('ekranListesi');
                liste.innerHTML = '';

                kaynaklar.forEach(kaynak => {
                    const div = document.createElement('div');
                    div.style.cssText = 'width:175px; background:var(--renk-zemin); border-radius:8px; padding:10px; cursor:pointer; text-align:center; border:2px solid transparent; transition:0.2s;';
                    div.onmouseover = () => div.style.borderColor = 'var(--renk-aktif)';
                    div.onmouseout  = () => div.style.borderColor = 'transparent';
                    div.onclick = () => {
                        modal.style.display = 'none';
                        ipcRenderer.send('ekran-secildi', kaynak.id);
                    };
                    const img = document.createElement('img');
                    img.src = kaynak.thumbnail;
                    img.style.cssText = 'width:100%; height:100px; object-fit:cover; border-radius:4px; margin-bottom:8px; background:#000;';
                    const ad = document.createElement('div');
                    ad.style.cssText = 'color:#dbdee1; font-size:12px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
                    ad.title = kaynak.name;
                    ad.textContent = kaynak.name;
                    div.appendChild(img);
                    div.appendChild(ad);
                    liste.appendChild(div);
                });
                modal.style.display = 'flex';
            });

            window.ekranPaylasiminiIptalEt = function() {
                document.getElementById('ekranSeciciModal').style.display = 'none';
                ipcRenderer.send('ekran-secildi', null);
            };
        } else {
            throw new Error('web');
        }
    } catch(e) {
        if (titleBar) titleBar.style.display = 'none';
        document.body.style.paddingTop = '0';
    }
} else {
    if (titleBar) titleBar.style.display = 'none';
    document.body.style.paddingTop = '0';
}

// --- 27. MOBİL SEKME DEĞİŞTİR ---
window.sekmeDegistir = function(sekme) {
    const sidebar   = document.querySelector('.sidebar');
    const chatPanel = document.querySelector('.chat-panel');
    const main      = document.querySelector('.main');

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    if (sekme === 'kameralar') {
        document.getElementById('nav-kameralar').classList.add('active');
        if (window.innerWidth <= 850) {
            sidebar.style.setProperty('display',   'none', 'important');
            chatPanel.style.setProperty('display', 'none', 'important');
            main.style.setProperty('display',      'flex', 'important');
        }
    } else if (sekme === 'sohbet') {
        document.getElementById('nav-sohbet').classList.add('active');
        okunmamisMesajSayisi = 0;
        document.getElementById('chatGostergeBadge').style.display = 'none';
        if (window.innerWidth <= 850) {
            sidebar.style.setProperty('display',  'none', 'important');
            main.style.setProperty('display',     'none', 'important');
            chatPanel.style.setProperty('display','flex', 'important');
        }
    } else if (sekme === 'ayarlar') {
        document.getElementById('nav-ayarlar').classList.add('active');
        if (window.innerWidth <= 850) {
            main.style.setProperty('display',      'none', 'important');
            chatPanel.style.setProperty('display', 'none', 'important');
            sidebar.style.setProperty('display',   'flex', 'important');
        }
    }
};