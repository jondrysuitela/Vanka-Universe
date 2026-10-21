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
