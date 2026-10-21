(()=>{"use strict";module.exports=[80314,e=>{var r=e.i(49507),t=e.i(69896);function s(e){return"string"==typeof e&&t.n.test(e)}async function a(e){if(!s(e))throw Error("hashPin: PIN tidak memenuhi format yang diizinkan.");return(0,r.Z)(e)}async function n(e,t){return s(e)?"string"!=typeof t||0===t.length?(await (0,r.S)(e),!1):(0,r.B)(e,t):(await (0,r.S)("string"==typeof e?e:""),!1)}e.s(["z",0,a,"K",0,s,"w",0,n])},45671,e=>e.a(async(r,t)=>{try{var s=e.i(49794),a=e.i(43793),n=e.i(18659),i=r([a]);async function c(){let e=(0,a.f)();try{let r=(await e.query(`SELECT pin_hash, access_enabled, access_version
         FROM private_archives
        WHERE slug = $1`,[s.y])).rows[0];if(!r)return null;return{pinHash:r.pin_hash,accessEnabled:r.access_enabled,accessVersion:Number(r.access_version)}}catch(e){if((0,n.a)(e))throw new n.y;throw e}}async function o(e,r){if("string"!=typeof r||0===r.length)throw Error("setArchivePin: refusing to store an empty PIN hash.");let t=(0,a.f)();try{let a=(await t.query(`WITH ensure AS (
         INSERT INTO private_archives (slug, status, created_by)
         VALUES ($1, 'draft', $2)
         ON CONFLICT (slug) DO NOTHING
         RETURNING slug
       ),
       target AS (
         SELECT slug FROM ensure
         UNION ALL
         SELECT slug FROM private_archives WHERE slug = $1
         LIMIT 1
       )
       UPDATE private_archives p
          SET pin_hash = $3,
              pin_updated_at = now(),
              access_version = p.access_version + 1
         FROM target t
        WHERE p.slug = t.slug
       RETURNING p.access_version`,[s.y,e,r])).rows[0];if(!a)throw Error("setArchivePin: the private archive row was not updated.");return Number(a.access_version)}catch(e){if((0,n.a)(e))throw new n.y;throw e}}[a]=i.then?(await i)():i,e.s(["n",0,c,"L",0,o]),t()}catch(e){t(e)}},!1),85387,e=>{e.s(["f",0,["owner","admin"]])}]})();

//# sourceMappingURL=src_lib_archive_0c9drlwfam_3c._.js.map