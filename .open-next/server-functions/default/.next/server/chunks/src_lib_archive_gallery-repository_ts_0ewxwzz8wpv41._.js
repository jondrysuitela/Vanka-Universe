module.exports=[76290,i=>i.a(async(e,t)=>{try{var r=i.i(43793),o=i.i(49794),a=e([r]);[r]=a.then?(await a)():a;class p extends Error{constructor(){super("Galeri arsip belum tersedia di database (migrasi 4g39 belum dijalankan)."),this.name="GalleryNotMigratedError"}}function d(i){return"object"==typeof i&&null!==i&&"42P01"===i.code}function s(i){let e=i.find(i=>"intro"===i.role)??null,t=i.filter(i=>"photo"===i.role).map(i=>({mediaId:i.media_id,title:i.title,description:i.description,memoryDate:i.memory_date,position:i.position})).sort((i,e)=>i.position-e.position);return{introMediaId:e?e.media_id:null,photos:t}}async function n(){let i=(0,r.f)();try{let e=await i.query(`SELECT m.media_id, m.role, m.title, m.description, m.memory_date, m.position
         FROM private_archive_media m
         JOIN private_archives a ON a.id = m.archive_id
        WHERE a.slug = $1
        ORDER BY m.role DESC, m.position ASC`,[o.y]);return s(e.rows)}catch(i){if(d(i))throw new p;throw i}}async function m(i,e){let t=[],a=[],n=[],m=[],l=[],u=[];null!==e.introMediaId&&(t.push(e.introMediaId),a.push("intro"),n.push(""),m.push(""),l.push(null),u.push(0)),e.photos.forEach((i,e)=>{t.push(i.mediaId),a.push("photo"),n.push(i.title),m.push(i.description),l.push(i.memoryDate),u.push(e)});let E=(0,r.f)();try{let e=await E.query(`WITH ensure AS (
         INSERT INTO private_archives (slug, status, created_by)
         VALUES ($1, 'draft', $2)
         ON CONFLICT (slug) DO NOTHING
         RETURNING id
       ),
       target AS (
         SELECT id FROM ensure
         UNION ALL
         SELECT id FROM private_archives WHERE slug = $1
         LIMIT 1
       ),
       removed AS (
         DELETE FROM private_archive_media m
          WHERE m.archive_id IN (SELECT id FROM target)
            AND m.media_id <> ALL ($3::uuid[])
       )
       INSERT INTO private_archive_media
         (archive_id, media_id, role, title, description, memory_date, position)
       SELECT t.id, v.media_id, v.role, v.title, v.description, v.memory_date, v.position
         FROM target t
         CROSS JOIN unnest(
           $3::uuid[], $4::text[], $5::text[], $6::text[], $7::date[], $8::int[]
         ) AS v(media_id, role, title, description, memory_date, position)
       ON CONFLICT (archive_id, media_id) DO UPDATE
         SET role = EXCLUDED.role,
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             memory_date = EXCLUDED.memory_date,
             position = EXCLUDED.position,
             updated_at = now()
       RETURNING media_id, role, title, description, memory_date, position`,[o.y,i.id,t,a,n,m,l,u]);return s(e.rows)}catch(i){if(d(i))throw new p;throw i}}i.s(["K",0,p,"p",0,d,"Z",0,m,"a",0,n]),t()}catch(i){t(i)}},!1)];

//# sourceMappingURL=src_lib_archive_gallery-repository_ts_0ewxwzz8wpv41._.js.map