(()=>{"use strict";module.exports=[75495,t=>{t.s(["f",0,["owner","admin"]])},19583,t=>t.a(async(i,e)=>{try{var a=t.i(43793),l=i([a]);[a]=l.then?(await l)():l;let u="l.id, l.edition_id, e.year, l.title, l.display_date, l.full_text, l.sections, l.thumbnail, l.status, l.created_by, l.created_at, l.updated_at";async function n(t){let i=(0,a.f)(),e=await i.query("SELECT id FROM birthday_editions WHERE year = $1",[t]);return e.rows[0]?.id??null}async function r(t,i,e){let l=(0,a.f)(),n=(await l.query(`INSERT INTO birthday_letters
       (edition_id, title, display_date, full_text, sections, thumbnail, status, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'draft', $7)
     ON CONFLICT (edition_id) DO UPDATE
        SET title = EXCLUDED.title,
            display_date = EXCLUDED.display_date,
            full_text = EXCLUDED.full_text,
            sections = EXCLUDED.sections,
            thumbnail = EXCLUDED.thumbnail,
            updated_at = now()
      WHERE birthday_letters.status = 'draft'
     RETURNING id, edition_id, title, display_date, full_text, sections, thumbnail, status, created_by, created_at, updated_at`,[i,e.title,e.displayDate,e.fullText,JSON.stringify(e.sections),null===e.thumbnail?null:JSON.stringify(e.thumbnail),t.id])).rows[0];return n?{outcome:"saved",row:n}:{outcome:"locked"}}async function s(){let t=(0,a.f)();return(await t.query(`SELECT ${u}
       FROM birthday_letters l
       JOIN birthday_editions e ON e.id = l.edition_id
      ORDER BY e.year ASC`)).rows}async function d(t){let i=(0,a.f)();return(await i.query(`SELECT ${u}
       FROM birthday_letters l
       JOIN birthday_editions e ON e.id = l.edition_id
      WHERE e.year = $1`,[t])).rows[0]??null}t.s(["f",0,n,"d",0,d,"y",0,s,"n",0,r]),e()}catch(t){e(t)}},!1),82100,t=>{var i=t.i(6132),e=t.i(5954),a=t.i(6033),l=t.i(55744),n=t.i(4770);let r=i.z.strictObject({id:e.z.string().trim().min(1).max(64),heading:e.z.string().trim().max(500),body:e.z.string().max(5e4)}),s=i.z.strictObject({src:e.z.string().trim().max(2e3).optional(),alt:e.z.string().trim().max(500),caption:e.z.string().trim().max(1e3).optional()}),d=i.z.strictObject({age:a.z.number().int().min(n.N).max(n.L),title:e.z.string().trim().max(255),displayDate:e.z.string().trim().max(255),fullText:e.z.string().max(2e5),sections:l.z.array(r).max(500),thumbnail:s.nullish().transform(t=>t??null)});t.s(["u",0,function(t){if(!/^\d+$/.test(t))return null;let i=Number(t);return!Number.isInteger(i)||i<n.N||i>n.L?null:i},"M",0,d])}]})();

//# sourceMappingURL=src_lib_birthday_letters_1z965jr04l6-u._.js.map