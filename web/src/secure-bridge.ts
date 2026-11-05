// MUST be the first import of the app (main.tsx): it takes the native bridge's secret key and replaces
// window.HermesAndroid with a wrapper that adds the key to every call.
//
// Why: Android injects the bridge object into EVERY frame of the WebView, including the sandboxed iframes
// that show untrusted HTML on the canvas. Without a key, such a page could call the bridge (and, through it,
// the phone's Hermes dashboard). The key is handed out once per page load to the first caller, which is
// this script; frames that only see the raw object cannot make a single call with it.
type Raw = Record<string, (...args: unknown[]) => unknown>

const METHODS = [
  'speak', 'setReadAloud', 'openTtsEngineApp', 'shareText', 'listVoices', 'stopSpeaking', 'ttsControl', 'startListening', 'startListeningOver', 'stopListening',
  'listSttModels', 'downloadSttModel', 'cancelSttDownload', 'deleteSttModel', 'setSttModel', 'testSttModel', 'addSttModelUrl', 'pickSttModelFiles',
  'getToken', 'httpAsync', 'openFile', 'getBaseUrl', 'startHermes', 'watchHermes', 'notify', 'setBackground', 'isSystemDark',
  'cancelNotification', 'openExternal', 'copyText', 'copyRich', 'haptic', 'setEdgeGrab', 'isInForeground', 'appVersion',
  'sharedItem', 'mediaBase', 'setLastChat', 'getTokenAsync', 'setupState', 'setupFix', 'isAssistant', 'openAssistantSettings', 'setLockAssist', 'requestUnlock', 'leaveLockScreen', 'signInTermux', 'installUpdate',
  'saveImage', 'shareImage', 'chatSeen', 'setUnseen', 'installHelperApp', 'probeTermux', 'probeTermuxNow', 'setupCommand', 'setupProgress',
  'bgState', 'bgFrameAsync', 'bgAction',
  'openRemoteDebugging', 'remoteDebuggingState', 'turnOffRemoteDebugging', // none of these can turn remote debugging on: the shell asks for the screen lock itself
  'uninstallStart', 'uninstallState', 'uninstallApp',
  'diagLog', 'diagEnabled', 'diagEvent', 'diagClear', 'setDiagEnabled', // the diagnostic log on the phone; every event part is checked again in DiagLog.java
  'pluginState', 'pluginUpdate', // the plugin update runs only the APK's own copy; nothing from the page reaches the script
  'confirmApproval', 'confirmIdentity', 'approvalLockState', 'setApprovalLock', 'forgetApproval', // the shell asks for the screen lock itself; nothing here can skip it
  'phoneDataState', 'phoneDataSet', 'phoneDataOpenSettings', 'phoneDataGrant', 'phoneDataFullAccess', 'phoneDataTainted', 'phoneDataAnyRead', 'phoneDataOverflowed', 'phoneDataForget', 'remoteBlock', 'remoteAllowOnce' // phone data for the agent: turning a switch on asks for the screen lock inside the shell
]

const w = window as unknown as { HermesAndroid?: unknown }
const raw = w.HermesAndroid as Raw | undefined
if (raw && typeof raw.handshake === 'function') {
  const key = String(raw.handshake() || '')
  const wrapped: Raw = {}
  for (const name of METHODS) {
    const fn = raw[name]
    if (typeof fn === 'function') wrapped[name] = (...args: unknown[]) => fn.call(raw, key, ...args)
  }
  w.HermesAndroid = wrapped
}
export {}
