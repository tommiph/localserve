/** HTTP LAN pages lack secure-context randomUUID in some browsers. Retain native
 * implementations and use Web Crypto randomness for editor/request identities.
 */
(() => {
  if (typeof globalThis.crypto.randomUUID === 'function') return;
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value() {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } });
})();
