const { app, BrowserWindow, Tray, Menu, ipcMain, desktopCapturer } = require('electron');
const path = require('path');

let pencere;
let tray = null;

function uygulamaPenceresiYarat() {
    pencere = new BrowserWindow({
        width: 1280,
        height: 720,
        frame: false, 
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // --- YENİ EKRAN SEÇİCİ VE SES SİSTEMİ ---
    pencere.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
        // Tüm ekranları ve pencereleri yüksek kaliteli küçük resimlerle (thumbnail) alıyoruz
        desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } }).then((sources) => {
            
            // Verileri HTML arayüzümüze gönderiyoruz
            pencere.webContents.send('ekran-seciciyi-ac', sources.map(s => ({
                id: s.id,
                name: s.name,
                thumbnail: s.thumbnail.toDataURL()
            })));

            // Kullanıcı arayüzden seçim yapana kadar bekle
            ipcMain.once('ekran-secildi', (event, secilenId) => {
                if (secilenId) {
                    const secilenKaynak = sources.find(s => s.id === secilenId);
                    // DİKKAT: audio: 'loopback' komutu ile bilgisayarın SİSTEM SESİ de yayına gider!
                    callback({ video: secilenKaynak, audio: 'loopback' });
                } else {
                    callback(); // İptal tuşuna basıldıysa işlemi durdur
                }
            });
        }).catch(err => {
            console.log("Ekran yakalama hatası: ", err);
            callback();
        });
    });

    pencere.loadURL('https://bascord-app.onrender.com');

    pencere.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            pencere.hide();
        }
        return false;
    });
}

app.whenReady().then(() => {
    uygulamaPenceresiYarat();

    tray = new Tray(path.join(__dirname, 'icon.ico'));
    const contextMenu = Menu.buildFromTemplate([
        { label: "Bascord'ı Göster", click: () => pencere.show() },
        { type: 'separator' },
        { label: 'Tamamen Kapat', click: () => {
            app.isQuitting = true;
            app.quit();
        }}
    ]);

    tray.setToolTip('Bascord Premium Çalışıyor');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => pencere.show());
});

ipcMain.on('window-minimize', () => pencere.minimize());
ipcMain.on('window-close', () => pencere.hide());

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});