/** 파일 내용 기반 SHA-256. 같은 파일을 이름만 바꿔 다시 올려도 중복으로 본다. */
export async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 여러 파일 업로드는 각 내용 해시를 정렬해 하나의 묶음 해시로 만든다. */
export async function sha256FileBatch(files: readonly File[]): Promise<string> {
  const hashes = await Promise.all(files.map(sha256File))
  const payload = new TextEncoder().encode([...hashes].sort().join('|'))
  const digest = await crypto.subtle.digest('SHA-256', payload)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
