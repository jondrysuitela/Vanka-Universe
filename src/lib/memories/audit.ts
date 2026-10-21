import { getPool } from "@/lib/db";
import { resolveClientIp } from "@/lib/archive/access/request";

/**
 * Append-only audit writer untuk Memories.
 *
 * audit_logs di schema.sql mendukung INSERT (append-only di-protect terhadap
 * UPDATE/DELETE oleh trigger init.sql), kolom action menerima
 * create/update/delete, dan entity_type menerima 'memory'. Jadi menulis audit
 * di sini AMAN tanpa mengubah skema.
 *
 * Kegagalan menulis audit TIDAK menggagalkan operasi utama: baris induk sudah
 * dikomit, dan mencoba rollback penuh butuh transaksi yang belum tersedia di
 * layer pool ini. Error dilaporkan ke log server (tanpa membocorkan apa pun ke
 * klien).
 */

export type AuditAction = "create" | "update" | "delete";

export interface AuditEntry<T> {
  actorId: string;
  actorEmail: string;
  actorLabel: string;
  action: AuditAction;
  entityId: string;
  ipAddress: string | null;
  userAgent: string | null;
  diff?: T;
}

/**
 * Client info recorded in the audit trail.
 *
 * The IP is resolved ONLY from a header the operator declared trustworthy
 * (`ARCHIVE_TRUSTED_PROXY_HEADER`). A raw `x-forwarded-for` is
 * client-controllable unless a proxy overwrites it, so storing it verbatim
 * would let a client write an arbitrary "IP" into the audit log — the log
 * would then record a false origin.
 *
 * With no trusted header the IP is UNKNOWN (null): the audit row says "unknown",
 * which is honest. The audit trail is a record, not a security control, so this
 * never blocks the operation.
 */
export function requestClientInfo(request: Request): { ipAddress: string | null; userAgent: string | null } {
  return { ipAddress: resolveClientIp(request), userAgent: request.headers.get("user-agent") };
}

export async function writeAuditLog<T>(entry: AuditEntry<T>): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO audit_logs
       (actor_id, actor_email, actor_label, action, entity_type, entity_id, ip_address, user_agent, diff_json)
     VALUES ($1, $2, $3, $4, 'memory', $5, $6, $7, $8::jsonb)`,
    [
      entry.actorId,
      entry.actorEmail,
      entry.actorLabel,
      entry.action,
      entry.entityId,
      entry.ipAddress,
      entry.userAgent,
      entry.diff === undefined ? null : JSON.stringify(entry.diff),
    ],
  );
}

/** Server-side logging only; never propagates the write failure to the client. */
export async function writeAuditLogBestEffort<T>(entry: AuditEntry<T>): Promise<void> {
  try {
    await writeAuditLog(entry);
  } catch (error) {
    console.error("[audit] gagal menulis audit_logs:", error);
  }
}