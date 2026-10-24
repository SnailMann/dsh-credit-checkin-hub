// Adapted from dsh-connect (MIT), Copyright (c) 2026 yembors64632.
// Read local byteCrypto envelopes; see the third-party notices in LICENSE.
import { createDecipheriv, createHash } from "node:crypto";
const JOE = Buffer.from([191,192,216,250,122,246,220,97,31,254,98,27,8,72,71,176,135,99,96,18,127,101,203,104,211,102,191,125,37,72,150,156,51,229,121,35,17,153,141,177,110,131,150,128,172,255,254,6,18,140,55,62,236,249,135,64,135,12,117,4,89,149,168,209]);
const HOE = Buffer.from([246,204,26,232,232,70,129,109,223,146,169,242,23,241,105,145,50,196,165,42,254,120,3,54,244,207,209,85,53,6,138,106,175,148,31,204,186,186,165,182,87,142,49,10,39,110,26,154,86,56,173,125,18,64,198,225,99,99,83,82,191,134,76,170]);
const WOE = Buffer.from([82,9,106,213,48,54,165,56,191,64,163,158,129,243,215,251,124,227,57,130,155,47,255,135,52,142,67,68,196,222,233,203,84,123,148,50,166,194,35,61,238,76,149,11,66,250,195,78,8,46,161,102,40,217,36,178,118,91,162,73,109,139,209,37]);
const VOE = Buffer.from([31,221,168,51,136,7,199,49,177,18,16,89,39,128,236,95,96,81,127,169,25,181,74,13,45,229,122,159,147,201,156,239,160,224,59,77,174,42,245,176,200,235,187,60,131,83,153,97,23,43,4,126,186,119,214,38,225,105,20,99,85,33,12,125]);

const HDR = Buffer.from([116, 99, 5, 16, 0, 0]);
const MAGIC = 'dGMF';           // base64("tc\x05")
const U_LEN = 32;               // key32
const H_LEN = 64;               // SHA-512 摘要长度
const MODE_AES = 1;

const sha512 = (b) => createHash('sha512').update(b).digest();

// DUe(n, mode)：取出 n 字节掩码。AES 模式 = WOE⊕VOE，PRIVATE 模式 = JOE⊕HOE。
function mask(n, mode) {
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) out[i] = mode === MODE_AES ? WOE[i] ^ VOE[i] : JOE[i] ^ HOE[i];
  return out;
}

// Roe(k32) → { aesKey, iv }：n = SHA512(k32) ‖ mask(64)，再把 n 前 64 覆盖成 SHA512(n)。
function kdf(key32, mode = MODE_AES) {
  const n = Buffer.alloc(H_LEN + 64);
  n.set(sha512(key32), 0);
  n.set(mask(64, mode), H_LEN);
  n.set(sha512(n), 0);
  return { aesKey: n.subarray(0, 16), iv: n.subarray(16, 32) };
}

// dv() 等价物：解密。校验不过返回 null（对应 App 返回空数组的失败分支）。
export function unseal(b64) {
  if (typeof b64 !== 'string' || !b64.startsWith(MAGIC)) return null;
  const blob = Buffer.from(b64, 'base64');
  if (blob.length < HDR.length + U_LEN + 16 || !blob.subarray(0, 6).equals(HDR)) return null;
  const { aesKey, iv } = kdf(blob.subarray(6, 6 + U_LEN));
  let pt;
  try {
    const d = createDecipheriv('aes-128-cbc', aesKey, iv);
    pt = Buffer.concat([d.update(blob.subarray(6 + U_LEN)), d.final()]);
  } catch { return null; }
  return sha512(pt.subarray(H_LEN)).equals(pt.subarray(0, H_LEN)) ? pt.subarray(H_LEN).toString('utf8') : null;
}

