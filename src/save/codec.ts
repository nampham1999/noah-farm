/**
 * Nén chuỗi bằng gzip rồi mã hoá base64url, để chép dữ liệu lưu sang máy khác
 * bằng dán văn bản (GDD mục 6.6). Sau này cũng dùng cho link chia sẻ (mục 8.1).
 */

const PREFIX = 'CF1.'

export async function encodeCode(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  return PREFIX + toBase64Url(bytes)
}

export async function decodeCode(code: string): Promise<string> {
  const trimmed = code.trim().replace(/\s+/g, '')
  if (!trimmed.startsWith(PREFIX)) throw new Error('Not a Cozy Farm code')
  const bytes = fromBase64Url(trimmed.slice(PREFIX.length))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
