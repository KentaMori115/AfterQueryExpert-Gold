// Where open sessions live between requests.
//
// An upload in progress is not a file yet: nothing of it belongs in the files
// collection until every part has reached Telegram. Sessions are held here in
// front of that, keyed by the user who opened them, and are dropped once they
// stop taking traffic.
//
// Every read takes the moment it is being asked at rather than reading a clock
// of its own, so a request that spans a session's expiry sees one answer for
// its whole length, and a sweep run from a job queue can be replayed over a
// past instant without deleting what is live now.

import { SESSION_IDLE_MS, type UploadSession } from "./upload-session"

// How many uploads one account may have in flight at once.
export const MAX_OPEN_SESSIONS = 4

export interface SessionStore {
    sessions: Map<string, UploadSession>
}

export function createSessionStore(): SessionStore {
    return { sessions: new Map<string, UploadSession>() }
}

/**
 * Idle is measured from the last chunk, not from the start: a slow client that
 * keeps sending stays alive however long the file takes.
 */
function isIdle(session: UploadSession, now: number): boolean {
    return now - session.updatedAt >= SESSION_IDLE_MS
}

function liveSessionsOf(store: SessionStore, userId: string, now: number): UploadSession[] {
    const live: UploadSession[] = []

    for (const session of store.sessions.values()) {
        if (session.userId === userId && !isIdle(session, now)) {
            live.push(session)
        }
    }
    live.sort((a, b) => a.startedAt - b.startedAt)
    return live
}

/**
 * Takes a session into the store.
 *
 * An account already holding the maximum is refused, though sessions that have
 * gone idle no longer occupy a place even when nothing has swept them out yet.
 * An id the store is already holding is refused too: overwriting it would lose
 * whatever the earlier session had taken in, and the client would be told to
 * resume from an offset nothing stands behind.
 */
export function openSession(store: SessionStore, session: UploadSession, now: number): void {
    if (store.sessions.has(session.id)) {
        throw new Error("Upload session id is already open")
    }
    if (liveSessionsOf(store, session.userId, now).length >= MAX_OPEN_SESSIONS) {
        throw new Error("Too many uploads in progress")
    }
    store.sessions.set(session.id, session)
}

/** One session, if it belongs to this account and is still alive. */
export function getSession(
    store: SessionStore,
    userId: string,
    id: string,
    now: number,
): UploadSession | null {
    const session = store.sessions.get(id)
    if (!session || session.userId !== userId || isIdle(session, now)) {
        return null
    }
    return session
}

/**
 * Drops what has gone idle and reports it, so the caller can bill or log the
 * bytes that were abandoned.
 *
 * The ids come back sorted as text rather than in whatever order the store
 * happened to hold them, so two sweeps over the same set of abandoned uploads
 * read the same way in a log.
 */
export function sweepSessions(store: SessionStore, now: number): string[] {
    const dropped: string[] = []

    for (const session of [...store.sessions.values()]) {
        if (isIdle(session, now)) {
            dropped.push(session.id)
            store.sessions.delete(session.id)
        }
    }
    dropped.sort()
    return dropped
}
