import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { nicknameUniquenessKey } from '../utils/nickname'

async function syncUserHandleDoc(userId, nickname) {
  if (!userId || !nickname) return
  const key = nicknameUniquenessKey(nickname)
  if (!key) return
  await setDoc(doc(db, 'userHandles', key), { userId }, { merge: true })
}

async function removeUserHandleDoc(nickname) {
  const key = nicknameUniquenessKey(nickname)
  if (!key) return
  await deleteDoc(doc(db, 'userHandles', key)).catch(() => {})
}

async function assertNicknameAvailable(normalizedNickname, excludeUserId) {
  const key = nicknameUniquenessKey(normalizedNickname)
  if (!key) {
    throw new Error('Nickname is required')
  }
  const handleSnap = await getDoc(doc(db, 'userHandles', key))
  if (handleSnap.exists()) {
    const existing = handleSnap.data()?.userId
    if (existing && existing !== excludeUserId) {
      throw new Error('This nickname is already taken.')
    }
  }
  const snap = await getDocs(collection(db, 'users'))
  for (const d of snap.docs) {
    if (d.id === excludeUserId) continue
    const nick = String((d.data() || {}).nickname || '').trim()
    if (!nick) continue
    if (nicknameUniquenessKey(nick) === key) {
      throw new Error('This nickname is already taken.')
    }
  }
}

async function backfillNicknameLowerIfNeeded(uid) {
  if (!uid) return
  try {
    const ref = doc(db, 'users', uid)
    const snap = await getDoc(ref)
    const data = snap.data() || {}
    const nick = String(data.nickname || '').trim()
    if (!nick) return
    const expectedKey = nicknameUniquenessKey(nick)
    if (data.nicknameLower === expectedKey) {
      await syncUserHandleDoc(uid, nick)
      return
    }
    await setDoc(ref, { nicknameLower: expectedKey }, { merge: true })
    await syncUserHandleDoc(uid, nick)
  } catch {
    /* ignore backfill failures */
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const loading = ref(false)
  const error = ref('')
  const isReady = ref(false)

  let authInitPromise

  function initAuthListener() {
    if (authInitPromise) return authInitPromise

    authInitPromise = new Promise((resolve) => {
      onAuthStateChanged(auth, (firebaseUser) => {
        user.value = firebaseUser
        isReady.value = true
        if (firebaseUser?.uid) {
          backfillNicknameLowerIfNeeded(firebaseUser.uid)
        }
        resolve(firebaseUser)
      })
    })

    return authInitPromise
  }

  async function waitForAuthInit() {
    return initAuthListener()
  }

  async function register(email, password, nickname) {
    loading.value = true
    error.value = ''
    try {
      const normalizedNickname = String(nickname || '').trim()
      if (!normalizedNickname) {
        throw new Error('Nickname is required')
      }
      if (normalizedNickname.length < 2) {
        throw new Error('Nickname should contain at least 2 characters.')
      }
      if (normalizedNickname.length > 30) {
        throw new Error('Nickname is too long (max 30 chars).')
      }
      await assertNicknameAvailable(normalizedNickname, null)
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      await setDoc(doc(db, 'users', cred.user.uid), {
        id: cred.user.uid,
        email: cred.user.email,
        nickname: normalizedNickname,
        nicknameLower: nicknameUniquenessKey(normalizedNickname),
      })
      await syncUserHandleDoc(cred.user.uid, normalizedNickname)
    } catch (err) {
      error.value = err.message || 'Registration failed'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function login(email, password) {
    loading.value = true
    error.value = ''
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (err) {
      error.value = err.message || 'Sign in failed'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    await signOut(auth)
  }

  async function updateNickname(nickname) {
    if (!user.value?.uid) throw new Error('User is not authenticated')
    const normalizedNickname = String(nickname || '').trim()
    if (!normalizedNickname) throw new Error('Nickname is required')
    if (normalizedNickname.length < 2) {
      throw new Error('Nickname should contain at least 2 characters.')
    }
    if (normalizedNickname.length > 30) {
      throw new Error('Nickname is too long (max 30 chars).')
    }
    loading.value = true
    error.value = ''
    try {
      const prevSnap = await getDoc(doc(db, 'users', user.value.uid))
      const prevNick = String((prevSnap.data() || {}).nickname || '').trim()
      await assertNicknameAvailable(normalizedNickname, user.value.uid)
      if (prevNick && nicknameUniquenessKey(prevNick) !== nicknameUniquenessKey(normalizedNickname)) {
        await removeUserHandleDoc(prevNick)
      }
      await setDoc(
        doc(db, 'users', user.value.uid),
        {
          id: user.value.uid,
          email: user.value.email || null,
          nickname: normalizedNickname,
          nicknameLower: nicknameUniquenessKey(normalizedNickname),
        },
        { merge: true },
      )
      await syncUserHandleDoc(user.value.uid, normalizedNickname)
    } catch (err) {
      error.value = err.message || 'Failed to update nickname'
      throw err
    } finally {
      loading.value = false
    }
  }

  return {
    user,
    loading,
    error,
    isReady,
    initAuthListener,
    waitForAuthInit,
    register,
    updateNickname,
    login,
    logout,
  }
})
