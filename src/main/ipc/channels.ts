// Every IPC channel between the UI and the main process. The preload script and the main
// process both import this file, so a channel name can never drift between the two sides.
export const IPC_CHANNELS = {
  appGetInfo: 'holo:app:get-info',

  settingsLoad: 'holo:settings:load',
  settingsUpdate: 'holo:settings:update',
  settingsReset: 'holo:settings:reset',

  permissionsGetStatus: 'holo:permissions:get-status',
  permissionsRequest: 'holo:permissions:request',
  permissionsOpenSystemSettings: 'holo:permissions:open-system-settings',

  filesPickAudioFile: 'holo:files:pick-audio-file',
  filesReadAudioFile: 'holo:files:read-audio-file',

  analysisCacheGet: 'holo:analysis-cache:get',
  analysisCachePut: 'holo:analysis-cache:put',

  takeBegin: 'holo:take:begin',
  /** One-way (send): chunks are written in the order they are sent. */
  takeAppendAudio: 'holo:take:append-audio',
  /** One-way (send). */
  takeAppendVideo: 'holo:take:append-video',
  takeFinish: 'holo:take:finish',
  takeDiscard: 'holo:take:discard',

  exportChooseSavePath: 'holo:export:choose-save-path',
  exportStart: 'holo:export:start',
  exportCancel: 'holo:export:cancel',
  /** Main -> UI event carrying an ExportProgress. */
  exportProgress: 'holo:export:progress',
  exportOpenFile: 'holo:export:open-file',
  exportShowInFolder: 'holo:export:show-in-folder',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
