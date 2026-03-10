// ============================================================
// BASCORD v4 - script.js
// DÜZELTMELER:
// - Ses karşıya gitmiyor → track ekleme + re-negotiation düzeltildi
// - Ekran yayını görünmüyor → stream/sinyal eşleştirme yeniden yazıldı
// - ontrack event.streams[0] undefined olabilir → track bazlı yaklaşım
// - Re-negotiation her iki taraf için de çalışıyor
// ============================================================

const socket = io();

// --- 1. CİHAZ TESPİTİ ---
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

// --- 2. DURUM DEĞİŞKENLERİ ---
let peerConnections = {};       // { socketId: RTCPeerConnection }

// Stream eşleştirme kuyrukları
let bekleyenStream  = {};       // streamId -> MediaStream
let bekleyenSinyal  = {};       // streamId -> { kimden, tur }

// Ses analiz temizliği için
let sesAnalyzIntervals = {};
let sesAnalyzNodes     = {};
let globalAudioCtx = null;

// Medya yayınları
let kameraYayini   = null;
let ekranYayini    = null;
let mikrofonYayini = null;
let onKameraMi     = true;

// Kontrol & UI durum
let isPttActive    = false;
let isPttKeyPressed = false;
let isDeafened     = false;
let wasMicEnabledBeforeDeafen = false;
let okunmamisMesajSayisi = 0;

// Re-negotiation kilidi (çift teklif önleme)
let muzakereKilidi = {};

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
    toast.className = 'toast' + (type === 'leave' ? ' leave' : '');
    const icon = type === 'leave' ? '👋' : '🟢';
    toast.innerHTML = `${icon} ${mesaj}`;
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
function getOrCreateVideoWrapper(kullaniciId, tip, isim) {
    const wrapperId = `kutu-${kullaniciId}-${tip}`;
    let el = document.getElementById(wrapperId);
    if (el) return el;

    el = document.createElement('div');
    el.className  = 'video-wrapper';
    el.id         = wrapperId;

    const videoId   = `vid-${kullaniciId}-${tip}`;
    const isMuted   = (kullaniciId === 'yerel') ? 'muted' : '';
    const flipStyle = (tip === 'kamera' && kullaniciId === 'yerel') ? 'transform:scaleX(-1);' : '';

    let labelText;
    if (kullaniciId === 'yerel') {
        labelText = tip === 'ekran' ? '🖥 Senin Ekranın' : '📷 Sen';
    } else {
        labelText = tip === 'ekran' ? `🖥 ${isim} Ekranı` : `📷 ${isim}`;
    }

    const kontrolBtnHtml = (tip === 'ekran' && kullaniciId !== 'yerel' && !isMobile)
        ? `<button class="overlay-btn" id="kontrolBtn-${kullaniciId}" onclick="kontrolIstegiYolla('${kullaniciId}')">
               <i class="fas fa-hand-pointer"></i> Kontrol Et
           </button>`
        : '';

    el.innerHTML = `
        <div class="ping-dot" id="ping-${kullaniciId}-${tip}" style="${kullaniciId === 'yerel' ? 'display:none;' : ''}"></div>
        <video id="${videoId}" autoplay playsinline ${isMuted}
               style="width:100%; height:100%; object-fit:contain; background:#000; ${flipStyle}"></video>
        <div class="video-label">${labelText}</div>
        <div class="video-overlay">
            ${kontrolBtnHtml}
            <button class="overlay-btn" onclick="tamEkranYap('${videoId}')"><i class="fas fa-expand"></i> Büyüt</button>
        </div>
        <div class="ses-seviyesi-bar" id="bar-${kullaniciId}-${tip}"></div>
    `;

    document.getElementById('mainVideoGrid').appendChild(el);

    if (tip === 'ekran' && kullaniciId !== 'yerel' && !isMobile) {
        const videoEl = el.querySelector('video');
        videoEl.addEventListener('click', (event) => {
            if (videoEl.getAttribute('data-kontrol-aktif') !== 'true') return;
            const rect   = videoEl.getBoundingClientRect();
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
    const onay = confirm(`⚠️ ${data.ad} ekranınızı işaretlemek istiyor. İzin veriyor musunuz?`);
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
function sesAnaliziniBaslat(stream, wrapperKey, isLocalMic = false) {
    if (sesAnalyzIntervals[wrapperKey]) return;

    if (!globalAudioCtx) {
        globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (globalAudioCtx.state === 'suspended') {
        globalAudioCtx.resume().catch(() => {});
    }

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
    if (data.durum) topBarInfo.innerHTML = `🎤 ${data.ad} konuşuyor...`;
    else if (topBarInfo.innerHTML.includes(data.ad)) topBarInfo.innerHTML = '';
});

// ============================================================
// --- 13. WEBRTC ÇEKIRDEK ---
// ============================================================

// Re-negotiation — kilitle çift offer önleniyor
async function muzakereBaslat(hedefId) {
    const pc = peerConnections[hedefId];
    if (!pc) return;
    if (muzakereKilidi[hedefId]) return;
    if (pc.signalingState !== 'stable') return;

    muzakereKilidi[hedefId] = true;
    try {
        const teklif = await pc.createOffer();
        await pc.setLocalDescription(teklif);
        socket.emit('webrtc-teklif', { kime: hedefId, teklif: pc.localDescription });
    } catch(err) {
        console.warn('Müzakere hatası:', err);
    } finally {
        setTimeout(() => { delete muzakereKilidi[hedefId]; }, 600);
    }
}

// Tek track tüm bağlantılara ekle + re-negotiate
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
                // addTrack sonrası onnegotiationneeded tetiklenecek
                // ama bazen tetiklenmeyebilir, güvenli olarak manuel çağır
                setTimeout(() => muzakereBaslat(hedefId), 200);
            }
        } catch(e) {
            console.warn('Track ekleme hatası:', e);
        }
    });
}

// Uyumluluk için
function trackleriTumBaglantilaraEkle(track, stream) {
    trackiTumBaglantilaraEkle(track, stream);
}

// Stream + Sinyal çift kuyruk eşleştirme
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
    const isim   = isimEl ? isimEl.innerText : 'Kullanıcı';

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
            document.getElementById('remoteAudioContainer').appendChild(audioEl);
        }
        if (audioEl.srcObject !== stream) {
            audioEl.srcObject = stream;
            audioEl.play().catch(() => {});
        }
    }
}

// Peer bağlantı kur
function baglantiKoprusuKur(hedefId, isInitiator) {
    if (peerConnections[hedefId]) {
        try { peerConnections[hedefId].close(); } catch(e) {}
        delete peerConnections[hedefId];
    }
    delete muzakereKilidi[hedefId];

    const pc = new RTCPeerConnection(stunSunuculari);
    peerConnections[hedefId] = pc;

    // ============================================================
    // KRİTİK DÜZELTME 1: ontrack
    // event.streams[0] bazen undefined → fallback MediaStream oluştur
    // Hem stream.id hem de peer+kind bazlı eşleştirme yapılıyor
    // ============================================================
    pc.ontrack = (event) => {
        let stream = event.streams && event.streams[0];
        if (!stream) {
            stream = new MediaStream([event.track]);
        }

        // Stream ID bazlı eşleştirme
        bekleyenStream[stream.id] = stream;
        streamSinyalEsles(stream.id);

        // Fallback: Aynı peer'dan gelen sinyal ile kind eşleştirmesi
        Object.keys(bekleyenSinyal).forEach(sid => {
            if (bekleyenStream[sid]) return; // Zaten eşleşti
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
        console.log(`[WebRTC] ${hedefId} bağlantı: ${pc.connectionState}`);
        if (pc.connectionState === 'failed' && peerConnections[hedefId] === pc && isInitiator) {
            pc.restartIce();
            setTimeout(() => muzakereBaslat(hedefId), 500);
        }
    };

    // ============================================================
    // KRİTİK DÜZELTME 2: Re-negotiation her iki taraf için
    // ============================================================
    pc.onnegotiationneeded = () => {
        if (pc.signalingState === 'stable') {
            muzakereBaslat(hedefId);
        }
    };

    // ============================================================
    // KRİTİK DÜZELTME 3: Mevcut track'leri hemen ekle
    // Mikrofon dahil — önceki sürümde ses eksik ekleniyordu
    // ============================================================
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

    if (isInitiator) {
        setTimeout(() => muzakereBaslat(hedefId), 400);
    }

    return pc;
}

// --- 14. SOCKET.IO WEBRTC OLAYLARI ---

socket.on('yeni-kullanici-geldi', (data) => {
    showToast(`${data.ad} odaya katıldı`, 'join');
    bildirimSesiCal(660, 0.2);
    baglantiKoprusuKur(data.id, true);
});

socket.on('webrtc-teklif-geldi', async (data) => {
    if (!peerConnections[data.kimden]) baglantiKoprusuKur(data.kimden, false);
    const pc = peerConnections[data.kimden];
    try {
        // Glare (çarpışma) durumu: her iki taraf da teklif gönderdiyse
        if (pc.signalingState === 'have-local-offer') {
            await pc.setLocalDescription({ type: 'rollback' });
        }
        await pc.setRemoteDescription(new RTCSessionDescription(data.teklif));
        const cevap = await pc.createAnswer();
        await pc.setLocalDescription(cevap);
        socket.emit('webrtc-cevap', { kime: data.kimden, cevap: pc.localDescription });
    } catch(e) {
        console.warn('Teklif işleme hatası:', e);
    }
});

socket.on('webrtc-cevap-geldi', async (data) => {
    const pc = peerConnections[data.kimden];
    if (!pc) return;
    try {
        if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.cevap));
        }
    } catch(e) {
        console.warn('Cevap işleme hatası:', e);
    }
});

socket.on('ice-adayi-geldi', async (data) => {
    const pc = peerConnections[data.kimden];
    if (!pc) return;
    try {
        await pc.addIceCandidate(new RTCIceCandidate(data.aday));
    } catch(e) {}
});

// --- 15. MEDYA DURUMU (gelen) ---
socket.on('medya-durumu-geldi', (data) => {
    const { kimden, tur, streamId } = data;

    if (tur === 'kam-ac' || tur === 'ekr-ac' || tur === 'mik-ac' || tur === 'ekr-ses') {
        bekleyenSinyal[streamId] = { kimden, tur };
        streamSinyalEsles(streamId);

        // 5 saniye timeout
        setTimeout(() => {
            if (bekleyenSinyal[streamId]) {
                console.warn(`Stream zaman aşımı: ${streamId} (${tur})`);
                delete bekleyenSinyal[streamId];
            }
        }, 5000);

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
        isimSpan.textContent = kullanicilar[id];

        sol.appendChild(avatar);
        sol.appendChild(isimSpan);

        const ikonlar = document.createElement('div');
        ikonlar.className = 'status-icons';
        ikonlar.innerHTML = `
            <i class="fas fa-video"          title="Kamera"   style="color:${d.kamera   ? 'var(--renk-aktif)'   : 'var(--renk-gri)'};"></i>
            <i class="fas fa-desktop"        title="Ekran"    style="color:${d.ekran    ? 'var(--renk-basari)'  : 'var(--renk-gri)'};"></i>
            <i class="fas ${d.kulaklik ? 'fa-headphones-slash' : 'fa-headphones'}" title="Kulaklık" style="color:${d.kulaklik ? 'var(--renk-tehlike)' : 'var(--renk-gri)'};"></i>
            <i class="fas ${d.mikrofon ? 'fa-microphone'      : 'fa-microphone-slash'}" title="Mikrofon" style="color:${d.mikrofon ? 'var(--renk-basari)' : 'var(--renk-tehlike)'};"></i>
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

    Object.keys(bekleyenSinyal).forEach(k => {
        if (bekleyenSinyal[k] && bekleyenSinyal[k].kimden === id) delete bekleyenSinyal[k];
    });
    // Ayrılan kullanıcıya ait bekleyen stream'leri temizle
    Object.keys(bekleyenStream).forEach(k => { delete bekleyenStream[k]; });
});

// --- 17. KANALA KATIL ---
kanalaKatilBtn.addEventListener('click', () => {
    kanalaKatilBtn.innerHTML = "<i class='fas fa-plug' style='font-size:15px;'></i> Bağlandı";
    kanalaKatilBtn.classList.add('active');
    kanalaKatilBtn.disabled = true;

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
        showToast('Deafen aktifken mikrofon açılamaz!');
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

            // KRİTİK: Track ekle ve re-negotiate et
            const audioTrack = mikrofonYayini.getAudioTracks()[0];
            trackiTumBaglantilaraEkle(audioTrack, mikrofonYayini);
            sesAnaliziniBaslat(mikrofonYayini, 'yerel-kamera', true);

        } catch(e) {
            console.error('Mikrofon hatası:', e);
            showToast('Mikrofon açılamadı! İzin verdiniz mi?');
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
            showToast('Kamera açılamadı! İzin verdiniz mi?');
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

            // Sistem sesinin lokal playback'ini kapat (yankı önleme)
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

            // KRİTİK: Video ve audio track'leri ayrı ayrı ekle
            ekranYayini.getTracks().forEach(track => {
                trackiTumBaglantilaraEkle(track, ekranYayini);
                const tip = track.kind === 'video' ? 'ekr-ac' : 'ekr-ses';
                socket.emit('medya-durumu', { tur: tip, broadcast: true, id: ekranYayini.id });
            });

            ekranYayini.getVideoTracks()[0].onended = () => {
                if (ekranYayini) ekranBtn.click();
            };

        } catch(e) {
            if (e.name !== 'NotAllowedError') showToast('Ekran paylaşılamadı!');
        }
    } else {
        ekranYayini.getTracks().forEach(t => t.stop());
        ekranYayini = null;

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

// --- 24. SOHBET ---
function ekranaMesajYaz(isim, metin, benMi, resimMi = false) {
    const div = document.createElement('div');
    div.className = benMi ? 'msg-container benim' : 'msg-container';

    const saat = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
        icerik.textContent = metin;
    }
    div.appendChild(icerik);

    mesajGecmisi.appendChild(div);
    mesajGecmisi.scrollTop = mesajGecmisi.scrollHeight;
}

mesajGonderBtn.addEventListener('click', () => {
    const mesaj = mesajKutusu.value.trim();
    if (mesaj !== '') {
        socket.emit('chat-mesaji', { ad: kullaniciAdi, metin: mesaj });
        ekranaMesajYaz(kullaniciAdi, mesaj, true);
        mesajKutusu.value = '';
    }
});
mesajKutusu.addEventListener('keypress', (e) => { if (e.key === 'Enter') mesajGonderBtn.click(); });

dosyaSecici.addEventListener('change', (e) => {
    const dosya = e.target.files[0];
    if (!dosya) return;
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