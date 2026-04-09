/** Same key for Latin + CJK: NFKC; toLowerCase for Latin. */
export function nicknameUniquenessKey(s) {
  return String(s || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
}
