import { app, BrowserWindow, Menu, nativeImage, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { registerIpc } from './ipc';
// electron-updater ships CommonJS; grab autoUpdater off the default export so it
// works through electron-vite's externalized-deps interop.
import updater from 'electron-updater';
const { autoUpdater } = updater;

const isDev = !app.isPackaged;
const isMac = process.platform === 'darwin';

// Dev-only app icon. Packaged builds get the icon from the bundle (electron-builder
// uses build/icon.*), but in dev the dock/taskbar would otherwise show the generic
// Electron icon. Resolve the source PNG relative to the compiled main entry.
const devIcon = isDev
  ? nativeImage.createFromPath(join(__dirname, '../../build/icon.png'))
  : undefined;

// Channel used by the application menu's "File → New Pull Request" item to
// tell the renderer to open the Create-PR flow. The renderer subscribes via
// preload's `api.menu.onNewPullRequest(handler)`.
export const MENU_CH = {
  newPr: 'menu:new-pr',
} as const;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'revu for CodeCommit',
    ...(devIcon && !devIcon.isEmpty() ? { icon: devIcon } : {}),
    transparent: isMac,
    backgroundColor: isMac ? '#00000000' : '#0a0a0a',
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          vibrancy: 'under-window' as const,
          visualEffectState: 'followWindow' as const,
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.on('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (isDev && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function buildMenu(): Menu {
  const sendNewPr = (): void => {
    const win = BrowserWindow.getFocusedWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(MENU_CH.newPr);
    }
  };
  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'New Pull Request',
        accelerator: 'CmdOrCtrl+N',
        click: sendNewPr,
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([{ role: 'appMenu' }] as MenuItemConstructorOptions[])
      : []),
    fileMenu,
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn more',
          click: () => {
            void shell.openExternal('https://github.com/');
          },
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

// Check the configured release feed (electron-builder.yml `publish`) for a newer
// version and download it in the background, notifying the user when it's ready
// to install. No-op in dev (there's no packaged app to update) and best-effort:
// a missing feed or offline machine must never block startup.
function checkForUpdates(): void {
  if (isDev) return;
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[autoUpdater] update check failed:', err);
  });
}

app.whenReady().then(() => {
  if (isMac && devIcon && !devIcon.isEmpty()) app.dock?.setIcon(devIcon);
  Menu.setApplicationMenu(buildMenu());
  registerIpc();
  createWindow();
  checkForUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
