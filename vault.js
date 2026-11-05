(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Vault = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function bytesToBase64(bytes) {
    let binary = "";
    const size = 0x8000;
    for (let index = 0; index < bytes.length; index += size) {
      binary += String.fromCharCode(...bytes.subarray(index, index + size));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function deriveKey(password, salt) {
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptVault(payload, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const cipher = new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(payload))
    ));
    return {
      v: 1,
      alg: "AES-GCM",
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      data: bytesToBase64(cipher),
    };
  }

  async function decryptVault(packed, password) {
    if (!packed || packed.v !== 1 || packed.alg !== "AES-GCM") {
      throw new Error("This shared file is not a templates vault.");
    }
    const key = await deriveKey(password, base64ToBytes(packed.salt));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(packed.iv) },
      key,
      base64ToBytes(packed.data)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  return { encryptVault, decryptVault };
});
