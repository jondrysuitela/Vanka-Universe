import { getPool } from "@/lib/db";

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

export function requestClientInfo(request: Request): { ipAddress: string | null; userAgent: string | null } {
  const forwarded = request.headers.get("x-forwarded-for");
  const ipAddress = forwarded ? forwarded.split(",")[0].trim() || null : null;
  return { ipAddress, userAgent: request.headers.get("user-agent") };
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