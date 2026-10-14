import { online } from './online.ts'

/** Cược của mọi người cho một cuộc đua (Firestore races/{id}/bets/{uid}), để thấy ai đặt chó nào. */
export interface PublicBet {
  uid: string
  name: string
  dog: number
  amount: number
}

type Fs = typeof import('firebase/firestore')
let fsLib: Fs | null = null
const lib = async () => (fsLib ??= await import('firebase/firestore'))

export async function publishBet(raceId: number, name: string, dog: number, amount: number): Promise<void> {
  const cloud = online.cloud
  if (!cloud) return
  const fs = await lib()
  const db = fs.getFirestore(cloud.app)
  await fs.setDoc(fs.doc(db, 'races', String(raceId), 'bets', cloud.account.uid), { name, dog, amount, at: Date.now() }).catch((e: unknown) => console.warn('Bet publish', e))
}

/** Nghe cược của cuộc đua raceId; trả về hàm huỷ nghe. */
export async function watchBets(raceId: number, onChange: (bets: PublicBet[]) => void): Promise<() => void> {
  const cloud = online.cloud
  if (!cloud) return () => {}
  const fs = await lib()
  const db = fs.getFirestore(cloud.app)
  return fs.onSnapshot(
    fs.collection(db, 'races', String(raceId), 'bets'),
    (snap) => onChange(snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as PublicBet)),
    (e) => console.warn('Bets', e),
  )
}
