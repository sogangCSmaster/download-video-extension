/**
 * Thin typed wrapper around chrome.i18n.
 * Message catalogs live in public/_locales/<locale>/messages.json;
 * MessageKey keeps call sites in sync with the catalog at compile time.
 */

export type MessageKey =
  | 'extName'
  | 'extDescription'
  | 'popupHeading'
  | 'rescanButton'
  | 'rescanTooltip'
  | 'statusNoActiveTab'
  | 'statusListLoadFailed'
  | 'statusStartingDownload'
  | 'statusDownloadStarted'
  | 'statusDownloadFailed'
  | 'statusDownloadCancelled'
  | 'statusCancelFailed'
  | 'statusRescanning'
  | 'statusRescanFailed'
  | 'kindBlobHint'
  | 'kindHls'
  | 'kindDash'
  | 'streamingVideoName'
  | 'phasePreparing'
  | 'phaseDownloading'
  | 'phaseMuxing'
  | 'phaseMuxingPercent'
  | 'phaseSaving'
  | 'buttonDownload'
  | 'buttonDownloading'
  | 'buttonCancel'
  | 'emptyTitle'
  | 'emptyHint'
  | 'errorVideoNotFound'
  | 'errorUnsupportedVideoType'
  | 'errorDownloadInProgress'
  | 'errorOffscreenStartFailed'
  | 'errorSaveFailed'
  | 'errorSaveInterrupted'
  | 'streamErrorLive'
  | 'streamErrorDrm'
  | 'streamErrorTooLarge'
  | 'streamErrorFetch'
  | 'streamErrorUnsupported'
  | 'streamErrorCancelled'
  | 'streamErrorGeneric';

/** Resolve a localized message. Falls back to the key if the catalog misses it. */
export function t(key: MessageKey, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(key, substitutions) || key;
}
