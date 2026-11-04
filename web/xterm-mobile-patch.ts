// Fix xterm 5.5.0's handling of mobile keyboards replacing textarea text.
const original = 'const t=this._textarea.value,i=t.replace(e,"");this._dataAlreadySent=i,t.length>e.length?this._coreService.triggerDataEvent(i,!0):t.length<e.length?this._coreService.triggerDataEvent(`${a.C0.DEL}`,!0):t.length===e.length&&t!==e&&this._coreService.triggerDataEvent(t,!0)'
const replacement = 'const t=this._textarea.value;let n=0;for(;n<e.length&&n<t.length&&e[n]===t[n];)n++;const i=t.slice(n),r=a.C0.DEL.repeat(Array.from(e.slice(n)).length)+i;this._dataAlreadySent=i,r&&this._coreService.triggerDataEvent(r,!0)'
export function patchXtermMobileInput(source: string): string {
  if (source.split(original).length !== 2) throw new Error('xterm mobile input patch no longer matches the installed xterm version')
  return source.replace(original, replacement)
}
