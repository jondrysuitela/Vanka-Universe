module.exports=[62785,a=>a.a(async(e,t)=>{try{var i=a.i(43793),r=a.i(49794),s=e([i]);[i]=s.then?(await s)():s;let c="id, slug, title, narrative, music_enabled, music_media_id, status, created_by, created_at, updated_at";async function d(){let a=(0,i.f)();return(await a.query(`SELECT ${c} FROM private_archives WHERE slug = $1`,[r.y])).rows[0]??null}async function u(a,e){let t=(0,i.f)();return(await t.query(`INSERT INTO private_archives
       (slug, title, narrative, music_enabled, music_media_id, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'draft', $6)
     ON CONFLICT (slug) DO UPDATE
        SET title = EXCLUDED.title,
            narrative = EXCLUDED.narrative,
            music_enabled = EXCLUDED.music_enabled,
            music_media_id = EXCLUDED.music_media_id,
            updated_at = now()
     RETURNING ${c}`,[r.y,e.title,e.narrative,e.musicEnabled,e.musicMediaId,a.id])).rows[0]}a.s(["R",0,d,"N",0,u]),t()}catch(a){t(a)}},!1)];

//# sourceMappingURL=src_lib_archive_repository_ts_02e1pny3lh06l._.js.map