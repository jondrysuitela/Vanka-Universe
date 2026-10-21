"use client";

import { useCallback, useEffect, useState } from "react";

import IPhonePinOverlay from "@/components/archive/IPhonePinOverlay";
import ArchiveShell from "@/components/archive/ArchiveShell";
import ArchiveVisitorExperience from "@/components/archive/ArchiveVisitorExperience";
import { ARCHIVE_VISITOR_MESSAGES } from "@/lib/archive/visitor";

/**
 * Public visitor route for the private archive (Tahap VU-ARCHIVE-ACCESS-4A).
 *
 * `/arsip-ibu` is PUBLIC to load but gated by the visitor PIN. It checks
 * `GET /api/archive/access` first and shows the PIN gate unless the server
 * confirms an open session. The main Dashboard is untouched and stays public —
 * this route is only reachable by its own URL and never uses the admin session.
 *
 * Fail-closed: any check failure (network error, 503, malformed body) falls back
 * to the PIN gate, never to the experience.
 *
 * AUTO-LOCK: leaving the route ends the visitor session. Three mechanisms cover
 * the ways a page can be left:
 *  - `pagehide` + `sendBeacon` — a full page unload (refresh, tab close,
 *    external navigation). A beacon survives the unload; a plain fetch would be
 *    cancelled by the browser.
 *  - `beforeunload` — the same case, additionally asking the browser to warn
 *    the visitor that the archive will lock.
 *  - the unmount cleanup — a client-side navigation (Next.js `router.push`,
 *    a `<Link>`), where the page component is unmounted.
 * All of them revoke the session server-side, so the PIN must be entered again.
 */

type Phase = "checking" | "locked" | "unlocked";

export default function ArsipIbuPage() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [notice, setNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/archive/access", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        const body = (await response.json().catch(() => null)) as
          | { data?: { unlocked?: unknown } }
          | null;
        const unlocked = response.ok && body?.data?.unlocked === true;
        if (active) setPhase(unlocked ? "unlocked" : "locked");
      } catch {
        if (active) setPhase("locked");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const openArchive = useCallback(() => {
    setNotice(undefined);
    setPhase("unlocked");
  }, []);

  const endSession = useCallback((reason?: string) => {
    setNotice(reason);
    setPhase("locked");
  }, []);

  // Leaving the route locks the archive again (server-side session revoked).
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Modern browsers show their own generic message; the return value is
      // ignored by most of them, but the call is still required to trigger it.
      event.returnValue = "Arsip akan terkunci otomatis. Lanjutkan?";
      return "Arsip akan terkunci otomatis. Lanjutkan?";
    };

    /**
     * Revoke the visitor session.
     *
     * `sendBeacon` is the primary mechanism: it survives the page going away,
     * which is exactly what happens on a refresh/tab close — a normal `fetch`
     * is cancelled by the browser in that case. It cannot set custom headers,
     * hence the dedicated `/api/archive/access/lock` route (see that route for
     * why dropping the custom header is safe there).
     *
     * The `fetch` fallback carries the FULL safe-mutation headers
     * (`content-type: application/json` + `x-vanka-request: 1`); without the
     * content type the server rejects the request with 403 and the session
     * would NOT be revoked.
     */
    const lockArchive = () => {
      try {
        if (typeof navigator.sendBeacon === "function") {
          navigator.sendBeacon(
            "/api/archive/access/lock",
            new Blob(["{}"], { type: "application/json" }),
          );
          return;
        }
      } catch {
        // Beacon blocked (e.g. by an extension): fall through to fetch.
      }
      void (async () => {
        try {
          await fetch("/api/archive/access/logout", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-vanka-request": "1",
            },
            body: "{}",
          });
        } catch {
          // The cookie is cleared on the next load check regardless.
        }
      })();
    };

    /**
     * `pagehide` fires on unload AND when the page enters the back/forward
     * cache. A cached page that is restored is still "on the archive", so it
     * must NOT be locked: only a real departure does that.
     */
    const handlePageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      lockArchive();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      // Unmount = the visitor navigated away (client-side navigation).
      lockArchive();
    };
  }, []);

  return (
    <ArchiveShell>
      {phase === "checking" && (
        <p role="status" className="text-center font-serif text-lg text-white/70">
          Memeriksa akses arsip…
        </p>
      )}

      {phase === "locked" && <IPhonePinOverlay onUnlocked={openArchive} notice={notice} />}

      {phase === "unlocked" && (
        <ArchiveVisitorExperience
          onSessionEnded={() => endSession(ARCHIVE_VISITOR_MESSAGES.sessionEnded)}
        />
      )}
    </ArchiveShell>
  );
}
