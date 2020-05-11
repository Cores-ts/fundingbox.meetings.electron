/* global __dirname, process */

const {
    BrowserWindow,
    Menu,
    app,
    shell
} = require('electron');
const isDev = require('electron-is-dev');
const { autoUpdater } = require('electron-updater');
const windowStateKeeper = require('electron-window-state');
const {
    initPopupsConfigurationMain,
    getPopupTarget,
    setupAlwaysOnTopMain,
    setupPowerMonitorMain,
    setupScreenSharingMain
} = require('jitsi-meet-electron-utils');
const path = require('path');
const URL = require('url');
const config = require('./app/features/config');

// Deep linked url
let deeplinkingUrl;

// We need this because of https://github.com/electron/electron/issues/18214
app.commandLine.appendSwitch('disable-site-isolation-trials');

autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';

/**
 * When in development mode:
 * - Load debug utilities (don't open the DevTools window by default though)
 * - Enable automatic reloads
 */
if (isDev) {
    require('electron-debug')({ showDevTools: false });
    require('electron-reload')(path.join(__dirname, 'build'));
}

/**
 * The window object that will load the iframe with Jitsi Meet.
 * IMPORTANT: Must be defined as global in order to not be garbage collected
 * acidentally.
 */
let mainWindow = null;

/**
 * Sets the application menu. It is hidden on all platforms except macOS because
 * otherwise copy and paste functionality is not available.
 */
function setApplicationMenu() {
    if (process.platform === 'darwin') {
        const template = [ {
            label: app.name,
            submenu: [ {
                label: 'Quit',
                accelerator: 'Command+Q',
                click() {
                    app.quit();
                }
            } ]
        }, {
            label: 'Edit',
            submenu: [ {
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                selector: 'undo:'
            },
            {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                selector: 'redo:'
            },
            {
                type: 'separator'
            },
            {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            },
            {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            },
            {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            },
            {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            }
            ]
        } ];

        Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    } else {
        Menu.setApplicationMenu(null);
    }
}

/**
 * Opens new window with index.html(Jitsi Meet is loaded in iframe there).
 */
function createJitsiMeetWindow() {
    // Application menu.
    setApplicationMenu();

    // Check for Updates.
    autoUpdater.checkForUpdatesAndNotify();

    // Load the previous window state with fallback to defaults.
    const windowState = windowStateKeeper({
        defaultWidth: 800,
        defaultHeight: 600
    });

    // Path to root directory.
    const basePath = isDev ? __dirname : app.getAppPath();

    // URL for index.html which will be our entry point.
    const indexURL = URL.format({
        pathname: path.resolve(basePath, './build/index.html'),
        protocol: 'file:',
        slashes: true
    });

    // Options used when creating the main Jitsi Meet window.
    // Use a preload script in order to provide node specific functionality
    // to a isolated BrowserWindow in accordance with electron security
    // guideline.
    const options = {
        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,
        icon: path.resolve(basePath, './resources/icons/icon_512x512.png'),
        minWidth: 1100,
        minHeight: 800,
        show: false,
        titleBarStyle: 'hidden',
        plugins: true,
        webPreferences: {
            nativeWindowOpen: true,
            nodeIntegration: false,
            preload: path.resolve(basePath, './build/preload.js')
        }
    };

    mainWindow = new BrowserWindow(options);
    windowState.manage(mainWindow);
    mainWindow.loadURL(indexURL);

    initPopupsConfigurationMain(mainWindow);
    setupAlwaysOnTopMain(mainWindow);
    setupPowerMonitorMain(mainWindow);
    setupScreenSharingMain(mainWindow, config.default.appName);

    mainWindow.webContents.on('new-window', (event, url, frameName) => {
        const target = getPopupTarget(url, frameName);

        if (!target || target === 'browser') {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    // Open the DevTools.
    // mainWindow.webContents.openDevTools()

    logEverywhere(`open-url# ${deeplinkingUrl}`);

    // Protocol handler for win32
    if (process.platform === 'win32') {
        // Keep only command line / deep linked arguments
        deeplinkingUrl = process.argv.slice(1);
    }

    if (deeplinkingUrl) {
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.executeJavaScript(`routeCall._onRoute("${deeplinkingUrl}")`);
            deeplinkingUrl = undefined;
        }
    }

    mainWindow.on('close', event => {
        if (app.quitting) {
            mainWindow = null;
        } else {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });
}

/**
 * Force Single Instance Application.
 */
const gotInstanceLock = app.requestSingleInstanceLock();

if (!gotInstanceLock) {
    app.quit();
    process.exit(0);
}

if (!app.isDefaultProtocolClient('com.fundingbox.meetings')) {
    // Define custom protocol handler. Deep linking works on packaged versions of the application!
    app.setAsDefaultProtocolClient('com.fundingbox.meetings');
}

/**
 * Run the application.
 */

app.on('activate', () => {
    if (mainWindow === null) {
        createJitsiMeetWindow();
    } else {
        mainWindow.show();
    }
});

app.on('certificate-error',
    // eslint-disable-next-line max-params
    (event, webContents, url, error, certificate, callback) => {
        if (isDev) {
            event.preventDefault();
            callback(true);
        } else {
            callback(false);
        }
    }
);

app.on('ready', createJitsiMeetWindow);

app.on('will-finish-launching', () => {
    // Protocol handler for osx
    app.on('open-url', (event, url) => {
        event.preventDefault();
        deeplinkingUrl = url;
        logEverywhere(`open-url-will-finish-launching# ${deeplinkingUrl}`);

        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.executeJavaScript(`routeCall._onRoute("${deeplinkingUrl}")`);
        }

        if (mainWindow) {
            mainWindow.isMinimized() && mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
});

/**
 * Log both at dev console and at running node console instance
 *
 * @param {string} s - String.
 * @returns {void}
 */
function logEverywhere(s) {
    console.log(s);
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.executeJavaScript(`console.log("${s}")`);
    }
}

app.on('second-instance', (e, argv) => {
    /**
     * If someone creates second instance of the application, set focus on
     * existing window.
     */

    // Protocol handler for win32
    // argv: An array of the second instance’s (command line / deep linked) arguments
    if (process.platform === 'win32') {
        // Keep only command line / deep linked arguments
        deeplinkingUrl = argv.slice(1);
    }

    if (mainWindow) {
        mainWindow.isMinimized() && mainWindow.restore();
        mainWindow.focus();
    }
});

app.on('window-all-closed', () => {
    // Don't quit the application on macOS.
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// eslint-disable-next-line no-return-assign
app.on('before-quit', () => app.quitting = true);
